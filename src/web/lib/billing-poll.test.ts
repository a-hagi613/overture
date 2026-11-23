import { describe, expect, test } from "bun:test";

import {
  BILLING_SUCCESS_MAX_POLLS,
  BILLING_SUCCESS_POLL_MS,
  billingSuccessPollDelay,
} from "./billing-poll.ts";

describe("polling after a Checkout return", () => {
  test("polls every three seconds while the plan is still unset", () => {
    expect(billingSuccessPollDelay(true, null, 1)).toBe(BILLING_SUCCESS_POLL_MS);
    expect(billingSuccessPollDelay(true, null, BILLING_SUCCESS_MAX_POLLS - 1)).toBe(
      BILLING_SUCCESS_POLL_MS,
    );
  });

  test("stops as soon as the plan is known", () => {
    expect(billingSuccessPollDelay(true, "month", 1)).toBe(false);
    expect(billingSuccessPollDelay(true, "week", 2)).toBe(false);
  });

  test("does not poll when the page was not opened from a Checkout return", () => {
    expect(billingSuccessPollDelay(false, null, 0)).toBe(false);
  });

  test("stops at the cap even when the plan never arrives", () => {
    expect(billingSuccessPollDelay(true, null, BILLING_SUCCESS_MAX_POLLS)).toBe(false);
    expect(billingSuccessPollDelay(true, null, BILLING_SUCCESS_MAX_POLLS + 5)).toBe(false);
  });
});
