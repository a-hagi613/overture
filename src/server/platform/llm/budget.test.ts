import { expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { grants, users } from "../db/schema.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { setSetting } from "../settings/index.ts";

import {
  DEFAULT_SPEND_ALERT_RATIO,
  llmDayBudget,
  llmOnboardingMatchingBudgetMicros,
  llmSpendAlertRatio,
  llmUserDayBudgetMicros,
} from "./budget.ts";

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);
const DAY_MS = 24 * 60 * 60_000;

function memoryDatabase() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

const clock = { now: () => AT };

function addGrant(
  db: ReturnType<typeof memoryDatabase>,
  userId: string,
  source: "admin" | "period" | "trial",
  expiresAt: number | null = AT + DAY_MS,
) {
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
    .onConflictDoNothing()
    .run();

  db.insert(grants)
    .values({
      createdAt: AT,
      expiresAt,
      id: crypto.randomUUID(),
      quantity: 50,
      source,
      startsAt: AT - DAY_MS,
      userId,
    })
    .run();
}

test("the global daily budget is the fifty-dollar base with no subscribers", () => {
  const budget = llmDayBudget(memoryDatabase(), AT);

  expect(budget).toEqual({
    baseMicros: 50_000_000,
    budgetMicros: 50_000_000,
    perSubscriberMicros: 300_000,
    subscribers: 0,
  });
});

test("paying subscribers raise the global budget by the subscriber share", () => {
  const db = memoryDatabase();

  addGrant(db, "paying-1", "period");
  addGrant(db, "paying-2", "period");

  expect(llmDayBudget(db, AT)).toMatchObject({
    baseMicros: 50_000_000,
    budgetMicros: 50_000_000 + 2 * 300_000,
    perSubscriberMicros: 300_000,
    subscribers: 2,
  });
});

test("admin, trial and ended periods are never counted as paying subscribers", () => {
  const db = memoryDatabase();

  addGrant(db, "invited", "admin", null);
  addGrant(db, "trialing", "trial");
  addGrant(db, "lapsed", "period", AT - 1);

  expect(llmDayBudget(db, AT).subscribers).toBe(0);
});

test("a person's overlapping periods count once", () => {
  const db = memoryDatabase();

  addGrant(db, "paying", "period");
  addGrant(db, "paying", "period", AT + 7 * DAY_MS);

  expect(llmDayBudget(db, AT).subscribers).toBe(1);
});

test("every person has the same ten-cent daily budget", () => {
  const db = memoryDatabase();

  addGrant(db, "paying", "period");

  expect(llmUserDayBudgetMicros(db)).toBe(100_000);
});

test("the onboarding matching pool is a separate fifty-cent budget", () => {
  expect(llmOnboardingMatchingBudgetMicros(memoryDatabase())).toBe(500_000);
});

test("an admin sets the caps and the alert ratio", () => {
  const db = memoryDatabase();

  setSetting(db, clock, "llm.cap_global_day_usd", "75", "test");
  setSetting(db, clock, "llm.cap_user_day_usd", "0.40", "test");
  setSetting(db, clock, "llm.cap_onboarding_usd", "2.00", "test");
  setSetting(db, clock, "llm.cap_per_subscriber_day_usd", "1.50", "test");
  setSetting(db, clock, "llm.spend_alert_ratio", "0.5", "test");
  addGrant(db, "paying", "period");

  expect(llmDayBudget(db, AT).budgetMicros).toBe(75_000_000 + 1_500_000);
  expect(llmUserDayBudgetMicros(db)).toBe(400_000);
  expect(llmOnboardingMatchingBudgetMicros(db)).toBe(2_000_000);
  expect(llmSpendAlertRatio(db)).toBe(0.5);
});

test("an unusable alert ratio falls back to the documented share", () => {
  const db = memoryDatabase();

  expect(llmSpendAlertRatio(db)).toBe(DEFAULT_SPEND_ALERT_RATIO);

  setSetting(db, clock, "llm.spend_alert_ratio", "0", "test");

  expect(llmSpendAlertRatio(db)).toBe(DEFAULT_SPEND_ALERT_RATIO);

  setSetting(db, clock, "llm.spend_alert_ratio", "1.5", "test");

  expect(llmSpendAlertRatio(db)).toBe(DEFAULT_SPEND_ALERT_RATIO);
});

test("the micros global override still becomes the base", () => {
  const db = memoryDatabase();

  setSetting(db, clock, "llm.daily_spend_cap_micros", "20000000", "test");
  addGrant(db, "paying", "period");

  expect(llmDayBudget(db, AT)).toMatchObject({
    baseMicros: 20_000_000,
    budgetMicros: 20_000_000 + 300_000,
  });
});
