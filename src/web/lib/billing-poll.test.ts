import { describe, expect, test } from "bun:test";

import {
  BILLING_SUCCESS_MAX_POLLS,
  BILLING_SUCCESS_POLL_MS,
  billingSuccessPollDelay,
} from "./billing-poll.ts";

describe("polling after a Checkout return", () => {
  test("polls every three seconds while the plan is still unset", () => {
    expect(billingSuccessPollDelay(true, null, 0, 1)).toBe(BILLING_SUCCESS_POLL_MS);
    expect(billingSuccessPollDelay(true, null, 0, BILLING_SUCCESS_MAX_POLLS - 1)).toBe(
      BILLING_SUCCESS_POLL_MS,
    );
  });

  test("keeps polling after the plan arrives until the invoice credits its applications", () => {
    expect(billingSuccessPollDelay(true, "week", 0, 1)).toBe(BILLING_SUCCESS_POLL_MS);
  });

  test("stops as soon as the plan and its applications are known", () => {
    expect(billingSuccessPollDelay(true, "month", 250, 1)).toBe(false);
    expect(billingSuccessPollDelay(true, "week", 50, 2)).toBe(false);
  });

  test("does not poll when the page was not opened from a Checkout return", () => {
    expect(billingSuccessPollDelay(false, null, 0, 0)).toBe(false);
  });

  test("stops at the cap even when the plan never arrives", () => {
    expect(billingSuccessPollDelay(true, null, 0, BILLING_SUCCESS_MAX_POLLS)).toBe(false);
    expect(billingSuccessPollDelay(true, null, 0, BILLING_SUCCESS_MAX_POLLS + 5)).toBe(false);
  });
});
