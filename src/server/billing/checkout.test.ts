import { describe, expect, test } from "bun:test";

import type { CheckoutSessionRequest, Payments } from "../platform/ports/payments.ts";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { createClock } from "../platform/ports/clock.ts";
import { customers, users } from "../platform/db/schema.ts";

import {
  checkoutIdempotencyKey,
  CHECKOUT_BUCKET_MS,
  createCheckoutCoordinator,
} from "./checkout.ts";
import { linkStripeCustomer } from "./customers.ts";

const USER_ID = "user-1";

async function afterAwait<T>(value: T) {
  await Promise.resolve();

  return value;
}

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const now = createClock().now();

  db.insert(users)
    .values({
      createdAt: new Date(now),
      email: "owner@example.com",
      emailVerified: true,
      id: USER_ID,
      name: "Owner",
      role: "user",
      updatedAt: new Date(now),
    })
    .run();

  return { db, sqlite };
}

function fakePayments(calls: CheckoutSessionRequest[], gate?: Promise<undefined>) {
  return {
    createCheckoutSession: async (request: CheckoutSessionRequest) => {
      calls.push(request);

      if (gate !== undefined) {
        await gate;
      }

      return { id: `cs_${String(calls.length)}`, url: "https://checkout.stripe.test/cs" };
    },
    createPortalSession: async () =>
      afterAwait({ id: "ps_1", url: "https://portal.stripe.test/ps" }),
    createSetupSession: async () =>
      afterAwait({ id: "cs_setup", url: "https://checkout.stripe.test/setup" }),
    listPaidInvoices: async () => afterAwait([]),
    listRefunds: async () => afterAwait([]),
    refundInvoice: async () => afterAwait({ amountCents: 0, id: "re_1", status: "succeeded" }),
    retrieveVerifiedCard: async () => afterAwait(null),
    verifyWebhook: async () => {
      await Promise.resolve();

      throw new Error("not used");
    },
  } satisfies Payments;
}

const input = {
  cancelUrl: "https://overture.test/profile/billing?billing=cancelled",
  email: "owner@example.com",
  plan: "month" as const,
  priceId: "price_month",
  successUrl: "https://overture.test/profile/billing?billing=success",
  userId: USER_ID,
};

describe("checkout idempotency", () => {
  test("concurrent double clicks share one Checkout Session and one idempotency key", async () => {
    const { db, sqlite } = database();
    const clock = createClock();
    const calls: CheckoutSessionRequest[] = [];
    const gate = Promise.withResolvers<undefined>();

    const coordinator = createCheckoutCoordinator({
      clock,
      db,
      payments: fakePayments(calls, gate.promise),
    });

    const [first, second] = [coordinator.create(input), coordinator.create(input)];

    expect(calls).toHaveLength(1);
    gate.resolve(undefined);

    const sessions = await Promise.all([first, second]);

    expect(sessions[0]).toEqual(sessions[1]);
    expect(calls[0]?.idempotencyKey).toBe(checkoutIdempotencyKey(USER_ID, "month", clock.now()));

    sqlite.close();
  });

  test("the linked Stripe Customer is reused by a later attempt", async () => {
    const { db, sqlite } = database();
    const clock = createClock();
    const calls: CheckoutSessionRequest[] = [];

    linkStripeCustomer(db, { at: clock.now(), stripeCustomerId: "cus_linked", userId: USER_ID });

    const coordinator = createCheckoutCoordinator({
      clock,
      db,
      payments: fakePayments(calls),
    });

    await coordinator.create(input);

    expect(calls[0]?.customerId).toBe("cus_linked");
    expect(db.select().from(customers).all()).toHaveLength(1);

    sqlite.close();
  });

  test("a new time bucket gets a different key", () => {
    const now = Date.UTC(2026, 10, 23, 9, 0, 0);

    expect(checkoutIdempotencyKey(USER_ID, "week", now)).toBe(
      checkoutIdempotencyKey(USER_ID, "week", now + CHECKOUT_BUCKET_MS - 1),
    );
    expect(checkoutIdempotencyKey(USER_ID, "week", now)).not.toBe(
      checkoutIdempotencyKey(USER_ID, "week", now + CHECKOUT_BUCKET_MS),
    );
    expect(checkoutIdempotencyKey(USER_ID, "week", now)).not.toBe(
      checkoutIdempotencyKey(USER_ID, "month", now),
    );
  });
});
