import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BillingDb } from "./ledger.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BillingPlan, PaymentEvent } from "../platform/ports/payments.ts";

import { isDemoRole } from "../../shared/demo.ts";
import { createBillingPauseNotice } from "../notify/billing-notice.ts";
import { logInfo } from "../platform/log.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";
import { ensurePrepDailyQueued } from "../pipeline/daily-prep.ts";
import { claimTrialCard } from "./card-fingerprint.ts";
import { linkStripeCustomer, userIdForStripeCustomer } from "./customers.ts";
import { grantPaidPeriod } from "./periods.ts";
import { pauseForBilling, resumeAfterPayment } from "./pause.ts";
import { periodEndFor } from "./plans.ts";
import { stripeEvents, users } from "../platform/db/schema.ts";

/** A verified trial card, keyed by HMAC, read from Stripe before the transaction. */
export interface VerifiedTrialCard {
  hmac: string;
  userId: string;
}

const LINKING_EVENTS = new Set([
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "invoice.paid",
  "invoice.payment_failed",
]);

const GRANTING_EVENT = "invoice.paid";

const PAYMENT_FAILED_EVENT = "invoice.payment_failed";

function userForEvent(db: BillingDb, event: PaymentEvent) {
  if (event.userId !== null) {
    return event.userId;
  }

  return event.customerId === null ? null : userIdForStripeCustomer(db, event.customerId);
}

export function createPaymentsWebhookService(deps: {
  db: AppDatabase;
  clock: Clock;
  planForPrice: (priceId: string) => BillingPlan | null;
}) {
  const { db, clock, planForPrice } = deps;

  function grant(tx: BillingDb, event: PaymentEvent) {
    const userId = userForEvent(tx, event);

    if (userId === null) {
      return null;
    }

    const account = tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();

    if (account === undefined || isDemoRole(account.role)) {
      return null;
    }

    const plan = event.plan ?? (event.priceId === null ? null : planForPrice(event.priceId));

    if (plan !== null && event.invoiceId !== null) {
      grantPaidPeriod(tx, clock, {
        invoiceId: event.invoiceId,
        periodEndMs: event.periodEndMs ?? periodEndFor(plan, clock.now()),
        periodStartMs: event.periodStartMs ?? clock.now(),
        plan,
        userId,
      });
    }

    return userId;
  }

  function failPayment(tx: BillingDb, event: PaymentEvent) {
    const userId = userForEvent(tx, event);

    if (userId === null) {
      return null;
    }

    const state = pauseForBilling(tx, clock, { reason: "payment_failed", userId });

    return state.changed ? { reason: state.reason, userId } : null;
  }

  return {
    handle(event: PaymentEvent, trialCard: VerifiedTrialCard | null = null) {
      const result = db.transaction((tx) => {
        const now = clock.now();

        const claimed = tx
          .insert(stripeEvents)
          .values({ id: event.id, processedAt: null, receivedAt: now, type: event.type })
          .onConflictDoNothing()
          .returning({ id: stripeEvents.id })
          .all();

        if (claimed.length === 0) {
          return { kind: "duplicate" as const, notice: null, resumed: null };
        }

        if (LINKING_EVENTS.has(event.type) && event.userId !== null && event.customerId !== null) {
          const user = tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.id, event.userId))
            .get();

          if (user !== undefined) {
            linkStripeCustomer(tx, {
              at: now,
              stripeCustomerId: event.customerId,
              userId: event.userId,
            });
          }
        }

        let resumed: string | null = null;

        if (event.type === GRANTING_EVENT) {
          const userId = grant(tx, event);

          if (userId !== null && resumeAfterPayment(tx, clock, { userId }).resumed) {
            resumed = userId;
          }
        }

        const notice = event.type === PAYMENT_FAILED_EVENT ? failPayment(tx, event) : null;

        const isTrialSetup = event.type === "checkout.session.completed" && event.mode === "setup";

        if (isTrialSetup && trialCard !== null && trialCard.userId === event.userId) {
          claimTrialCard(tx, clock, { hmac: trialCard.hmac, userId: trialCard.userId });
        }

        tx.update(stripeEvents)
          .set({ processedAt: now })
          .where(eq(stripeEvents.id, event.id))
          .run();

        return { kind: "processed" as const, notice, resumed };
      });

      if (result.kind === "duplicate") {
        return "duplicate" as const;
      }

      if (result.notice !== null) {
        createBillingPauseNotice(db, clock, result.notice);
        logInfo("billing.pause", `${result.notice.reason} for ${result.notice.userId}`);
      }

      if (result.resumed !== null) {
        enqueuePlannerDay(db, clock, result.resumed);
        ensurePrepDailyQueued(db, clock, result.resumed);
        logInfo("billing.resume", result.resumed);
      }

      return "processed" as const;
    },
  };
}
