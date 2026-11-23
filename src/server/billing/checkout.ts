import { createHash } from "node:crypto";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BillingPlan, CheckoutSession, Payments } from "../platform/ports/payments.ts";

import { stripeCustomerIdFor } from "./customers.ts";

/** One Checkout session per user and plan per ten minutes. */
export const CHECKOUT_BUCKET_MS = 10 * 60_000;

export interface CheckoutInput {
  userId: string;
  email: string;
  plan: BillingPlan;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * The Stripe idempotency key for one Checkout attempt. The user, the plan and a
 * short time bucket make every double click inside the bucket the same request,
 * so Stripe returns the session it already created instead of a second one.
 * @param userId The account buying the plan.
 * @param plan The plan being bought.
 * @param nowMs The clock's now, in epoch milliseconds.
 * @returns A stable key for the bucket.
 */
export function checkoutIdempotencyKey(userId: string, plan: BillingPlan, nowMs: number) {
  const bucket = Math.floor(nowMs / CHECKOUT_BUCKET_MS);

  const digest = createHash("sha256")
    .update(`${userId}:${plan}:${String(bucket)}`)
    .digest("hex");

  return `checkout:${digest}`;
}

/**
 * Serializes checkout creation per user and plan, so concurrent double clicks
 * share one Stripe Checkout Session and one implicitly created Stripe Customer.
 * The Stripe idempotency key also covers a restart or a second process.
 * @param deps The database, clock and payment provider.
 * @returns A creator whose concurrent calls for one key share a promise.
 */
export function createCheckoutCoordinator(deps: {
  db: AppDatabase;
  clock: Clock;
  payments: Payments;
}) {
  const inFlight = new Map<string, Promise<CheckoutSession>>();

  return {
    async create(input: CheckoutInput) {
      const idempotencyKey = checkoutIdempotencyKey(input.userId, input.plan, deps.clock.now());
      const pending = inFlight.get(idempotencyKey);

      if (pending !== undefined) {
        return pending;
      }

      const created = (async () => {
        const customerId = stripeCustomerIdFor(deps.db, input.userId);

        return deps.payments.createCheckoutSession({ ...input, customerId, idempotencyKey });
      })();

      inFlight.set(idempotencyKey, created);

      void (async () => {
        try {
          await created;
        } catch {
          inFlight.delete(idempotencyKey);

          return;
        }

        inFlight.delete(idempotencyKey);
      })();

      return created;
    },
  };
}
