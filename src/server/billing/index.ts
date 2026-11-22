import type { Clock } from "../platform/ports/clock.ts";
import type { BillingPlan } from "../platform/ports/payments.ts";

import { env } from "../config/env.ts";
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
    secretKey,
    webhookSecret,
  });
}

export function stripePriceId(plan: BillingPlan) {
  return plan === "week" ? (env.STRIPE_PRICE_WEEK ?? null) : (env.STRIPE_PRICE_MONTH ?? null);
}
