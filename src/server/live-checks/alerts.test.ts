import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { grants, users } from "../platform/db/schema.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { setSetting } from "../platform/settings/index.ts";

Bun.env.BETTER_AUTH_SECRET ??= "alerts-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "alerts-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "alerts-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { llmDayBudget } = await import("../platform/llm/budget.ts");
const { drillAlertMetrics, evaluateAlerts } = await import("./alerts.ts");

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);
const DAY_MS = 24 * 60 * 60_000;

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

const clock = { now: () => AT };

function addPeriod(db: ReturnType<typeof freshDatabase>["db"], userId: string) {
  db.insert(users)
    .values({
      createdAt: new Date(AT),
      email: `${userId}@example.com`,
      emailVerified: true,
      id: userId,
      name: userId,
      role: "user",
      updatedAt: new Date(AT),
    })
    .run();

  db.insert(grants)
    .values({
      createdAt: AT,
      expiresAt: AT + DAY_MS,
      id: crypto.randomUUID(),
      quantity: 50,
      source: "period",
      startsAt: AT - DAY_MS,
      userId,
    })
    .run();
}

function llmSpendRaised(db: ReturnType<typeof freshDatabase>["db"], spentMicros: number) {
  const budget = llmDayBudget(db, AT);

  const result = evaluateAlerts(db, clock, {
    ...drillAlertMetrics(),
    atsSuccess: [],
    backupLagSeconds: 0,
    backupReplication: "ok",
    catalogWorkerCrashes: 0,
    codeChallenge: { attempted: 0, challengeRate: 0, codeRate: 0 },
    disk: { mount: "/", usedRatio: 0.1 },
    health: true,
    llmSpend: [
      {
        cap: "global",
        capMicros: budget.budgetMicros,
        spentMicros,
        subscribers: budget.subscribers,
      },
    ],
    mailHealth: { domain: { replies: 0, sent: 0 }, employers: [] },
    providerSuccess: [],
    queueOldestAgeMs: 0,
    unhandledRejections: 0,
  });

  return result.raised.includes("llm.spend");
}

test("the soft alert fires at the default 80 % share of the daily budget", () => {
  const { db, sqlite } = freshDatabase();

  try {
    expect(llmSpendRaised(db, 8_500_000)).toBe(true);
    expect(llmSpendRaised(db, 7_900_000)).toBe(false);
  } finally {
    sqlite.close();
  }
});

test("a budget grown by paying subscribers no longer alerts at the old ceiling's share", () => {
  const { db, sqlite } = freshDatabase();

  try {
    expect(llmSpendRaised(db, 8_400_000)).toBe(true);

    addPeriod(db, "paying-1");
    addPeriod(db, "paying-2");

    expect(llmSpendRaised(db, 8_400_000)).toBe(false);
    expect(llmSpendRaised(db, 8_500_000)).toBe(true);
  } finally {
    sqlite.close();
  }
});

test("the admin sets the alert share", () => {
  const { db, sqlite } = freshDatabase();

  try {
    setSetting(db, clock, "llm.spend_alert_ratio", "0.5", "test");

    expect(llmSpendRaised(db, 5_100_000)).toBe(true);
    expect(llmSpendRaised(db, 4_900_000)).toBe(false);
  } finally {
    sqlite.close();
  }
});

test("a full-share alert fires when spend reaches the budget exactly", () => {
  const { db, sqlite } = freshDatabase();

  try {
    setSetting(db, clock, "llm.spend_alert_ratio", "1", "test");

    expect(llmSpendRaised(db, 9_900_000)).toBe(false);
    expect(llmSpendRaised(db, 10_000_000)).toBe(true);
  } finally {
    sqlite.close();
  }
});
