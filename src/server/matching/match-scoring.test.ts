import { describe, expect, test } from "bun:test";

import type {
  LlmBatchCall,
  LlmPort,
  LlmRequest,
  LlmStructuredRequest,
} from "../platform/ports/llm.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import {
  grants,
  jobPlaces,
  jobs,
  profiles,
  resumes,
  targets,
  users,
} from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import { ungatedSpend } from "../billing/spend.ts";
import { readStoredMatches } from "./match-store.ts";
import type { ScoreReply } from "./score-schema.ts";

Bun.env.BETTER_AUTH_SECRET ??= "match-scoring-test-secret-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(3)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { createMatchScoringService } = await import("./match-scoring.ts");

const NOW = 1_800_000_000_000;

const reply: ScoreReply = {
  blockers: [],
  level: 20,
  logistics: 10,
  reasons: ["Same Go backend work as your last role.", "The posting asks for five years."],
  role_fit: 40,
  skills: 30,
};

const testClock = { now: () => NOW + 1000 };

interface FakeOptions {
  batch?: boolean;
  batchInvalidFirst?: boolean;
  replies?: (request: { system: string; user: string }) => ScoreReply | { score: number };
}

class FakeLlm implements LlmPort {
  readonly batchCalls: LlmRequest[][] = [];
  readonly structuredCalls: LlmStructuredRequest[] = [];
  private readonly options: FakeOptions;
  private invalidBatchCall = false;
  private invalidFirstCall = false;

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  invalidateFirstCall() {
    this.invalidFirstCall = true;
  }

  invalidateFirstBatch() {
    this.invalidBatchCall = true;
  }

  estimateBatchCostMicros(requests: readonly LlmRequest[]) {
    return requests.length * 100;
  }

  async runBatch(requests: readonly LlmRequest[]) {
    await Promise.resolve();
    this.batchCalls.push([...requests]);
    const firstBatchInvalid = this.invalidBatchCall;
    this.invalidBatchCall = false;

    return requests.map(
      (request) =>
        ({
          costMicros: 100,
          customId: request.customId,
          inputTokens: 100,
          model: "claude-haiku-5-5",
          outputTokens: 50,
          result: {
            ok: true,
            value: firstBatchInvalid ? { score: 1 } : this.valueFor(request),
          },
          cachedTokens: 0,
          cacheWriteTokens: 0,
        }) satisfies LlmBatchCall,
    );
  }

  estimateSingleCostMicros() {
    return 100;
  }

  async runSingle() {
    await Promise.resolve();

    return {
      cachedTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 0,
      inputTokens: 0,
      model: "claude-haiku-5-5",
      outputTokens: 0,
      text: null,
    };
  }

  estimateStructuredCostMicros() {
    return 100;
  }

  async runStructured(request: LlmStructuredRequest) {
    await Promise.resolve();
    this.structuredCalls.push(request);

    if (this.invalidFirstCall) {
      this.invalidFirstCall = false;

      return { ...FakeLlm.callOf(), text: "Not JSON" };
    }

    return {
      ...FakeLlm.callOf(),
      text: JSON.stringify(this.valueFor(request)),
    };
  }

  private static callOf() {
    return {
      cachedTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 50,
      inputTokens: 100,
      model: "claude-haiku-5-5",
      outputTokens: 40,
    };
  }

  private valueFor(request: { system: string; user: string }) {
    return this.options.replies?.(request) ?? reply;
  }
}

function fresh() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values([
      {
        createdAt: new Date(NOW),
        email: "person@example.test",
        emailVerified: true,
        id: "user-1",
        name: "Person",
        role: "user",
        updatedAt: new Date(NOW),
      },
      {
        createdAt: new Date(NOW),
        email: "owner@example.test",
        emailVerified: true,
        id: "owner-1",
        name: "Owner",
        role: "owner",
        updatedAt: new Date(NOW),
      },
    ])
    .run();

  db.insert(profiles)
    .values([
      {
        createdAt: new Date(NOW),
        languages: JSON.stringify(["en"]),
        onboardedAt: new Date(NOW),
        userId: "user-1",
        updatedAt: new Date(NOW),
      },
      {
        createdAt: new Date(NOW),
        languages: JSON.stringify(["en"]),
        onboardedAt: new Date(NOW),
        userId: "owner-1",
        updatedAt: new Date(NOW),
      },
    ])
    .run();

  db.insert(resumes)
    .values({
      bytes: 100,
      filenameEnc: "resume.pdf",
      id: "resume-1",
      isCurrent: true,
      objectKey: "resume.pdf",
      pages: 1,
      parsedWith: "unpdf",
      sha256: "sha",
      textEnc: "Five years of Go and Postgres.",
      uploadedAt: new Date(NOW),
      userId: "user-1",
    })
    .run();

  db.insert(targets)
    .values({
      locations: JSON.stringify(["city:ca:toronto"]),
      roles: JSON.stringify(["backend"]),
      updatedAt: new Date(NOW),
      userId: "user-1",
      version: 2,
    })
    .run();

  return { db, sqlite };
}

function addJob(
  db: ReturnType<typeof fresh>["db"],
  id: string,
  options: { category?: string; company?: string; postedAt?: number; title?: string } = {},
) {
  const title = options.title ?? "Backend Engineer";

  db.insert(jobs)
    .values({
      applyUrl: `https://acme.example/${id}`,
      applyVia: "direct",
      atsJobId: id,
      boardToken: "acme",
      category: options.category ?? "backend",
      cities: JSON.stringify(["toronto"]),
      company: options.company ?? "Acme",
      companyNorm: (options.company ?? "Acme").toLowerCase(),
      companySlug: (options.company ?? "Acme").toLowerCase(),
      countries: JSON.stringify(["ca"]),
      createdAt: NOW,
      dedupeKey: `${id}|${title}`,
      description: "Build Go services on Postgres.",
      descriptionHash: `hash-${id}`,
      externalId: `acme:${id}`,
      firstSeenAt: NOW,
      freehireSource: "greenhouse",
      id,
      lastSeenAt: NOW,
      postedAt: options.postedAt ?? NOW,
      source: "greenhouse",
      status: "open",
      title,
      titleNorm: title.toLowerCase(),
      updatedAt: NOW,
    })
    .run();
  db.insert(jobPlaces)
    .values([
      { jobId: id, kind: "country", placeId: "country:ca" },
      { jobId: id, kind: "city", placeId: "city:ca:toronto" },
    ])
    .run();
}

function serviceFor(db: ReturnType<typeof fresh>["db"], llm: FakeLlm, clock = testClock) {
  return createMatchScoringService({
    clock,
    db,
    llm,
    personal: {
      forget: () => undefined,
      openFor: async (_userId, _scope, sealed) => {
        await Promise.resolve();

        return sealed;
      },
      sealFor: async (_userId, _scope, plaintext) => {
        await Promise.resolve();

        return plaintext;
      },
    },
    spendGate: ungatedSpend,
  });
}

describe("live scoring", () => {
  test("scores one job per call and stores the sum of the anchors", async () => {
    const { db } = fresh();

    addJob(db, "job-a");
    addJob(db, "job-b");

    const llm = new FakeLlm();
    const result = await serviceFor(db, llm).scorePool("user-1");

    expect(result.scored).toBe(2);
    expect(llm.structuredCalls).toHaveLength(2);
    expect(llm.structuredCalls[0]?.user.split("JOB:").length).toBe(2);
    expect(readStoredMatches(db, "user-1").every((row) => row.score === 100)).toBe(true);
  });

  test("retries an invalid reply once, then stores the valid retry", async () => {
    const { db } = fresh();

    addJob(db, "job-a");

    const llm = new FakeLlm();
    llm.invalidateFirstCall();

    await serviceFor(db, llm).scorePool("user-1");

    expect(llm.structuredCalls).toHaveLength(2);
    expect(readStoredMatches(db, "user-1")[0]?.score).toBe(100);
  });

  test("rejects a second invalid reply and leaves the job unscored", async () => {
    const { db } = fresh();

    addJob(db, "job-a");

    const llm: FakeLlm = new FakeLlm({ replies: () => ({ score: 91 }) });
    const result = await serviceFor(db, llm).scorePool("user-1");

    expect(result.scored).toBe(0);
    expect(result.rejected).toBe(1);
    expect(llm.structuredCalls).toHaveLength(2);
    expect(readStoredMatches(db, "user-1")[0]?.score).toBeNull();
  });

  test("computes a score once and reuses it on the next run", async () => {
    const { db } = fresh();

    addJob(db, "job-a");

    const llm = new FakeLlm();
    const service = serviceFor(db, llm);

    await service.scorePool("user-1");
    await service.scorePool("user-1");

    expect(llm.structuredCalls).toHaveLength(1);
  });

  test("respects the spend gate without calling the model", async () => {
    const { db } = fresh();

    addJob(db, "job-a");

    const llm = new FakeLlm();

    const service = createMatchScoringService({
      clock: createClock(),
      db,
      llm,
      personal: {
        forget: () => undefined,
        openFor: async (_userId, _scope, sealed) => {
          await Promise.resolve();

          return sealed;
        },
        sealFor: async (_userId, _scope, plaintext) => {
          await Promise.resolve();

          return plaintext;
        },
      },
      spendGate: { allows: () => false, gated: true },
    });

    const result = await service.scorePool("user-1");

    expect(result.scored).toBe(0);
    expect(llm.structuredCalls).toHaveLength(0);
  });
});

describe("batch scoring", () => {
  test("uses the batch API for a paid user's new jobs", async () => {
    const { db } = fresh();

    addJob(db, "job-a");
    db.insert(grants)
      .values({
        createdAt: NOW,
        expiresAt: NOW + 30 * 86_400_000,
        id: "grant-1",
        quantity: 50,
        source: "period",
        startsAt: NOW - 1,
        userId: "user-1",
      })
      .run();

    const llm = new FakeLlm({ batch: true });
    const result = await serviceFor(db, llm).scoreNewJobs("user-1");

    expect(result.scored).toBe(1);
    expect(llm.batchCalls).toHaveLength(1);
    expect(llm.structuredCalls).toHaveLength(0);
    expect(readStoredMatches(db, "user-1")[0]?.score).toBe(100);
  });

  test("retries an invalid batch reply once before rejecting it", async () => {
    const { db } = fresh();

    addJob(db, "job-a");
    db.insert(grants)
      .values({
        createdAt: NOW,
        expiresAt: NOW + 30 * 86_400_000,
        id: "grant-1",
        quantity: 50,
        source: "period",
        startsAt: NOW - 1,
        userId: "user-1",
      })
      .run();

    const llm = new FakeLlm({ batch: true });
    llm.invalidateFirstBatch();

    const result = await serviceFor(db, llm).scoreNewJobs("user-1");

    expect(result.scored).toBe(1);
    expect(llm.batchCalls).toHaveLength(2);
    expect(readStoredMatches(db, "user-1")[0]?.score).toBe(100);
  });

  test("gives a free-trial user no repeating scoring", async () => {
    const { db } = fresh();

    addJob(db, "job-a");
    db.insert(grants)
      .values({
        createdAt: NOW,
        expiresAt: NOW + 3 * 86_400_000,
        id: "grant-1",
        quantity: 3,
        source: "trial",
        startsAt: NOW - 1,
        userId: "user-1",
      })
      .run();

    const llm = new FakeLlm({ batch: true });
    const result = await serviceFor(db, llm).scoreNewJobs("user-1");

    expect(result.scored).toBe(0);
    expect(llm.batchCalls).toHaveLength(0);
  });

  test("caps the paid new jobs at 50 a day", async () => {
    const { db } = fresh();

    for (let index = 0; index < 3; index += 1) {
      addJob(db, `job-${String(index)}`);
    }

    db.insert(grants)
      .values({
        createdAt: NOW,
        expiresAt: NOW + 30 * 86_400_000,
        id: "grant-1",
        quantity: 50,
        source: "period",
        startsAt: NOW - 1,
        userId: "user-1",
      })
      .run();

    const llm = new FakeLlm({ batch: true });
    const service = serviceFor(db, llm);

    await service.scoreNewJobs("user-1");
    await service.scoreNewJobs("user-1");

    expect(llm.batchCalls.flat()).toHaveLength(3);
  });
});

describe("the ordered page", () => {
  test("reads the stored scores in the one sort order and keeps scoring rows null", async () => {
    const { db } = fresh();

    addJob(db, "job-low", { postedAt: NOW + 20, title: "Backend Engineer" });
    addJob(db, "job-high", { postedAt: NOW, title: "Senior Backend Engineer" });

    const llm = new FakeLlm({
      replies: (request) =>
        request.user.includes("Senior Backend Engineer")
          ? reply
          : { ...reply, role_fit: 15, skills: 10 },
    });

    const service = serviceFor(db, llm);

    await service.scorePool("user-1");

    const page = service.page("user-1", 0, 10);

    expect(page.total).toBe(2);
    expect(page.items.map((row) => row.id)).toEqual(["job-high", "job-low"]);
    expect(JSON.stringify(page)).not.toContain("codeRank");
  });
});
