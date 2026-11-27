import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Payments } from "../platform/ports/payments.ts";

import { cardFingerprintHmac, claimTrialCard } from "./card-fingerprint.ts";
import { linkStripeCustomer } from "./customers.ts";

/** The outcomes a Stripe Setup return can produce, kept distinct so the UI can name each one. */
export const TRIAL_VERIFY_OUTCOMES = [
  "granted",
  "pending",
  "already_trialed",
  "already_used",
  "card_not_verified",
  "billing_disabled",
] as const;

export type TrialVerifyOutcome = (typeof TRIAL_VERIFY_OUTCOMES)[number];

/**
 * Verify the card a Stripe Setup session captured and claim the one-time trial. A session that is not complete yet
 * (a delayed webhook, or a return before Stripe finished) is `pending`, never a failure: the picks stay and the
 * caller can retry. The claim itself is idempotent for one account and card.
 * @param deps The database, clock, payments provider and the HMAC secret.
 * @param input The signed-in account and the Setup session id.
 * @returns The distinct outcome, or `stripe_error` when the provider call failed.
 */
export async function verifyTrialCardForUser(
  deps: {
    db: AppDatabase;
    clock: Clock;
    payments: Payments | null;
    cardFingerprintSecret: string | null;
  },
  input: { sessionId: string; userId: string },
) {
  const { db, clock, payments, cardFingerprintSecret } = deps;

  if (payments === null || cardFingerprintSecret === null) {
    return { outcome: "billing_disabled" };
  }

  let card;

  try {
    card = await payments.retrieveVerifiedCard(input.sessionId);
  } catch {
    return { outcome: "stripe_error" };
  }

  if (card === null) {
    return { outcome: "pending" };
  }

  if (card.userId !== input.userId) {
    return { outcome: "card_not_verified" };
  }

  if (card.customerId !== null) {
    linkStripeCustomer(db, {
      at: clock.now(),
      stripeCustomerId: card.customerId,
      userId: input.userId,
    });
  }

  const claim = claimTrialCard(db, clock, {
    hmac: cardFingerprintHmac(cardFingerprintSecret, card.fingerprint),
    userId: input.userId,
  });

  return { outcome: claim.status };
}
