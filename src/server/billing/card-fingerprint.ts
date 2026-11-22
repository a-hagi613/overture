import { createHmac } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type { Clock } from "../platform/ports/clock.ts";

import { cardFingerprints, grants, ledger } from "../platform/db/schema.ts";

import { grantApplications } from "./ledger.ts";

type BillingDb = BaseSQLiteDatabase<"sync", void>;

/** The Applications a verified card gets once, as the free trial (SPEC, M3). */
export const TRIAL_APPLICATIONS = 3;

/**
 * HMAC-SHA256 of Stripe's card fingerprint, keyed by a server secret.
 *
 * @param secret The server key (CARD_FINGERPRINT_SECRET).
 * @param stripeFingerprint Stripe's raw card fingerprint.
 * @returns The hex digest, the only form stored.
 */
export function cardFingerprintHmac(secret: string, stripeFingerprint: string) {
  return createHmac("sha256", secret).update(stripeFingerprint).digest("hex");
}

/**
 * Grants the one-time trial for a verified card, in one transaction.
 *
 * A retry by the same account and card is granted without a second grant. A card
 * that already funded a trial for someone else is refused, even after that account
 * is deleted, because the fingerprint row has no user foreign key. An account gets
 * at most one trial, whatever card it uses.
 *
 * @param db The billing database.
 * @param clock The clock used for timestamps.
 * @param input The card HMAC and the account claiming it.
 * @returns The claim outcome.
 */
export function claimTrialCard(
  db: BillingDb,
  clock: Clock,
  input: { hmac: string; userId: string },
) {
  return db.transaction((tx) => {
    const now = clock.now();
    const idempotencyKey = `trial:${input.userId}:${input.hmac}`;

    const retry = tx
      .select({ id: ledger.id })
      .from(ledger)
      .where(eq(ledger.idempotencyKey, idempotencyKey))
      .get();

    if (retry !== undefined) {
      return { status: "granted" as const };
    }

    const accountTrial = tx
      .select({ id: grants.id })
      .from(grants)
      .where(and(eq(grants.userId, input.userId), eq(grants.source, "trial")))
      .get();

    if (accountTrial !== undefined) {
      return { status: "already_trialed" as const };
    }

    tx.insert(cardFingerprints)
      .values({ createdAt: now, hmac: input.hmac, trialUsedAt: null })
      .onConflictDoNothing()
      .run();

    const card = tx
      .select({ trialUsedAt: cardFingerprints.trialUsedAt })
      .from(cardFingerprints)
      .where(eq(cardFingerprints.hmac, input.hmac))
      .get();

    if (card === undefined || card.trialUsedAt !== null) {
      return { status: "already_used" as const };
    }

    tx.update(cardFingerprints)
      .set({ trialUsedAt: now })
      .where(eq(cardFingerprints.hmac, input.hmac))
      .run();

    grantApplications(tx, clock, {
      idempotencyKey,
      quantity: TRIAL_APPLICATIONS,
      source: "trial",
      userId: input.userId,
    });

    return { status: "granted" as const };
  });
}
