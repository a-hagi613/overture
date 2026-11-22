import type { BillingPlan } from "../platform/ports/payments.ts";
import type { Clock } from "../platform/ports/clock.ts";

import type { BillingDb } from "./ledger.ts";

import { grantApplications } from "./ledger.ts";
import { PLAN_DEFINITIONS } from "./plans.ts";

export interface PaidPeriod {
  userId: string;
  plan: BillingPlan;
  invoiceId: string;
  periodStartMs: number;
  periodEndMs: number;
}

/**
 * Issues the grant one paid invoice buys: the plan's Applications, available
 * from the period start until its end, so unused ones expire with the period
 * (ADR 0008, ADR 0018). The invoice id is both the ledger idempotency key and
 * the grant's unique `stripe_invoice_id`, so a replayed webhook grants once.
 * @param db The database or transaction that claims the event.
 * @param clock The clock that stamps the grant and its ledger entry.
 * @param period The paid invoice and the period it covers.
 * @returns The grant, and whether this call created it.
 */
export function grantPaidPeriod(db: BillingDb, clock: Clock, period: PaidPeriod) {
  return grantApplications(db, clock, {
    expiresAt: period.periodEndMs,
    idempotencyKey: `stripe-invoice:${period.invoiceId}`,
    quantity: PLAN_DEFINITIONS[period.plan].applications,
    source: "period",
    startsAt: period.periodStartMs,
    stripeInvoiceId: period.invoiceId,
    userId: period.userId,
  });
}
