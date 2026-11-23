import { desc, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BillingPlan } from "../platform/ports/payments.ts";

import type { BillingDb } from "./ledger.ts";

import { periodEndFor } from "./plans.ts";
import { subscriptions } from "../platform/db/schema.ts";

type SubscriptionRow = typeof subscriptions.$inferSelect;

const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

const PROMOTABLE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);

/**
 * Whether a Stripe subscription status means the subscription no longer bills.
 * @param status Stripe's status, stored verbatim.
 * @returns True for the statuses that end a subscription.
 */
export function subscriptionEnded(status: string) {
  return ENDED_STATUSES.has(status);
}

/**
 * Whether a stored subscription should stop a new Checkout. A status that has
 * ended does not, and neither does `incomplete`, which never became a plan; any
 * other status means the user already has the plan Checkout would buy.
 * @param status Stripe's status, stored verbatim.
 * @returns True when a Checkout would duplicate a plan the user already has.
 */
export function subscriptionBlocksCheckout(status: string) {
  return status !== "incomplete" && !subscriptionEnded(status);
}

/**
 * The subscription fields a signed Stripe event can name. Every field is
 * optional because Stripe's events carry different subsets: an invoice names
 * the period it paid but never the subscription status, and a subscription
 * update names the status and the period it is now in. A field the event does
 * not name keeps what the stored row already says.
 */
export interface SubscriptionUpdate {
  userId: string;
  stripeSubscriptionId: string;
  plan: BillingPlan | null;
  status: string | null;
  currentPeriodStartMs: number | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean | null;
  /** The status a new row takes when the event names none and none is stored. */
  defaultStatus: string;
  /** When Stripe created the event, in epoch milliseconds, or null when unknown. */
  eventCreatedAtMs: number | null;
  /** Whether this is a `customer.subscription.*` event whose payload may be older than the stored row. */
  subscriptionEvent: boolean;
  /** Whether a successful invoice payment should promote a failed status to active. */
  promoteToActive: boolean;
}

/**
 * Stores what one signed Stripe event says about a subscription, creating the
 * row on the first event and never moving it to another user. The plan comes
 * from the price the event names first, so a subscription switched to another
 * Stripe price grants and reads the new plan's quota even while the metadata
 * on that subscription still names the old one. A `customer.subscription.*`
 * event Stripe created before the stored row's newest event is a stale
 * delivery, so it never regresses the status or period; an `invoice.paid`
 * promotes a failed status because the payment settled what it had failed.
 * @param db The database or transaction that claims the event.
 * @param at When the event was processed, in epoch milliseconds.
 * @param update What the event names, each field null when it names none.
 * @returns The subscription row's owner, or null when nothing was stored.
 */
export function recordSubscription(db: BillingDb, at: number, update: SubscriptionUpdate) {
  const existing = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, update.stripeSubscriptionId))
    .get();

  if (existing !== undefined && subscriptionEnded(existing.status)) {
    return null;
  }

  if (
    existing !== undefined &&
    update.subscriptionEvent &&
    update.eventCreatedAtMs !== null &&
    update.eventCreatedAtMs < existing.updatedAt
  ) {
    return null;
  }

  const plan = update.plan ?? existing?.plan ?? null;

  if (plan === null) {
    return null;
  }

  const currentPeriodStart = update.currentPeriodStartMs ?? existing?.currentPeriodStart ?? at;

  const currentPeriodEnd =
    update.currentPeriodEndMs ??
    existing?.currentPeriodEnd ??
    periodEndFor(plan, currentPeriodStart);

  const storedStatus = existing?.status ?? null;

  const promoted =
    update.promoteToActive && storedStatus !== null && PROMOTABLE_STATUSES.has(storedStatus);

  const row: SubscriptionRow = {
    cancelAtPeriodEnd: update.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd,
    currentPeriodStart,
    id: existing?.id ?? crypto.randomUUID(),
    plan,
    status: update.status ?? (promoted ? "active" : (storedStatus ?? update.defaultStatus)),
    stripeSubscriptionId: update.stripeSubscriptionId,
    updatedAt: Math.max(existing?.updatedAt ?? 0, update.eventCreatedAtMs ?? at),
    userId: existing?.userId ?? update.userId,
  };

  if (existing === undefined) {
    db.insert(subscriptions).values(row).run();

    return row.userId;
  }

  db.update(subscriptions)
    .set({
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      currentPeriodEnd: row.currentPeriodEnd,
      currentPeriodStart: row.currentPeriodStart,
      plan: row.plan,
      status: row.status,
      updatedAt: row.updatedAt,
    })
    .where(eq(subscriptions.id, row.id))
    .run();

  return row.userId;
}

/**
 * The subscription Settings shows: the newest one that has not ended, falling
 * back to the newest one so a canceled subscription still says so.
 * @param db The application database.
 * @param userId The account the subscription belongs to.
 * @returns The row, or null when the user never subscribed.
 */
export function currentSubscriptionOf(db: AppDatabase, userId: string) {
  const rows = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.updatedAt))
    .all();

  return rows.find((row) => !subscriptionEnded(row.status)) ?? rows[0] ?? null;
}

/**
 * The subscription a Stripe event names, by its Stripe id.
 * @param db The database or transaction that claims the event.
 * @param stripeSubscriptionId The subscription the event names.
 * @returns The row, or null when Overture has never seen it.
 */
export function storedSubscription(db: BillingDb, stripeSubscriptionId: string) {
  return (
    db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
      .get() ?? null
  );
}
