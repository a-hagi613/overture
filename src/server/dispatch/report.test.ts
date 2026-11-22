import { describe, expect, test } from "bun:test";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { DEFAULT_ANTHROPIC_MODEL, batchPricesFor } from "../platform/llm/models.ts";
import { applications, attempts, llmUsage, users } from "../platform/db/schema.ts";

import type { ProviderReportRow } from "./report.ts";

Bun.env.BETTER_AUTH_SECRET ??= "report-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "report-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "report-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { buildCostSummary, buildProviderReport } = await import("./report.ts");

const DAY_MS = 86_400_000;

type AttemptOutcome = NonNullable<(typeof attempts.$inferInsert)["outcome"]>;

function batchMicros(inputTokens: number, cachedTokens: number, outputTokens: number) {
  const prices = batchPricesFor(DEFAULT_ANTHROPIC_MODEL);

  return Math.ceil(
    (inputTokens * prices.inputPerMillionTokens +
      cachedTokens * prices.cacheReadPerMillionTokens +
      outputTokens * prices.outputPerMillionTokens) /
      1_000_000,
  );
}

function freshReport() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = clock.now();

  const addUser = (id: string, role: "owner" | "user" | "demo") => {
    db.insert(users)
      .values({
        createdAt: new Date(at),
        email: `${id}@example.com`,
        emailVerified: true,
        id,
        name: id,
        role,
        updatedAt: new Date(at),
      })
      .run();
  };

  addUser("user-a", "owner");
  addUser("user-b", "user");
  addUser("user-demo", "demo");

  const addApplication = (input: {
    ats: "greenhouse" | "lever";
    id: string;
    status: "sent" | "failed" | "confirming";
    userId: string;
  }) => {
    const companyId = input.ats === "greenhouse" ? "company-gh" : "company-lever";

    db.insert(applications)
      .values({
        ats: input.ats,
        companyId,
        companyName: "Engineer Co",
        companyNameNorm: "engineer co",
        createdAt: at,
        id: input.id,
        origin: "auto",
        postingId: `posting-${input.id}`,
        postingTitle: "Engineer",
        postingUrl: `https://example.test/jobs/${input.id}`,
        status: input.status,
        updatedAt: at,
        userId: input.userId,
      })
      .run();
  };

  const addAttempt = (input: {
    applicationId: string;
    browserMs?: number;
    costMicros: number;
    outcome: AttemptOutcome;
    provider?: "browser_use" | "kernel";
    proxyBytes?: number;
    startedAt: number;
    userId: string;
  }) => {
    db.insert(attempts)
      .values({
        applicationId: input.applicationId,
        browserMs: input.browserMs ?? 60_000,
        captchaSeen: false,
        codeUsed: false,
        costMicros: input.costMicros,
        id: crypto.randomUUID(),
        leaseUntil: input.startedAt + 15 * 60_000,
        n: 1,
        outcome: input.outcome,
        provider: input.provider ?? "browser_use",
        proxyBytes: input.proxyBytes ?? 1_000_000,
        startedAt: input.startedAt,
        userId: input.userId,
      })
      .run();
  };

  const addLlmUsage = (input: {
    cachedTokens?: number;
    createdAt: number;
    id: string;
    inputTokens?: number;
    outputTokens?: number;
    purpose?: string;
    userId: string | null;
  }) => {
    const cachedTokens = input.cachedTokens ?? 0;
    const inputTokens = input.inputTokens ?? 1000;
    const outputTokens = input.outputTokens ?? 100;
    const costMicros = batchMicros(inputTokens, cachedTokens, outputTokens);

    db.insert(llmUsage)
      .values({
        cachedTokens,
        costMicros,
        createdAt: input.createdAt,
        id: input.id,
        inputTokens,
        model: DEFAULT_ANTHROPIC_MODEL,
        outputTokens,
        purpose: input.purpose ?? "score",
        userId: input.userId,
      })
      .run();

    return costMicros;
  };

  return { addApplication, addAttempt, addLlmUsage, at, clock, db, sqlite };
}

const rowFor = (rows: ProviderReportRow[], ats: "greenhouse" | "lever") => {
  const row = rows.find((candidate) => candidate.ats === ats);

  if (row === undefined) {
    throw new Error(`no ${ats} row`);
  }

  return row;
};

describe("the provider report's product measure", () => {
  test("a failure-then-success retry on one Application is one completed Application, not two attempts", () => {
    const { addApplication, addAttempt, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-retry", status: "sent", userId: "user-a" });
    addAttempt({
      applicationId: "app-retry",
      costMicros: 20_000,
      outcome: "provider_error",
      startedAt: at - 2000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-retry",
      costMicros: 40_000,
      outcome: "sent",
      startedAt: at - 1000,
      userId: "user-a",
    });

    const row = rowFor(buildProviderReport(db, clock), "greenhouse");

    expect(row.attempted).toBe(1);
    expect(row.completed).toBe(1);
    expect(row.completionRate).toBe(1);
    expect(row.costMicrosPerCompleted).toBe(60_000);
    expect(row.attemptCount).toBe(2);
    expect(row.sentAttemptCount).toBe(1);
  });

  test("an email-confirmed send (the attempt never marked sent) is one completed Application", () => {
    const { addApplication, addAttempt, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-email", status: "sent", userId: "user-a" });
    addAttempt({
      applicationId: "app-email",
      costMicros: 25_000,
      outcome: "unconfirmed",
      startedAt: at - 1000,
      userId: "user-a",
    });

    const row = rowFor(buildProviderReport(db, clock), "greenhouse");
    const summary = buildCostSummary(db, clock);

    expect(row.attempted).toBe(1);
    expect(row.completed).toBe(1);
    expect(row.completionRate).toBe(1);
    expect(row.costMicrosPerCompleted).toBe(25_000);
    expect(row.attemptCount).toBe(1);
    expect(row.sentAttemptCount).toBe(0);
    expect(summary.completed).toBe(1);
    expect(summary.attempted).toBe(1);
    expect(summary.costMicrosPerCompleted).toBe(25_000);
  });

  test("counts distinct attempted Applications per provider and ATS, with attempts reported separately", () => {
    const { addApplication, addAttempt, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-gh-sent", status: "sent", userId: "user-a" });
    addApplication({ ats: "greenhouse", id: "app-gh-email", status: "sent", userId: "user-a" });
    addApplication({ ats: "lever", id: "app-lever-sent", status: "sent", userId: "user-a" });
    addApplication({ ats: "lever", id: "app-lever-failed", status: "failed", userId: "user-b" });
    addApplication({ ats: "greenhouse", id: "app-demo", status: "sent", userId: "user-demo" });

    addAttempt({
      applicationId: "app-gh-sent",
      costMicros: 20_000,
      outcome: "provider_error",
      startedAt: at - 5000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-gh-sent",
      costMicros: 30_000,
      outcome: "sent",
      startedAt: at - 4000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-gh-email",
      costMicros: 25_000,
      outcome: "unconfirmed",
      startedAt: at - 3000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-lever-sent",
      costMicros: 10_000,
      outcome: "sent",
      startedAt: at - 2000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-lever-failed",
      costMicros: 5000,
      outcome: "provider_error",
      startedAt: at - 1000,
      userId: "user-b",
    });
    addAttempt({
      applicationId: "app-demo",
      costMicros: 999_999,
      outcome: "sent",
      startedAt: at - 500,
      userId: "user-demo",
    });

    const rows = buildProviderReport(db, clock);
    const greenhouse = rowFor(rows, "greenhouse");
    const lever = rowFor(rows, "lever");

    expect(greenhouse.attempted).toBe(2);
    expect(greenhouse.completed).toBe(2);
    expect(greenhouse.completionRate).toBe(1);
    expect(greenhouse.attemptCount).toBe(3);
    expect(greenhouse.sentAttemptCount).toBe(1);
    expect(greenhouse.costMicrosPerCompleted).toBe(37_500);

    expect(lever.attempted).toBe(2);
    expect(lever.completed).toBe(1);
    expect(lever.completionRate).toBe(0.5);
    expect(lever.attemptCount).toBe(2);
    expect(lever.sentAttemptCount).toBe(1);
    expect(lever.costMicrosPerCompleted).toBe(15_000);

    const summary = buildCostSummary(db, clock);

    expect(summary.attempted).toBe(4);
    expect(summary.completed).toBe(3);
    expect(summary.browserMicros).toBe(90_000);
    expect(summary.costMicrosPerCompleted).toBe(30_000);
  });

  test("an Application retried on another provider stays one Application in the cost summary", () => {
    const { addApplication, addAttempt, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-switch", status: "sent", userId: "user-a" });
    addAttempt({
      applicationId: "app-switch",
      costMicros: 20_000,
      outcome: "provider_error",
      provider: "browser_use",
      startedAt: at - 2000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-switch",
      costMicros: 30_000,
      outcome: "sent",
      provider: "kernel",
      startedAt: at - 1000,
      userId: "user-a",
    });

    const summary = buildCostSummary(db, clock);

    expect(summary.attempted).toBe(1);
    expect(summary.completed).toBe(1);
    expect(summary.browserMicros).toBe(50_000);
    expect(summary.costMicrosPerCompleted).toBe(50_000);
  });

  test("an Application whose only tries were never attempted stays out of the population", () => {
    const { addApplication, addAttempt, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-closed", status: "failed", userId: "user-a" });
    addApplication({ ats: "greenhouse", id: "app-duplicate", status: "failed", userId: "user-a" });
    addAttempt({
      applicationId: "app-closed",
      costMicros: 12_000,
      outcome: "posting_closed",
      startedAt: at - 2000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-duplicate",
      costMicros: 13_000,
      outcome: "duplicate",
      startedAt: at - 1000,
      userId: "user-a",
    });

    expect(buildProviderReport(db, clock)).toEqual([]);
    expect(buildCostSummary(db, clock).completed).toBe(0);
    expect(buildCostSummary(db, clock).attempted).toBe(0);
  });
});

describe("the Anthropic share of cost per completed Application", () => {
  test("is split across provider groups by attempted Applications, using the metered batch rows", () => {
    const { addApplication, addAttempt, addLlmUsage, at, clock, db } = freshReport();

    addApplication({ ats: "greenhouse", id: "app-gh-sent", status: "sent", userId: "user-a" });
    addApplication({ ats: "greenhouse", id: "app-gh-email", status: "sent", userId: "user-a" });
    addApplication({ ats: "lever", id: "app-lever-sent", status: "sent", userId: "user-a" });
    addApplication({ ats: "lever", id: "app-lever-failed", status: "failed", userId: "user-b" });

    addAttempt({
      applicationId: "app-gh-sent",
      costMicros: 20_000,
      outcome: "provider_error",
      startedAt: at - 6000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-gh-sent",
      costMicros: 30_000,
      outcome: "sent",
      startedAt: at - 5000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-gh-email",
      costMicros: 25_000,
      outcome: "unconfirmed",
      startedAt: at - 4000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-lever-sent",
      costMicros: 10_000,
      outcome: "sent",
      startedAt: at - 3000,
      userId: "user-a",
    });
    addAttempt({
      applicationId: "app-lever-failed",
      costMicros: 5000,
      outcome: "provider_error",
      startedAt: at - 2000,
      userId: "user-b",
    });

    const userAMicros = addLlmUsage({
      cachedTokens: 1000,
      createdAt: at - 1500,
      id: "llm-a-score",
      inputTokens: 9000,
      outputTokens: 400,
      userId: "user-a",
    });

    const userBMicros = addLlmUsage({
      createdAt: at - 1000,
      id: "llm-b-score",
      inputTokens: 3000,
      outputTokens: 120,
      userId: "user-b",
    });

    addLlmUsage({
      createdAt: at - 1200,
      id: "llm-a-tag",
      purpose: "tag_fallback",
      userId: "user-a",
    });
    addLlmUsage({ createdAt: at - 500, id: "llm-demo-score", userId: "user-demo" });
    addLlmUsage({
      createdAt: at - 31 * DAY_MS,
      id: "llm-old-score",
      userId: "user-a",
    });

    expect(userAMicros).toBe(Math.ceil((9000 * 50_000 + 1000 * 5000 + 400 * 250_000) / 1_000_000));
    expect(userAMicros).toBe(555);
    expect(userBMicros).toBe(180);

    const rows = buildProviderReport(db, clock);
    const greenhouse = rowFor(rows, "greenhouse");
    const lever = rowFor(rows, "lever");

    expect(greenhouse.costMicrosPerCompleted).toBe((75_000 + 370) / 2);
    expect(lever.costMicrosPerCompleted).toBe(15_000 + 185 + 180);

    const summary = buildCostSummary(db, clock);

    expect(summary.anthropicMicros).toBe(userAMicros + userBMicros);
    expect(summary.browserMicros).toBe(90_000);
    expect(summary.attempted).toBe(4);
    expect(summary.completed).toBe(3);
    expect(summary.costMicrosPerCompleted).toBe((90_000 + userAMicros + userBMicros) / 3);
  });
});
