import { and, isNotNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { createBillingPauseNotice } from "../notify/billing-notice.ts";
import { grants } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { logInfo } from "../platform/log.ts";
import { expireDueGrants } from "./ledger.ts";
import { hasActivePlan, pauseForBilling } from "./pause.ts";

const HOUR_MS = 60 * 60_000;

export const GRANT_EXPIRY_JOB_KIND = "billing.grant-expiry";

export const GRANT_EXPIRY_INTERVAL_MS = HOUR_MS;

/**
 * Queues the next expiry pass. One pass covers every user with a due grant, so
 * the job is a singleton and a restart only replaces a queued copy.
 * @param db The application database.
 * @param clock The clock the pass runs against.
 * @returns Whether a new job was queued.
 */
export function ensureGrantExpiryQueued(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, GRANT_EXPIRY_JOB_KIND, "{}", {
    dedupeKey: GRANT_EXPIRY_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + GRANT_EXPIRY_INTERVAL_MS,
  }).inserted;
}

/**
 * Expires every grant whose period has ended, releasing a reservation still
 * held on it first so a failed or unconfirmed send never returns to spendable
 * (ADR 0008). A reservation held by a send already in flight stays until that
 * send commits or releases. When the last grant ends, sending pauses with the
 * `plan_ended` reason and the user gets one push and one email with the fix.
 * "Applications left" already ignores a grant past its end; this writes the
 * ledger entries that make that permanent.
 * @param deps The database and clock the pass runs against.
 * @returns The grants the pass expired.
 */
export function runGrantExpirySweep(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  const now = clock.now();

  const dueUsers = db
    .selectDistinct({ userId: grants.userId })
    .from(grants)
    .where(and(isNotNull(grants.expiresAt), lte(grants.expiresAt, now)))
    .all();

  const expired: string[] = [];

  for (const { userId } of dueUsers) {
    expired.push(...expireDueGrants(db, clock, userId));

    if (!hasActivePlan(db, userId, now)) {
      const state = pauseForBilling(db, clock, { reason: "plan_ended", userId });

      if (state.changed) {
        createBillingPauseNotice(db, clock, { reason: state.reason, userId });
        logInfo("billing.pause", `plan_ended for ${userId}`);
      }
    }
  }

  return expired;
}
