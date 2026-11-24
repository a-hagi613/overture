import { expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { subscriptions, users } from "../platform/db/schema.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";

import {
  currentSubscriptionOf,
  recordSubscription,
  subscriptionBlocksCheckout,
  subscriptionEnded,
} from "./subscriptions.ts";

const AT = Date.UTC(2026, 10, 21, 9, 0, 0);
const DAY_MS = 24 * 60 * 60_000;

function memoryDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function addUser(db: ReturnType<typeof memoryDatabase>["db"], userId: string) {
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
}

function record(
  db: ReturnType<typeof memoryDatabase>["db"],
  input: {
    stripeSubscriptionId: string;
    status: string;
    userId: string;
    eventCreatedAtMs?: number;
    promoteToActive?: boolean;
  },
) {
  return recordSubscription(db, AT, {
    cancelAtPeriodEnd: false,
    currentPeriodEndMs: AT + 30 * DAY_MS,
    currentPeriodStartMs: AT,
    defaultStatus: input.status,
    eventCreatedAtMs: input.eventCreatedAtMs ?? AT,
    plan: "month",
    promoteToActive: input.promoteToActive ?? false,
    status: input.status,
    stripeSubscriptionId: input.stripeSubscriptionId,
    subscriptionEvent: true,
    userId: input.userId,
  });
}

test("only an incomplete or ended subscription leaves Checkout open", () => {
  for (const status of ["active", "trialing", "past_due", "unpaid"]) {
    expect(subscriptionBlocksCheckout(status)).toBe(true);
  }

  expect(subscriptionBlocksCheckout("incomplete")).toBe(false);
  expect(subscriptionBlocksCheckout("canceled")).toBe(false);
  expect(subscriptionBlocksCheckout("incomplete_expired")).toBe(false);
  expect(subscriptionEnded("canceled")).toBe(true);
  expect(subscriptionEnded("active")).toBe(false);
});

test("a running subscription blocks a second Checkout, so one account never pays twice", () => {
  const { db, sqlite } = memoryDatabase();

  try {
    addUser(db, "user-1");
    record(db, { status: "active", stripeSubscriptionId: "sub_1", userId: "user-1" });

    const current = currentSubscriptionOf(db, "user-1");

    expect(current).toMatchObject({ plan: "month", status: "active" });
    expect(current !== null && subscriptionBlocksCheckout(current.status)).toBe(true);
  } finally {
    sqlite.close();
  }
});

test("a canceled subscription no longer blocks Checkout", () => {
  const { db, sqlite } = memoryDatabase();

  try {
    addUser(db, "user-1");
    record(db, { status: "canceled", stripeSubscriptionId: "sub_1", userId: "user-1" });

    const current = currentSubscriptionOf(db, "user-1");

    expect(current).toMatchObject({ status: "canceled" });
    expect(current !== null && subscriptionBlocksCheckout(current.status)).toBe(false);
  } finally {
    sqlite.close();
  }
});

test("the same Stripe subscription updates one row instead of adding a second", () => {
  const { db, sqlite } = memoryDatabase();

  try {
    addUser(db, "user-1");
    record(db, { status: "active", stripeSubscriptionId: "sub_1", userId: "user-1" });
    record(db, {
      eventCreatedAtMs: AT + 1000,
      status: "past_due",
      stripeSubscriptionId: "sub_1",
      userId: "user-1",
    });

    expect(db.select().from(subscriptions).all().length).toBe(1);
    expect(currentSubscriptionOf(db, "user-1")).toMatchObject({ status: "past_due" });
  } finally {
    sqlite.close();
  }
});

test("an ended subscription is never resurrected by a later event", () => {
  const { db, sqlite } = memoryDatabase();

  try {
    addUser(db, "user-1");
    record(db, { status: "canceled", stripeSubscriptionId: "sub_1", userId: "user-1" });

    const resumed = recordSubscription(db, AT + 2000, {
      cancelAtPeriodEnd: null,
      currentPeriodEndMs: AT + 30 * DAY_MS,
      currentPeriodStartMs: AT,
      defaultStatus: "active",
      eventCreatedAtMs: AT + 2000,
      plan: "month",
      promoteToActive: true,
      status: null,
      stripeSubscriptionId: "sub_1",
      subscriptionEvent: false,
      userId: "user-1",
    });

    expect(resumed).toBeNull();
    expect(currentSubscriptionOf(db, "user-1")).toMatchObject({ status: "canceled" });
  } finally {
    sqlite.close();
  }
});

test("a second subscription for the same person never replaces the running one", () => {
  const { db, sqlite } = memoryDatabase();

  try {
    addUser(db, "user-1");
    record(db, { status: "active", stripeSubscriptionId: "sub_1", userId: "user-1" });

    record(db, { status: "incomplete", stripeSubscriptionId: "sub_2", userId: "user-1" });

    expect(currentSubscriptionOf(db, "user-1")).toMatchObject({ status: "active" });
  } finally {
    sqlite.close();
  }
});
