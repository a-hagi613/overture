import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PaymentEvent } from "../platform/ports/payments.ts";

import { linkStripeCustomer } from "./customers.ts";
import { stripeEvents, users } from "../platform/db/schema.ts";

const LINKING_EVENTS = new Set([
  "checkout.session.async_payment_succeeded",
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
]);

export function createPaymentsWebhookService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

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

        tx.update(stripeEvents)
          .set({ processedAt: now })
          .where(eq(stripeEvents.id, event.id))
          .run();

        return "processed" as const;
      });
    },
  };
}
