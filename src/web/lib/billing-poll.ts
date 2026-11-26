import type { BillingPlan } from "./billing-api.ts";

/** How often the Billing page asks again after a Checkout return, while the plan is still unset. */
export const BILLING_SUCCESS_POLL_MS = 3000;

/** How many polls the Billing page makes after a Checkout return before it stops asking on its own. */
export const BILLING_SUCCESS_MAX_POLLS = 20;

/**
 * The delay before the next billing poll after a Checkout return.
 *
 * The webhooks that record the plan and credit the invoice can arrive a few
 * seconds apart, so the page polls until both the plan and the applications are
 * known; it never polls forever, and stops when the return is not
 * `?billing=success` or the cap is reached.
 * @param checkingReturn Whether the page was opened from a Checkout return.
 * @param plan The plan the server reported, or null when there is none yet.
 * @param planApplications The applications the plan granted, or zero while the invoice has not been credited.
 * @param polls How many successful loads the query has made.
 * @returns The delay in milliseconds, or false to stop polling.
 */
export function billingSuccessPollDelay(
  checkingReturn: boolean,
  plan: BillingPlan | null,
  planApplications: number,
  polls: number,
) {
  if (!checkingReturn || polls >= BILLING_SUCCESS_MAX_POLLS) {
    return false;
  }

  return plan !== null && planApplications > 0 ? false : BILLING_SUCCESS_POLL_MS;
}
