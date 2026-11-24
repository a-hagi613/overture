import { expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { grants, users } from "../db/schema.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { scaledBudget } from "../budgets.ts";
import { setSetting } from "../settings/index.ts";

import {
  DEFAULT_SPEND_ALERT_RATIO,
  llmDayBudget,
  llmSpendAlertRatio,
  llmSubscriberUserDayBudgetMicros,
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

test("the global daily budget is the base with no paying subscribers", () => {
  const budget = llmDayBudget(memoryDatabase(), AT);

  expect(budget).toEqual({
    baseMicros: 10_000_000,
    budgetMicros: 10_000_000,
    perSubscriberMicros: 300_000,
    subscribers: 0,
  });
});

test("the global daily budget grows by the subscriber share for every paying subscriber", () => {
  const db = memoryDatabase();

  addGrant(db, "paying-1", "period");
  addGrant(db, "paying-2", "period");

  expect(llmDayBudget(db, AT)).toMatchObject({
    baseMicros: 10_000_000,
    budgetMicros: 10_000_000 + 2 * 300_000,
    subscribers: 2,
  });
});

test("admin, trial and ended periods never grow a budget", () => {
  const db = memoryDatabase();

  addGrant(db, "invited", "admin", null);
  addGrant(db, "trialing", "trial");
  addGrant(db, "lapsed", "period", AT - 1);

  expect(llmDayBudget(db, AT).subscribers).toBe(0);
});

test("a person's overlapping periods count once so a plan switch cannot double the budget", () => {
  const db = memoryDatabase();

  addGrant(db, "paying", "period");
  addGrant(db, "paying", "period", AT + 7 * DAY_MS);

  expect(llmDayBudget(db, AT).subscribers).toBe(1);
});

test("a paying subscriber's own daily budget is raised above the invited-user floor", () => {
  const db = memoryDatabase();

  addGrant(db, "paying", "period");

  expect(llmUserDayBudgetMicros(db, "paying", AT)).toBe(500_000);
  expect(llmUserDayBudgetMicros(db, "invited", AT)).toBe(250_000);
});

test("an admin sets the subscriber shares and the alert ratio", () => {
  const db = memoryDatabase();

  setSetting(db, clock, "llm.cap_per_subscriber_day_usd", "1.5", "test");
  setSetting(db, clock, "llm.cap_subscriber_user_day_usd", "0.75", "test");
  setSetting(db, clock, "llm.spend_alert_ratio", "0.5", "test");
  addGrant(db, "paying", "period");

  expect(llmDayBudget(db, AT).budgetMicros).toBe(10_000_000 + 1_500_000);
  expect(llmUserDayBudgetMicros(db, "paying", AT)).toBe(1_000_000);
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

test("the micros global override becomes the base the subscriber share is added to", () => {
  const db = memoryDatabase();

  setSetting(db, clock, "llm.daily_spend_cap_micros", "20000000", "test");
  addGrant(db, "paying", "period");

  expect(llmDayBudget(db, AT)).toMatchObject({
    baseMicros: 20_000_000,
    budgetMicros: 20_000_000 + 300_000,
  });
});

test("scaling clamps negative inputs instead of shrinking a budget", () => {
  expect(scaledBudget(-5, 300_000, 2)).toBe(600_000);
  expect(scaledBudget(10_000_000, -1, 2)).toBe(10_000_000);
  expect(scaledBudget(10_000_000, 300_000, -2)).toBe(10_000_000);
});

test("the paying subscriber's user budget is reported beside the invited-user base", () => {
  expect(llmSubscriberUserDayBudgetMicros(memoryDatabase())).toBe(500_000);
});
