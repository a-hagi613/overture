import { and, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PlanKind } from "../../shared/plans.ts";

import { ledger } from "../platform/db/schema.ts";
import { activeGrantsOf, balancesPerGrant } from "./ledger.ts";
import { currentSubscriptionOf, subscriptionEnded } from "./subscriptions.ts";

/** Applications granted, spent and still available on one kind of grant. */
export interface PlanAllowance {
  granted: number;
  left: number;
  used: number;
}

/** The itemized balance Settings → Billing reads. */
export interface BalanceBreakdown {
  /** The soonest grant with applications left and an end date, or null when nothing is expiring. */
  expiring: { applications: number; expiresAt: number } | null;
  paid: PlanAllowance;
  /** Applications handed back when a send failed or a period ended. */
  released: number;
  /** Applications set aside for a send in progress. */
  reserved: number;
  trial: PlanAllowance;
  /** Every committed application, trial, paid and invite grants included. */
  used: number;
}

function planKindOf(db: AppDatabase, userId: string, hasTrialGrant: boolean) {
  const subscription = currentSubscriptionOf(db, userId);

  const activeSubscription =
    subscription !== null &&
    subscription.status !== "incomplete" &&
    !subscriptionEnded(subscription.status);

  if (activeSubscription) {
    return subscription.plan;
  }

  return hasTrialGrant ? "trial" : "none";
}

function allowanceOf(
  grants: ReturnType<typeof activeGrantsOf>,
  per: ReturnType<typeof balancesPerGrant>,
  source: "period" | "trial",
) {
  const total: PlanAllowance = { granted: 0, left: 0, used: 0 };

  for (const grant of grants) {
    if (grant.source !== source) {
      continue;
    }

    const balances = per.get(grant.id);

    total.granted += grant.quantity;
    total.left += balances?.available ?? 0;
    total.used += balances?.used ?? 0;
  }

  return total;
}

/**
 * Everything the sidebar, Home and Settings → Billing show about one person's
 * balance: the plan, what their trial and paid grants hold, what is held for a
 * send, what has been used or returned, and what expires next. It reads the
 * grants and the ledger once each, so a screen gets the numbers from one place.
 * The trial stays the plan after its three applications are sent, so Home and
 * the sidebar can offer the upgrade; an ended or unfinished Checkout never
 * counts as a plan.
 * @param db The application database.
 * @param userId The account whose balance is read.
 * @param at The instant the balance is for.
 * @returns The plan, the balance counters and whether the trial has been used up.
 */
export function billingAccountOf(db: AppDatabase, userId: string, at: number) {
  const per = balancesPerGrant(db, userId);
  const grants = activeGrantsOf(db, userId, at);

  const trial = allowanceOf(grants, per, "trial");
  const paid = allowanceOf(grants, per, "period");

  const totals = { reserved: 0, used: 0 };

  for (const balances of per.values()) {
    totals.reserved += balances.reserved;
    totals.used += balances.used;
  }

  const releasedRow = db
    .select({ total: sql<number>`coalesce(sum(${ledger.amount}), 0)` })
    .from(ledger)
    .where(and(eq(ledger.userId, userId), eq(ledger.kind, "release")))
    .get();

  const expiringGrant = grants.find((grant) => {
    const balances = per.get(grant.id);

    return grant.expiresAt !== null && grant.expiresAt > at && (balances?.available ?? 0) > 0;
  });

  const expiringAt = expiringGrant?.expiresAt ?? null;

  const expiring =
    expiringAt === null
      ? null
      : {
          applications: per.get(expiringGrant?.id ?? "")?.available ?? 0,
          expiresAt: expiringAt,
        };

  const ending = grants.find(
    (grant) =>
      grant.source === "admin" &&
      grant.expiresAt !== null &&
      (per.get(grant.id)?.available ?? 0) > 0,
  );

  const endingAt = ending?.expiresAt ?? null;

  const endingGrant =
    endingAt === null
      ? null
      : {
          applicationsLeft: per.get(ending?.id ?? "")?.available ?? 0,
          expiresAt: endingAt,
        };

  const planKind: PlanKind = planKindOf(db, userId, trial.granted > 0);

  return {
    applicationsLeft: grants.reduce((sum, grant) => sum + (per.get(grant.id)?.available ?? 0), 0),
    balance: {
      expiring,
      paid,
      released: releasedRow?.total ?? 0,
      reserved: totals.reserved,
      trial,
      used: totals.used,
    } satisfies BalanceBreakdown,
    endingGrant,
    planApplications: grants.reduce((sum, grant) => sum + grant.quantity, 0),
    planKind,
    trialUsed: trial.granted > 0 && trial.left === 0 && trial.used >= trial.granted,
  };
}
