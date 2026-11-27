import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { API_ERRORS } from "../../shared/api-errors.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";

/**
 * How many billing mutations one signed-in account may make in the window. Every one of them calls
 * Stripe (a Checkout Session, a Customer, a Setup Session or the billing portal), so an unbounded
 * loop from one account spends Overture's Stripe rate limit and creates junk objects there. Twenty
 * in five minutes leaves room for a person fixing a cancelled checkout, retrying a card and opening
 * the portal, and stops a script.
 */
export const BILLING_WRITE_LIMIT = { max: 20, windowMs: 5 * 60_000 } as const;

export const BILLING_WRITE_RETRY_AFTER_SECONDS = BILLING_WRITE_LIMIT.windowMs / 1000;

/**
 * The shared fixed-window bucket key for one account's billing writes. One key covers every billing
 * mutation, so alternating between Checkout, the trial Setup Session and the portal cannot multiply
 * the outbound Stripe calls a script makes.
 * @param userId The signed-in account.
 * @returns The rate-limit key.
 */
export function billingWriteLimitKey(userId: string) {
  return `api.billing-write:${userId}`;
}

/**
 * Consumes one billing mutation from the account's window.
 * @param db The application database that holds the shared `rate_limit` table.
 * @param clock The clock the window is measured with.
 * @param userId The signed-in account.
 * @returns A 429 with `Retry-After` when the window is full, or null when the write may proceed.
 */
export function billingWriteRefusal(db: AppDatabase, clock: Clock, userId: string) {
  const allowed = consumeRateLimit(
    db,
    billingWriteLimitKey(userId),
    clock.now(),
    BILLING_WRITE_LIMIT,
  );

  if (allowed) {
    return null;
  }

  return Response.json(
    { error: API_ERRORS.rateLimited },
    {
      headers: { "retry-after": String(BILLING_WRITE_RETRY_AFTER_SECONDS) },
      status: 429,
    },
  );
}
