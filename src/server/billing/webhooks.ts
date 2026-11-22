import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BillingDb } from "./ledger.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BillingPlan, PaymentEvent } from "../platform/ports/payments.ts";

import { isDemoRole } from "../../shared/demo.ts";
import { linkStripeCustomer } from "./customers.ts";
import { grantPaidPeriod } from "./periods.ts";
import { periodEndFor } from "./plans.ts";
import { stripeEvents, users } from "../platform/db/schema.ts";

const LINKING_EVENTS = new Set([
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "invoice.paid",
]);

const GRANTING_EVENT = "invoice.paid";

export function createPaymentsWebhookService(deps: {
  db: AppDatabase;
  clock: Clock;
  planForPrice: (priceId: string) => BillingPlan | null;
}) {
  const { db, clock, planForPrice } = deps;

  function grant(tx: BillingDb, event: PaymentEvent) {
    if (event.userId === null || event.invoiceId === null) {
      return;
    }

    const plan = event.plan ?? (event.priceId === null ? null : planForPrice(event.priceId));

    if (plan === null) {
      return;
    }

    const account = tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, event.userId))
      .get();

    if (account === undefined || isDemoRole(account.role)) {
      return;
    }

    grantPaidPeriod(tx, clock, {
      invoiceId: event.invoiceId,
      periodEndMs: event.periodEndMs ?? periodEndFor(plan, clock.now()),
      periodStartMs: event.periodStartMs ?? clock.now(),
      plan,
      userId: event.userId,
    });
  }

  return {
    handle(event: PaymentEvent) {
      return db.transaction((tx) => {
        const now = clock.now();

        const claimed = tx
          .insert(stripeEvents)
          .values({ id: event.id, processedAt: null, receivedAt: now, type: event.type })
          .onConflictDoNothing()
          .returning({ id: stripeEvents.id })
          .all();

        if (claimed.length === 0) {
          return "duplicate" as const;
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

        if (event.type === GRANTING_EVENT) {
          grant(tx, event);
        }

        tx.update(stripeEvents)
          .set({ processedAt: now })
          .where(eq(stripeEvents.id, event.id))
          .run();

        return "processed" as const;
      });
    },
  };
}
