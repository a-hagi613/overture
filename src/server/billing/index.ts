import type { Clock } from "../platform/ports/clock.ts";
import type { BillingPlan } from "../platform/ports/payments.ts";

import { env } from "../config/env.ts";
import { planForPriceId as planForPrice } from "./plans.ts";
import { createStripePayments } from "./stripe.ts";

export function createPayments(clock: Clock) {
  const secretKey = env.STRIPE_SECRET_KEY;
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  if (secretKey === undefined || webhookSecret === undefined) {
    return null;
  }

  return createStripePayments({
    apiBaseUrl: env.STRIPE_API_BASE_URL,
    clock,
    planPriceIds: [env.STRIPE_PRICE_WEEK, env.STRIPE_PRICE_MONTH].filter(
      (priceId): priceId is string => priceId !== undefined,
    ),
    secretKey,
    webhookSecret,
  });
}

export function stripePriceId(plan: BillingPlan) {
  return plan === "week" ? (env.STRIPE_PRICE_WEEK ?? null) : (env.STRIPE_PRICE_MONTH ?? null);
}

/**
 * The plan a configured Stripe price sells, so an invoice can be granted from
 * the price it names when the subscription carries no plan metadata.
 * @param priceId The Stripe price id on an invoice line.
 * @returns The plan that price sells, or null when Overture does not sell it.
 */
export function planForPriceId(priceId: string) {
  return planForPrice(priceId, {
    month: env.STRIPE_PRICE_MONTH ?? null,
    week: env.STRIPE_PRICE_WEEK ?? null,
  });
}
