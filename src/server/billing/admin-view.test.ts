import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { applications, attempts, llmUsage, profiles, users } from "../platform/db/schema.ts";

import { grantApplications } from "./ledger.ts";

Bun.env.BETTER_AUTH_SECRET ??= "admin-view-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "admin-view-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "admin-view-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { billingUsersPage, marginAdminView } = await import("./admin-view.ts");
const { buildMarginReport } = await import("./margin.ts");
const { recordApplicationVariableCosts } = await import("../dispatch/application-cost.ts");
const { APPLICATION_LLM_PURPOSES } = await import("../dispatch/application-spend.ts");

const DAY_MS = 24 * 60 * 60_000;

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(
  db: ReturnType<typeof database>["db"],
  input: { id: string; pauseReason?: "payment_failed" | null },
) {
  const at = new Date(input.id.length * 1000);

  db.insert(users)
    .values({
      createdAt: at,
      email: `${input.id}@example.com`,
      emailVerified: true,
      id: input.id,
      name: input.id,
      role: "user",
      updatedAt: at,
    })
    .run();

  db.insert(profiles)
    .values({
      createdAt: at,
      languages: "[]",
      pauseReason: input.pauseReason ?? null,
      running: true,
      timezone: "UTC",
      updatedAt: at,
      userId: input.id,
    })
    .run();
}

describe("the admin billing list", () => {
  test("filters and pages in SQL while keeping the stat counts", () => {
    const { db, sqlite } = database();
    const clock = createClock();
    const at = clock.now();

    addUser(db, { id: "alpha" });
    addUser(db, { id: "bravo" });
    addUser(db, { id: "charlie" });
    addUser(db, { id: "delta" });
    addUser(db, { id: "echo", pauseReason: "payment_failed" });

    grantApplications(db, clock, {
      expiresAt: at + 20 * DAY_MS,
      idempotencyKey: "grant:alpha",
      quantity: 250,
      source: "period",
      userId: "alpha",
    });
    grantApplications(db, clock, {
      idempotencyKey: "grant:bravo",
      quantity: 3,
      source: "trial",
      userId: "bravo",
    });
    grantApplications(db, clock, {
      expiresAt: at + 3 * DAY_MS,
      idempotencyKey: "grant:charlie",
      quantity: 50,
      source: "period",
      userId: "charlie",
    });
    grantApplications(db, clock, {
      expiresAt: at - 1000,
      idempotencyKey: "grant:delta",
      quantity: 50,
      source: "period",
      userId: "delta",
    });
    grantApplications(db, clock, {
      idempotencyKey: "grant:echo",
      quantity: 3,
      source: "trial",
      userId: "echo",
    });

    const paying = billingUsersPage(db, clock, { filter: "paying", page: 1 });

    expect(paying.total).toBe(2);
    expect(paying.users.map((user) => user.id)).toEqual(["alpha", "charlie"]);
    expect(paying.users.map((user) => user.state)).toEqual(["paying", "ending"]);

    const trial = billingUsersPage(db, clock, { filter: "trial", page: 1 });

    expect(trial.total).toBe(1);
    expect(trial.users[0]?.id).toBe("bravo");

    const paused = billingUsersPage(db, clock, { filter: "paused", page: 1 });

    expect(paused.users.map((user) => user.id)).toEqual(["echo"]);

    const ended = billingUsersPage(db, clock, { filter: "ended", page: 1 });

    expect(ended.users.map((user) => user.id)).toEqual(["delta"]);

    const all = billingUsersPage(db, clock, { filter: "all", page: 1 });

    expect(all.total).toBe(5);
    expect(all.users.map((user) => user.id)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
    expect(all.counts).toEqual({ endingSoon: 1, onTrial: 1, paused: 1, paying: 2 });

    sqlite.close();
  });
});

function sentApplication(
  db: ReturnType<typeof database>["db"],
  input: { at: number; id: string; userId: string },
) {
  db.insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company",
      companyName: "Engineer Co",
      companyNameNorm: "engineer co",
      createdAt: input.at,
      id: input.id,
      origin: "auto",
      postingId: `posting-${input.id}`,
      postingTitle: "Engineer",
      postingUrl: `https://example.test/jobs/${input.id}`,
      sentAt: input.at,
      status: "sent",
      updatedAt: input.at,
      userId: input.userId,
    })
    .run();
}

function paidWithActualCost() {
  const { db, sqlite } = database();
  const clock = createClock();
  const at = clock.now();

  addUser(db, { id: "alpha" });
  grantApplications(db, clock, {
    expiresAt: at + 20 * DAY_MS,
    idempotencyKey: "grant:alpha",
    quantity: 250,
    source: "period",
    userId: "alpha",
  });
  sentApplication(db, { at, id: "app-a", userId: "alpha" });

  const outcomes = ["captcha_blocked", "sent"] as const;

  for (const [index, outcome] of outcomes.entries()) {
    db.insert(attempts)
      .values({
        applicationId: "app-a",
        browserMs: 60_000,
        captchaSeen: false,
        codeUsed: false,
        costMicros: index === 0 ? 5000 : 3000,
        id: `try-${String(index)}`,
        leaseUntil: at,
        n: index + 1,
        outcome,
        provider: "browser_use",
        startedAt: at - 60_000 + index,
        userId: "alpha",
      })
      .run();
  }

  db.insert(llmUsage)
    .values({
      cachedTokens: 0,
      costMicros: 4000,
      createdAt: at,
      id: "llm-1",
      inputTokens: 100,
      model: "claude-sonnet-5",
      outputTokens: 100,
      purpose: APPLICATION_LLM_PURPOSES[0],
      userId: "alpha",
    })
    .run();

  recordApplicationVariableCosts(db, { at, userId: "alpha" });

  return { clock, sqlite, view: marginAdminView(buildMarginReport(db, clock)) };
}

describe("the admin margin view", () => {
  test("compares the stored per-Application cost with both paid plan baselines", () => {
    const { sqlite, view } = paidWithActualCost();

    expect(view.actual).toEqual({
      applications: 1,
      browserMicrosPerApplication: 3000,
      llmMicrosPerApplication: 4000,
      retryMicrosPerApplication: 5000,
      totalMicrosPerApplication: 12_000,
    });

    expect(view.comparison).toEqual([
      {
        actualMicrosPerApplication: 12_000,
        applications: 250,
        costShareOfNetRevenue: 12_000 / 114_440,
        marginMicrosPerApplication: 102_440,
        netRevenueMicrosPerApplication: 114_440,
        plan: "month",
      },
      {
        actualMicrosPerApplication: 12_000,
        applications: 50,
        costShareOfNetRevenue: 12_000 / 186_600,
        marginMicrosPerApplication: 174_600,
        netRevenueMicrosPerApplication: 186_600,
        plan: "week",
      },
    ]);

    sqlite.close();
  });

  test("keeps the whole measured report beside the comparison", () => {
    const { view } = paidWithActualCost();

    expect(view.windowDays).toBe(30);
    expect(view.completed).toBe(1);
    expect(view.plans.map((row) => row.plan)).toEqual(["trial", "week", "month"]);
    expect(view.plans.find((row) => row.plan === "month")?.actual?.totalMicrosPerApplication).toBe(
      12_000,
    );
    expect(view.beside.fixedInfraMicrosPerMonth).toBe(20_760_000);
  });

  test("reports the baselines with an unknown cost before anything is measured", () => {
    const { db, sqlite } = database();
    const clock = createClock();
    const view = marginAdminView(buildMarginReport(db, clock));

    expect(view.actual).toBeNull();
    expect(view.comparison.map((row) => row.plan)).toEqual(["month", "week"]);
    expect(view.comparison.every((row) => row.actualMicrosPerApplication === null)).toBe(true);

    sqlite.close();
  });
});
