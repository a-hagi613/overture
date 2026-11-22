import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BillingDb } from "./ledger.ts";

import { adminAudit, grants, profiles, users } from "../platform/db/schema.ts";
import { balancesPerGrant } from "./ledger.ts";
import { REFUND_AUDIT_ACTION } from "./refunds.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDING_WINDOW_MS = 7 * DAY_MS;
const WEEK_MAX_MS = 8 * DAY_MS;
export const BILLING_USERS_PAGE_SIZE = 10;

export const BILLING_FILTERS = ["all", "trial", "paying", "paused", "ended"] as const;

export type BillingFilter = (typeof BILLING_FILTERS)[number];

export type BillingState = "trial" | "paying" | "ending" | "paused" | "ended" | "none";

const refundedGrantSchema = z.object({ grantId: z.string() });

type GrantRow = typeof grants.$inferSelect;

function planOf(grant: GrantRow) {
  const span = grant.expiresAt === null ? null : grant.expiresAt - grant.startsAt;

  return span !== null && span <= WEEK_MAX_MS ? ("week" as const) : ("month" as const);
}

function isActive(grant: GrantRow, at: number) {
  return grant.startsAt <= at && (grant.expiresAt === null || grant.expiresAt > at);
}

function stateOf(input: {
  paused: boolean;
  period: GrantRow | null;
  trial: GrantRow | null;
  hasGrants: boolean;
  at: number;
}) {
  if (input.paused) {
    return "paused" as const satisfies BillingState;
  }

  if (input.period !== null) {
    const ending =
      input.period.expiresAt !== null && input.period.expiresAt - input.at <= ENDING_WINDOW_MS;

    return (ending ? "ending" : "paying") satisfies BillingState;
  }

  if (input.trial !== null) {
    return "trial" as const satisfies BillingState;
  }

  return (input.hasGrants ? "ended" : "none") satisfies BillingState;
}

function grantsOf(db: AppDatabase | BillingDb, userId: string) {
  return db
    .select()
    .from(grants)
    .where(eq(grants.userId, userId))
    .orderBy(desc(grants.startsAt), desc(grants.id))
    .all();
}

function refundedGrantIds(db: AppDatabase) {
  const refunded = new Set<string>();

  const rows = db
    .select({ detail: adminAudit.detail })
    .from(adminAudit)
    .where(eq(adminAudit.action, REFUND_AUDIT_ACTION))
    .all();

  for (const row of rows) {
    const parsed = refundedGrantSchema.safeParse(JSON.parse(row.detail));

    if (parsed.success) {
      refunded.add(parsed.data.grantId);
    }
  }

  return refunded;
}

function matchesFilter(state: BillingState, filter: BillingFilter) {
  switch (filter) {
    case "all": {
      return true;
    }

    case "trial": {
      return state === "trial";
    }

    case "paying": {
      return state === "paying" || state === "ending";
    }

    case "paused": {
      return state === "paused";
    }

    case "ended": {
      return state === "ended";
    }

    default: {
      return false;
    }
  }
}

function userRowsOf(db: AppDatabase) {
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      pauseReason: profiles.pauseReason,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, db.selectDistinct({ id: grants.userId }).from(grants)))
    .orderBy(users.email)
    .all();
}

/**
 * The billing list for the owner: one row per user with a grant, filtered and
 * paged, with the counts the stat cards show. Card data is never read.
 * @param db The application database.
 * @param clock The clock the states are computed against.
 * @param input The filter and the one-based page.
 * @returns The counts, the page of users and the total that matched.
 */
export function billingUsersPage(
  db: AppDatabase,
  clock: Clock,
  input: { filter: BillingFilter; page: number },
) {
  const at = clock.now();
  const refunded = refundedGrantIds(db);

  const summaries = userRowsOf(db).map((row) => {
    const rows = grantsOf(db, row.id);
    const period = rows.find((grant) => grant.source === "period" && isActive(grant, at)) ?? null;
    const trial = rows.find((grant) => grant.source === "trial" && isActive(grant, at)) ?? null;

    const state: BillingState = stateOf({
      at,
      hasGrants: rows.length > 0,
      paused: row.pauseReason === "payment_failed",
      period,
      trial,
    });

    const current = period ?? trial;
    const per = current === null ? undefined : balancesPerGrant(db, row.id).get(current.id);

    return {
      email: row.email,
      expiresAt: current?.expiresAt ?? null,
      id: row.id,
      name: displayName(row.name, row.email),
      plan: current === null ? null : planOf(current),
      refunded: current !== null && refunded.has(current.id),
      state,
      usage:
        current === null
          ? null
          : {
              left: per?.available ?? 0,
              quantity: current.quantity,
              used: Math.min(per?.used ?? 0, current.quantity),
            },
    };
  });

  const matching = summaries.filter((summary) => matchesFilter(summary.state, input.filter));

  const counts = {
    endingSoon: summaries.filter((summary) => summary.state === "ending").length,
    onTrial: summaries.filter((summary) => summary.state === "trial").length,
    paused: summaries.filter((summary) => summary.state === "paused").length,
    paying: summaries.filter((summary) => summary.state === "paying" || summary.state === "ending")
      .length,
  };

  const start = (input.page - 1) * BILLING_USERS_PAGE_SIZE;

  return {
    counts,
    page: input.page,
    total: matching.length,
    users: matching.slice(start, start + BILLING_USERS_PAGE_SIZE),
  };
}

function displayName(name: string, email: string) {
  return name.trim() === "" ? email : name;
}

/**
 * One user's billing: trial, current period, renewals, expiry and any
 * payment-failure pause. It carries no card or payment-method fields.
 * @param db The application database.
 * @param clock The clock the states are computed against.
 * @param userId The user to show.
 * @returns The billing view, or null when no such user exists.
 */
export function billingUserView(db: AppDatabase, clock: Clock, userId: string) {
  const at = clock.now();

  const user = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      pauseReason: profiles.pauseReason,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .get();

  if (user === undefined) {
    return null;
  }

  const rows = grantsOf(db, userId);
  const balances = balancesPerGrant(db, userId);
  const refunded = refundedGrantIds(db);
  const period = rows.find((grant) => grant.source === "period" && isActive(grant, at)) ?? null;
  const trial = rows.find((grant) => grant.source === "trial" && isActive(grant, at)) ?? null;
  const paused = user.pauseReason === "payment_failed";

  const describeGrant = (grant: GrantRow) => {
    const per = balances.get(grant.id);

    return {
      expiresAt: grant.expiresAt,
      grantId: grant.id,
      left: per?.available ?? 0,
      plan: planOf(grant),
      quantity: grant.quantity,
      refunded: refunded.has(grant.id),
      source: grant.source,
      startsAt: grant.startsAt,
      used: Math.min(per?.used ?? 0, grant.quantity),
    };
  };

  return {
    current: period === null ? null : describeGrant(period),
    email: user.email,
    id: user.id,
    name: displayName(user.name, user.email),
    paused,
    pausedReason: paused ? ("payment_failed" as const) : null,
    periods: rows.filter((grant) => grant.source === "period").map((grant) => describeGrant(grant)),
    refundable: period !== null && period.stripeInvoiceId !== null && !refunded.has(period.id),
    state: stateOf({ at, hasGrants: rows.length > 0, paused, period, trial }),
    trial: trial === null ? null : describeGrant(trial),
  };
}
