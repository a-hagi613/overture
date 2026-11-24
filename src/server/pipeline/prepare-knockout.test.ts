import { afterEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { eq } from "drizzle-orm";

import type { LlmPort } from "../platform/ports/llm.ts";

import { createFactService } from "../profile/facts.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { applications, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { masterKeyringFor } from "../platform/crypto.ts";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { createPreparationService } = await import("./prepare.ts");

const NOW = Date.UTC(2026, 10, 24, 9, 0);

const openHandles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
});

function countedLlm() {
  let calls = 0;

  const llm: LlmPort = {
    estimateBatchCostMicros: (requests) => requests.length * 1000,
    estimateSingleCostMicros: () => 0,
    runBatch: async (requests) => {
      calls += requests.length;

      await Promise.resolve();

      return [];
    },
    runSingle: async () => {
      calls += 1;

      await Promise.resolve();

      return {
        cachedTokens: 0,
        cacheWriteTokens: 0,
        costMicros: 0,
        inputTokens: 0,
        model: "fake",
        outputTokens: 0,
        text: null,
      };
    },
  };

  return { calls: () => calls, llm };
}

function freshApplication(postingDescription: string) {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  openHandles.push(app.sqlite, catalog.sqlite);

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "candidate@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Candidate",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  catalog.db
    .insert(companies)
    .values({ createdAt: NOW, id: "company-1", name: "Northwind", nameNorm: "northwind" })
    .run();

  catalog.db
    .insert(companyBoards)
    .values({
      ats: "lever",
      boardToken: "northwind",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();

  catalog.db
    .insert(postings)
    .values({
      applySupported: true,
      applyUrlNorm: "https://jobs.lever.co/northwind/j/1",
      ats: "lever",
      atsJobId: "job-1",
      boardId: "board-1",
      companyId: "company-1",
      countryCode: "US",
      dedupeKey: "lever:job-1",
      descriptionGz: gzipSync(Buffer.from(postingDescription, "utf8")),
      firstSeenAt: NOW,
      id: "posting-1",
      lastSeenAt: NOW,
      questionsFetchedAt: NOW,
      title: "Staff Engineer",
      titleNorm: "staff engineer",
      url: "https://jobs.lever.co/northwind/j/1",
    })
    .run();

  app.db
    .insert(applications)
    .values({
      ats: "lever",
      companyId: "company-1",
      companyName: "Northwind",
      companyNameNorm: "northwind",
      createdAt: NOW,
      id: "application-1",
      origin: "auto",
      postingId: "posting-1",
      postingTitle: "Staff Engineer",
      postingUrl: "https://jobs.lever.co/northwind/j/1",
      status: "preparing",
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();

  const clock = createClock();

  const personal = createPersonalCrypto(app.db, masterKeyringFor(new Uint8Array(32).fill(3)));

  const facts = createFactService({ clock, db: app.db, personal });

  const counted = countedLlm();

  const preparation = createPreparationService({
    catalogDb: catalog.db,
    clock,
    db: app.db,
    llm: counted.llm,
    personal,
    source: null,
  });

  return {
    app: app.db,
    clocks: clock,
    facts,
    llmCalls: counted.calls,
    preparation,
    userId: "user-1",
  };
}

function applicationRow(db: ReturnType<typeof openDatabase>["db"], id: string) {
  return db.select().from(applications).where(eq(applications.id, id)).get();
}

describe("the knock-out pre-scan in preparation", () => {
  test("skips an ineligible posting before any LLM call", async () => {
    const setup = freshApplication(
      "You must be authorized to work in the United States. We are unable to sponsor a visa.",
    );

    await setup.facts.save(setup.userId, "sponsorship_required", "Yes, I require sponsorship");

    const result = await setup.preparation.prepare("application-1");

    expect(result).toMatchObject({ status: "skipped", blocked: 0 });
    expect(setup.llmCalls()).toBe(0);

    const row = applicationRow(setup.app, "application-1");

    expect(row?.status).toBe("skipped");
    expect(row?.statusReason).toBe("knockout_sponsorship");
  });

  test("keeps preparing an eligible candidate on the same posting", async () => {
    const setup = freshApplication(
      "You must be authorized to work in the United States. We are unable to sponsor a visa.",
    );

    await setup.facts.save(setup.userId, "sponsorship_required", "No");

    const result = await setup.preparation.prepare("application-1");

    expect(result).toMatchObject({ status: "ready" });
    expect(applicationRow(setup.app, "application-1")?.statusReason).not.toStartWith("knockout");
  });
});
