import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { Clock } from "../platform/ports/clock.ts";
import type { BillingDb } from "./ledger.ts";

import { isDemoRole } from "../../shared/demo.ts";
import { grants, profiles, users } from "../platform/db/schema.ts";

export type BillingPauseReason = "plan_ended" | "payment_failed";

const BILLING_REASONS = new Set<string>([
  "plan_ended",
  "payment_failed",
] satisfies BillingPauseReason[]);

const OTHER_HOLD_REASONS = new Set<string>([
  "onboarding",
  "no_resume",
  "no_mailbox",
  "suspended",
  "user",
]);

function accountOf(db: BillingDb, userId: string) {
  return db
    .select({ role: users.role, suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/**
 * Stops sending for a plan end or a failed payment, keeping the reason the
 * Home pause banner shows and its fix. Repeating the same pause changes
 * nothing, so a replayed or retried Stripe webhook never sends a second
 * notice. The demo account and a suspended account are never touched.
 * @param db The database or transaction applying the webhook.
 * @param clock The clock stamping the profile.
 * @param input The user and the reason sending stopped.
 * @returns Whether the profile changed, so the caller sends one notice.
 */
export function pauseForBilling(
  db: BillingDb,
  clock: Clock,
  input: { userId: string; reason: BillingPauseReason },
) {
  const unchanged = { changed: false, reason: input.reason, userId: input.userId };
  const account = accountOf(db, input.userId);

  if (account === undefined || isDemoRole(account.role) || account.suspendedAt !== null) {
    return unchanged;
  }

  const profile = db
    .select({ pauseReason: profiles.pauseReason, running: profiles.running })
    .from(profiles)
    .where(eq(profiles.userId, input.userId))
    .get();

  if (profile === undefined) {
    return unchanged;
  }

  const current = profile.pauseReason;

  if (current !== null && OTHER_HOLD_REASONS.has(current)) {
    return unchanged;
  }

  if (current === "payment_failed" && input.reason === "plan_ended") {
    return unchanged;
  }

  if (current === input.reason && !profile.running) {
    return unchanged;
  }

  db.update(profiles)
    .set({ pauseReason: input.reason, running: false, updatedAt: new Date(clock.now()) })
    .where(eq(profiles.userId, input.userId))
    .run();

  return { changed: true, ...input };
}

/**
 * Restarts sending after a payment succeeds, but only when billing is what
 * stopped it. A manual pause, unfinished setup or a suspension stays as it is.
 * @param db The database or transaction applying the webhook.
 * @param clock The clock that stamps the profile and schedules the work.
 * @param input The user whose payment succeeded.
 * @returns Whether sending resumed.
 */
export function resumeAfterPayment(db: BillingDb, clock: Clock, input: { userId: string }) {
  const account = accountOf(db, input.userId);

  if (account === undefined || isDemoRole(account.role) || account.suspendedAt !== null) {
    return { resumed: false };
  }

  const profile = db
    .select({ pauseReason: profiles.pauseReason })
    .from(profiles)
    .where(eq(profiles.userId, input.userId))
    .get();

  if (profile?.pauseReason === null || profile?.pauseReason === undefined) {
    return { resumed: false };
  }

  if (!BILLING_REASONS.has(profile.pauseReason)) {
    return { resumed: false };
  }

  db.update(profiles)
    .set({ pauseReason: null, running: true, updatedAt: new Date(clock.now()) })
    .where(eq(profiles.userId, input.userId))
    .run();

  return { resumed: true };
}

/**
 * Whether the user still holds an unexpired plan. A grant that used up its
 * Applications still counts until its period ends; only the period ending is
 * a plan end.
 * @param db The database to read.
 * @param userId The user whose plan to check.
 * @param at The instant the plan is checked at.
 * @returns True while any unexpired grant remains.
 */
export function hasActivePlan(db: BillingDb, userId: string, at: number) {
  const row = db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.userId, userId),
        lte(grants.startsAt, at),
        or(isNull(grants.expiresAt), gt(grants.expiresAt, at)),
      ),
    )
    .get();

  return row !== undefined;
}
