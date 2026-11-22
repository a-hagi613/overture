import { eq } from "drizzle-orm";

import type { DatabaseWriter } from "../platform/db/client.ts";

import { customers } from "../platform/db/schema.ts";

export function stripeCustomerIdFor(db: DatabaseWriter, userId: string) {
  const row = db
    .select({ stripeCustomerId: customers.stripeCustomerId })
    .from(customers)
    .where(eq(customers.userId, userId))
    .get();

  return row?.stripeCustomerId ?? null;
}

export function userIdForStripeCustomer(db: DatabaseWriter, stripeCustomerId: string) {
  const row = db
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.stripeCustomerId, stripeCustomerId))
    .get();

  return row?.userId ?? null;
}

export function linkStripeCustomer(
  db: DatabaseWriter,
  input: { userId: string; stripeCustomerId: string; at: number },
) {
  const existing = db
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.stripeCustomerId, input.stripeCustomerId))
    .get();

  if (existing !== undefined && existing.userId !== input.userId) {
    return;
  }

  db.insert(customers)
    .values({
      createdAt: input.at,
      stripeCustomerId: input.stripeCustomerId,
      updatedAt: input.at,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      set: { stripeCustomerId: input.stripeCustomerId, updatedAt: input.at },
      target: customers.userId,
    })
    .run();
}
