import { and, eq, gte, ne } from "drizzle-orm";

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
import { recordSubscription, storedSubscription } from "./subscriptions.ts";
import { grants, stripeEvents, users } from "../platform/db/schema.ts";
import { wakeEventHub } from "../platform/sse/hub.ts";

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

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
]);

type StoredSubscription = ReturnType<typeof storedSubscription>;

function planFor(event: PaymentEvent, planForPrice: (priceId: string) => BillingPlan | null) {
  if (event.priceId !== null) {
    return planForPrice(event.priceId);
  }

  return event.plan;
}

function failureIsStale(tx: BillingDb, event: PaymentEvent, userId: string) {
  const failedPeriodEnd = event.periodEndMs ?? event.periodStartMs;

  if (failedPeriodEnd === null) {
    return false;
  }

  const stored = storedFor(tx, event);

  if (stored !== null && stored.currentPeriodEnd > failedPeriodEnd) {
    return true;
  }

  const conditions = [
    eq(grants.userId, userId),
    eq(grants.source, "period"),
    gte(grants.expiresAt, failedPeriodEnd),
  ];

  if (event.invoiceId !== null) {
    conditions.push(ne(grants.stripeInvoiceId, event.invoiceId));
  }

  return (
    tx
      .select({ id: grants.id })
      .from(grants)
      .where(and(...conditions))
      .get() !== undefined
  );
}

function userIdFor(db: BillingDb, event: PaymentEvent, stored: StoredSubscription) {
  if (event.userId !== null) {
    return event.userId;
  }

  if (stored !== null) {
    return stored.userId;
  }

  return event.customerId === null ? null : userIdForStripeCustomer(db, event.customerId);
}

function storedFor(db: BillingDb, event: PaymentEvent) {
  return event.subscriptionId === null ? null : storedSubscription(db, event.subscriptionId);
}

export function createPaymentsWebhookService(deps: {
  db: AppDatabase;
  clock: Clock;
  planForPrice: (priceId: string) => BillingPlan | null;
}) {
  const { db, clock, planForPrice: planForPriceId } = deps;

  function grant(tx: BillingDb, event: PaymentEvent) {
    const userId = userIdFor(tx, event, storedFor(tx, event));

    if (userId === null) {
      return null;
    }

    const account = tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();

    if (account === undefined || isDemoRole(account.role)) {
      return null;
    }

    const plan = planFor(event, planForPriceId);

    if (plan !== null && event.invoiceId !== null) {
      grantPaidPeriod(tx, clock, {
        invoiceId: event.invoiceId,
        periodEndMs: event.periodEndMs ?? periodEndFor(plan, clock.now()),
        periodStartMs: event.periodStartMs ?? clock.now(),
        plan,
        userId,
      });
    }

    return { plan, userId };
  }

  function failPayment(tx: BillingDb, event: PaymentEvent) {
    const userId = userIdFor(tx, event, storedFor(tx, event));

    if (userId === null || failureIsStale(tx, event, userId)) {
      return null;
    }

    const state = pauseForBilling(tx, clock, { reason: "payment_failed", userId });

    if (!state.changed) {
      return null;
    }

    createBillingPauseNotice(tx, clock, { reason: state.reason, userId });

    return { reason: state.reason, userId };
  }

  function record(
    tx: BillingDb,
    event: PaymentEvent,
    now: number,
    state: { cancelAtPeriodEnd: boolean | null; defaultStatus: string; status: string | null },
  ) {
    const userId = userIdFor(tx, event, storedFor(tx, event));

    if (event.subscriptionId === null || userId === null) {
      return;
    }

    recordSubscription(tx, now, {
      ...state,
      currentPeriodEndMs: event.periodEndMs,
      currentPeriodStartMs: event.periodStartMs,
      plan: planFor(event, planForPriceId),
      stripeSubscriptionId: event.subscriptionId,
      userId,
    });
  }

  function recordSubscriptionEvent(tx: BillingDb, event: PaymentEvent, now: number) {
    const ended = event.type === "customer.subscription.deleted";

    record(tx, event, now, {
      cancelAtPeriodEnd: ended ? false : event.cancelAtPeriodEnd,
      defaultStatus: ended ? "canceled" : "active",
      status: ended ? "canceled" : event.subscriptionStatus,
    });
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

        if (SUBSCRIPTION_EVENTS.has(event.type)) {
          recordSubscriptionEvent(tx, event, now);
        }

        let resumed: string | null = null;

        if (event.type === GRANTING_EVENT) {
          const granted = grant(tx, event);

          if (
            granted !== null &&
            granted.plan !== null &&
            resumeAfterPayment(tx, clock, { userId: granted.userId }).resumed
          ) {
            resumed = granted.userId;

            enqueuePlannerDay(tx, clock, granted.userId);
            ensurePrepDailyQueued(tx, clock, granted.userId);
          }

          record(tx, event, now, {
            cancelAtPeriodEnd: null,
            defaultStatus: "active",
            status: null,
          });
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
        logInfo("billing.pause", `${result.notice.reason} for ${result.notice.userId}`);

        wakeEventHub(db);
      }

      if (result.resumed !== null) {
        logInfo("billing.resume", result.resumed);
      }

      return "processed" as const;
    },
  };
}
