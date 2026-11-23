import type { BillingPlan } from "../platform/ports/payments.ts";

/**
 * What one paid period of a plan adds to the ledger (ADR 0018, SPEC §12).
 * The price itself lives in Stripe and its id in `STRIPE_PRICE_WEEK` or
 * `STRIPE_PRICE_MONTH`; the Applications and the period are Overture's.
 */
export interface PlanDefinition {
  applications: number;
  periodDays: number;
}

export const PLAN_DEFINITIONS: Record<BillingPlan, PlanDefinition> = {
  month: { applications: 250, periodDays: 30 },
  week: { applications: 50, periodDays: 7 },
};

const DAY_MS = 24 * 60 * 60_000;

/**
 * The plan a Stripe price sells, so an invoice can be granted from the price
 * it names when the subscription carries no plan metadata.
 * @param priceId The Stripe price id on an invoice line.
 * @param priceIds The configured price ids, one per plan.
 * @returns The plan that price sells, or null for a price Overture does not know.
 */
export function planForPriceId(
  priceId: string,
  priceIds: Readonly<Record<BillingPlan, string | null>>,
) {
  for (const plan of ["week", "month"] as const) {
    if (priceIds[plan] !== null && priceIds[plan] === priceId) {
      return plan;
    }
  }

  return null;
}

/**
 * The end of a paid period when the invoice does not name one, so a grant can
 * still expire instead of living forever.
 * @param plan The plan that was paid for.
 * @param startsAt When the period starts, in epoch milliseconds.
 * @returns The period end in epoch milliseconds.
 */
export function periodEndFor(plan: BillingPlan, startsAt: number) {
  return startsAt + PLAN_DEFINITIONS[plan].periodDays * DAY_MS;
}
