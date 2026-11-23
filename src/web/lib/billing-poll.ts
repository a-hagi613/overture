import type { BillingPlan } from "./billing-api.ts";

/** How often the Billing page asks again after a Checkout return, while the plan is still unset. */
export const BILLING_SUCCESS_POLL_MS = 3000;

/** How many polls the Billing page makes after a Checkout return before it stops asking on its own. */
export const BILLING_SUCCESS_MAX_POLLS = 20;

/**
 * The delay before the next billing poll after a Checkout return.
 *
 * The webhook that records the plan can take a few seconds, so the page polls
 * for a short while; it never polls forever, and stops as soon as the plan is
 * known, the return is not `?billing=success`, or the cap is reached.
 * @param checkingReturn Whether the page was opened from a Checkout return.
 * @param plan The plan the server reported, or null when there is none yet.
 * @param polls How many successful loads the query has made.
 * @returns The delay in milliseconds, or false to stop polling.
 */
export function billingSuccessPollDelay(
  checkingReturn: boolean,
  plan: BillingPlan | null,
  polls: number,
) {
  if (!checkingReturn || plan !== null || polls >= BILLING_SUCCESS_MAX_POLLS) {
    return false;
  }

  return BILLING_SUCCESS_POLL_MS;
}
