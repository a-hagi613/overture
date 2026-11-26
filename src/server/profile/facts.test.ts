import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import type { LlmPort } from "../platform/ports/llm.ts";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { events, llmUsage, users } from "../platform/db/schema.ts";
import { createFactService } from "./facts.ts";
import { createPersonalCrypto } from "./personal-crypto.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

Bun.env.BETTER_AUTH_SECRET ??= "facts-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(7)).toString("base64");

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

const { createResumeFactsReader, RESUME_FACTS_PURPOSE } = await import("./resume-facts.ts");

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return null;
}

function freshFacts() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const now = new Date(clock.now());

  db.insert(users)
    .values({
      id: "user-1",
      name: "Example Owner",
      email: "owner@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const personal = createPersonalCrypto(db, masterKeyringFor(new Uint8Array(32).fill(7)));

  return { clock, db, facts: createFactService({ db, clock, personal }), userId: "user-1" };
}

const languageFixtureSchema = z.object({
  language: z.string(),
  level: z.string().nullable(),
});

const extractionFixtureSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  citizenshipOrWorkPermit: z.string().nullable(),
  currentEmployer: z.string().nullable(),
  currentTitle: z.string().nullable(),
  yearsOfExperience: z.number().nullable(),
  highestDegree: z.string().nullable(),
  languages: z.array(languageFixtureSchema).nullable(),
  linkedInUrl: z.string().nullable(),
  githubOrPortfolioUrls: z.array(z.string()).nullable(),
});

const resumeFixtureSchema = z.object({
  identity: z.object({ name: z.string(), email: z.string() }),
  notes: z.string(),
  extraction: extractionFixtureSchema,
  facts: z.record(z.string(), z.string()),
});

function resumeFixture(slug: string) {
  const directory = join("test/e2e/fixtures/resumes", slug);

  return {
    ...resumeFixtureSchema.parse(
      JSON.parse(readFileSync(join(directory, "expected.json"), "utf8")),
    ),
    text: readFileSync(join(directory, "resume.txt"), "utf8"),
  };
}

function resumeFixtures() {
  return readdirSync("test/e2e/fixtures/resumes")
    .toSorted()
    .map((slug) => resumeFixture(slug));
}

function scriptedLlm(replies: (string | Error)[]) {
  const calls: string[] = [];

  const llm: LlmPort = {
    estimateBatchCostMicros: () => 0,
    estimateStructuredCostMicros: () => 120,
    estimateSingleCostMicros: () => 0,
    runBatch: async () => {
      await Promise.resolve();

      return [];
    },
    runSingle: async () => {
      await Promise.resolve();

      throw new Error("the resume reader never sends a PDF call");
    },
    runStructured: async (request) => {
      const reply = replies[calls.length];

      calls.push(request.user);

      await Promise.resolve();

      if (reply === undefined) {
        throw new Error("the script has no reply left");
      }

      if (reply instanceof Error) {
        throw reply;
      }

      return {
        model: "claude-haiku-5-5",
        text: reply,
        inputTokens: 1000,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 100,
        costMicros: 250,
      };
    },
  };

  return { calls, llm };
}

async function savedFacts(facts: ReturnType<typeof createFactService>, userId: string) {
  return Object.fromEntries((await facts.list(userId)).map((record) => [record.key, record.value]));
}

describe("the resume reader", () => {
  test("stores a valid reply as unconfirmed resume Facts and records its cost", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("01-header-contact-line");
    const { calls, llm } = scriptedLlm([JSON.stringify(fixture.extraction)]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      fixture.identity,
      fixture.text,
    );

    expect(read.status).toBe("extracted");

    const saved = await facts.saveFromResume(userId, read.facts);

    expect(Object.fromEntries(saved.map((record) => [record.key, record.value]))).toEqual(
      fixture.facts,
    );
    expect(saved.every((record) => record.source === "resume")).toBe(true);
    expect(saved.every((record) => !record.confirmed)).toBe(true);
    expect(saved.every((record) => record.revision === 1)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("MAYA OKAFOR");

    const usage = db.select().from(llmUsage).all();

    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      purpose: RESUME_FACTS_PURPOSE,
      model: "claude-haiku-5-5",
      inputTokens: 1000,
      outputTokens: 100,
      costMicros: 250,
      userId,
    });
  });

  test("drops every value the resume does not state", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("01-header-contact-line");

    const { llm } = scriptedLlm([
      JSON.stringify({
        firstName: "Jordan",
        lastName: "Smith",
        email: "fake@example.com",
        phone: "+1 999 999 9999",
        city: "San Francisco",
        region: "California",
        country: "United States",
        citizenshipOrWorkPermit: "US citizen",
        currentEmployer: "Google",
        currentTitle: "Chief Executive Officer",
        yearsOfExperience: 20,
        highestDegree: "PhD Physics",
        languages: [{ language: "Japanese", level: "native" }],
        linkedInUrl: "https://linkedin.com/in/jordan-smith",
        githubOrPortfolioUrls: ["https://github.com/jordan"],
      }),
    ]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      { email: fixture.identity.email, name: "Maya Okafor" },
      fixture.text,
    );

    expect(read.status).toBe("extracted");

    await facts.saveFromResume(userId, read.facts);

    expect(await savedFacts(facts, userId)).toEqual({
      email: fixture.identity.email,
      legal_name: "Maya Okafor",
    });
  });

  test("retries one schema miss and rejects cleanly when the second one fails too", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("04-no-phone");
    const { calls, llm } = scriptedLlm(['{"firstName": 1}', "not json at all"]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      fixture.identity,
      fixture.text,
    );

    expect(read.status).toBe("rejected");
    expect(calls).toHaveLength(2);

    await facts.saveFromResume(userId, read.facts);

    expect(await savedFacts(facts, userId)).toEqual({
      email: fixture.identity.email,
      legal_name: fixture.identity.name,
    });

    const usage = db.select().from(llmUsage).all();

    expect(usage).toHaveLength(2);
    expect(usage.every((row) => row.purpose === RESUME_FACTS_PURPOSE)).toBe(true);
  });

  test("keeps the reply when the retry after a schema miss is valid", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("09-japanese-docx");
    const { calls, llm } = scriptedLlm(["{}", JSON.stringify(fixture.extraction)]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      fixture.identity,
      fixture.text,
    );

    expect(read.status).toBe("extracted");
    expect(calls).toHaveLength(2);

    await facts.saveFromResume(userId, read.facts);

    expect(await savedFacts(facts, userId)).toEqual(fixture.facts);
  });

  test("a reply that never arrives stores only what the signup already knows", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("07-missing-email");
    const { calls, llm } = scriptedLlm([new Error("network down"), new Error("network down")]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      fixture.identity,
      fixture.text,
    );

    expect(read.status).toBe("unavailable");
    expect(calls).toHaveLength(2);

    await facts.saveFromResume(userId, read.facts);

    expect(await savedFacts(facts, userId)).toEqual({
      email: fixture.identity.email,
      legal_name: fixture.identity.name,
    });
    expect(db.select().from(llmUsage).all()).toHaveLength(0);
  });

  test("spends nothing when the spend gate refuses the user", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("01-header-contact-line");
    const { calls, llm } = scriptedLlm([JSON.stringify(fixture.extraction)]);

    const read = await createResumeFactsReader({
      clock,
      db,
      llm,
      spendGate: { allows: () => false, gated: true },
    }).read(userId, fixture.identity, fixture.text);

    expect(read.status).toBe("skipped");
    expect(calls).toHaveLength(0);

    await facts.saveFromResume(userId, read.facts);

    expect(await savedFacts(facts, userId)).toEqual({
      email: fixture.identity.email,
      legal_name: fixture.identity.name,
    });
    expect(db.select().from(llmUsage).all()).toHaveLength(0);
  });

  test("does not use an email local part as the person's legal name", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("07-missing-email");

    const { llm } = scriptedLlm([
      JSON.stringify({
        ...fixture.extraction,
        firstName: null,
        lastName: null,
      }),
    ]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      { email: "new.person@example.com", name: "new.person" },
      fixture.text,
    );

    await facts.saveFromResume(userId, read.facts);

    const saved = await savedFacts(facts, userId);

    expect(saved.legal_name).toBeUndefined();
    expect(saved.email).toBe("new.person@example.com");
  });

  test("ignores an instruction written inside the resume", async () => {
    const { clock, db, facts, userId } = freshFacts();
    const fixture = resumeFixture("17-injected-instruction");
    const { llm } = scriptedLlm([JSON.stringify(fixture.extraction)]);

    const read = await createResumeFactsReader({ clock, db, llm }).read(
      userId,
      fixture.identity,
      fixture.text,
    );

    await facts.saveFromResume(userId, read.facts);

    const saved = await savedFacts(facts, userId);

    expect(saved.years_total).toBe("5");
    expect(saved.degree_highest).toBeUndefined();
  });

  test("reads every committed resume fixture to its declared Facts", async () => {
    const { clock, db, facts } = freshFacts();
    const fixtures = resumeFixtures();

    expect(fixtures).toHaveLength(20);

    const results = await Promise.all(
      fixtures.map(async (fixture, index) => {
        const userId = `fixture-user-${String(index)}`;

        db.insert(users)
          .values({
            id: userId,
            name: fixture.identity.name,
            email: fixture.identity.email,
            emailVerified: true,
            createdAt: new Date(clock.now()),
            updatedAt: new Date(clock.now()),
          })
          .run();

        const { llm } = scriptedLlm([JSON.stringify(fixture.extraction)]);

        const read = await createResumeFactsReader({ clock, db, llm }).read(
          userId,
          fixture.identity,
          fixture.text,
        );

        await facts.saveFromResume(userId, read.facts);

        return {
          expected: fixture.facts,
          notes: fixture.notes,
          read,
          saved: await savedFacts(facts, userId),
        };
      }),
    );

    for (const result of results) {
      expect(result.read.status).toBe("extracted");
      expect({ facts: result.saved, slug: result.notes }).toEqual({
        facts: result.expected,
        slug: result.notes,
      });
    }
  });
});

describe("a Fact's scope", () => {
  test("keeps a salary Fact once per currency", async () => {
    const { facts, userId } = freshFacts();

    await facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CAD");
    await facts.save(userId, "salary_expectation", "USD 95,000 a year", "USD");

    const saved = await facts.list(userId);

    expect(saved.map((record) => [record.scope, record.value])).toEqual([
      ["CAD", "CAD 140,000 a year"],
      ["USD", "USD 95,000 a year"],
    ]);
  });

  test("rejects a scope the Fact's key does not use", async () => {
    const { facts, userId } = freshFacts();

    expect(
      await rejectionOf(facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CA")),
    ).toBe("unknown currency scope: CA");

    expect(await rejectionOf(facts.save(userId, "work_auth", "Citizen", "CAD"))).toBe(
      "unknown country scope: CAD",
    );

    expect(await rejectionOf(facts.save(userId, "current_job_title", "Engineer", "CA"))).toBe(
      "fact key current_job_title is not scoped by country",
    );
  });

  test("removes one scope, or every scope, of a key", async () => {
    const { facts, userId } = freshFacts();

    await facts.save(userId, "salary_expectation", "CAD 140,000 a year", "CAD");
    await facts.save(userId, "salary_expectation", "USD 95,000 a year", "USD");

    expect(await facts.remove(userId, "salary_expectation", "USD")).toBe(1);
    expect((await facts.list(userId)).map((record) => record.scope)).toEqual(["CAD"]);

    expect(await facts.remove(userId, "salary_expectation")).toBe(1);
    expect(await facts.list(userId)).toEqual([]);
  });
});

describe("confirming a value the resume reader found", () => {
  test("keeps the resume source and its revision when the value is unchanged", async () => {
    const { facts, userId } = freshFacts();

    await facts.saveFromResume(userId, [{ key: "legal_name", scope: "", value: "Maya Okafor" }]);

    const [before] = await facts.list(userId);
    const confirmed = await facts.confirm(userId, "legal_name", "Maya Okafor");

    expect(confirmed).toMatchObject({
      confirmed: true,
      revision: before?.revision,
      source: "resume",
      value: "Maya Okafor",
    });
  });

  test("records an edited value as the person's own", async () => {
    const { facts, userId } = freshFacts();

    await facts.saveFromResume(userId, [{ key: "legal_name", scope: "", value: "Maya Okafor" }]);

    const confirmed = await facts.confirm(userId, "legal_name", "Maya Chen");

    expect(confirmed).toMatchObject({
      confirmed: true,
      source: "user",
      value: "Maya Chen",
    });
  });
});

describe("a Fact write the other tab must see", () => {
  test("publishes a profile topic when a Fact changes", async () => {
    const { db, facts, userId } = freshFacts();

    await facts.save(userId, "work_auth", "Citizen", "CA");

    const published = db.select().from(events).all();

    expect(published.map((row) => row.topic)).toEqual(["profile.updated"]);
    expect(published[0]?.userId).toBe(userId);
  });

  test("publishes when a Fact is removed, but not when nothing was stored", async () => {
    const { db, facts, userId } = freshFacts();

    await facts.save(userId, "work_auth", "Citizen", "CA");
    expect(await facts.remove(userId, "work_auth", "CA")).toBe(1);
    expect(await facts.remove(userId, "work_auth", "CA")).toBe(0);

    const published = db
      .select()
      .from(events)
      .all()
      .filter((row) => row.topic === "profile.updated");

    expect(published).toHaveLength(2);
  });
});
