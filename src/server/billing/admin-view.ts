import { asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { BillingDb } from "./ledger.ts";

import { adminAudit, grants, profiles, users } from "../platform/db/schema.ts";
import { balancesPerGrant } from "./ledger.ts";
import type { MarginBaselineComparison, MarginReport } from "./margin.ts";
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

function billingStates(db: AppDatabase, at: number) {
  const periodExpiry = sql<
    number | null
  >`(SELECT coalesce(g.expires_at, -1) FROM grants g WHERE g.user_id = ${users.id} AND g.source = 'period' AND g.starts_at <= ${at} AND (g.expires_at IS NULL OR g.expires_at > ${at}) ORDER BY g.starts_at DESC, g.id DESC LIMIT 1)`;

  const hasTrial = sql<boolean>`EXISTS (SELECT 1 FROM grants t WHERE t.user_id = ${users.id} AND t.source = 'trial' AND t.starts_at <= ${at} AND (t.expires_at IS NULL OR t.expires_at > ${at}))`;

  const hasGrants = sql<boolean>`EXISTS (SELECT 1 FROM grants a WHERE a.user_id = ${users.id})`;

  const state = sql<BillingState>`CASE
    WHEN ${profiles.pauseReason} = 'payment_failed' THEN 'paused'
    WHEN (${periodExpiry}) > 0 THEN
      CASE WHEN (${periodExpiry}) - ${at} <= ${ENDING_WINDOW_MS} THEN 'ending' ELSE 'paying' END
    WHEN (${periodExpiry}) = -1 THEN 'paying'
    WHEN (${hasTrial}) THEN 'trial'
    WHEN (${hasGrants}) THEN 'ended'
    ELSE 'none'
  END`.as("state");

  return db
    .select({
      email: users.email,
      id: users.id,
      name: users.name,
      state,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(hasGrants)
    .as("billing_states");
}

/**
 * The billing list for the owner: one row per user with a grant, filtered and
 * paged in SQL, with the counts the stat cards show. Card data is never read.
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
  const states = billingStates(db, at);

  const matching = (() => {
    switch (input.filter) {
      case "trial": {
        return eq(states.state, "trial");
      }

      case "paying": {
        return inArray(states.state, ["paying", "ending"]);
      }

      case "paused": {
        return eq(states.state, "paused");
      }

      case "ended": {
        return eq(states.state, "ended");
      }

      default: {
        return sql`1 = 1`;
      }
    }
  })();

  const stateCounts = db
    .select({ state: states.state, total: count() })
    .from(states)
    .groupBy(sql`${states.state}`)
    .all();

  const countOf = (state: BillingState) =>
    stateCounts.find((row) => row.state === state)?.total ?? 0;

  const counts = {
    endingSoon: countOf("ending"),
    onTrial: countOf("trial"),
    paused: countOf("paused"),
    paying: countOf("paying") + countOf("ending"),
  };

  const total = db.select({ total: count() }).from(states).where(matching).get()?.total ?? 0;
  const start = (input.page - 1) * BILLING_USERS_PAGE_SIZE;

  const pageRows = db
    .select()
    .from(states)
    .where(matching)
    .orderBy(asc(states.email))
    .limit(BILLING_USERS_PAGE_SIZE)
    .offset(start)
    .all();

  const page = pageRows.map((row) => {
    const rows = grantsOf(db, row.id);
    const period = rows.find((grant) => grant.source === "period" && isActive(grant, at)) ?? null;
    const trial = rows.find((grant) => grant.source === "trial" && isActive(grant, at)) ?? null;
    const current = period ?? trial;
    const per = current === null ? undefined : balancesPerGrant(db, row.id).get(current.id);

    return {
      email: row.email,
      expiresAt: current?.expiresAt ?? null,
      id: row.id,
      name: displayName(row.name, row.email),
      plan: current === null ? null : planOf(current),
      refunded: current !== null && refunded.has(current.id),
      state: row.state,
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

  return {
    counts,
    page: input.page,
    total,
    users: page,
  };
}

function displayName(name: string, email: string) {
  return name.trim() === "" ? email : name;
}

/** The admin margin page: the measured report plus the actual-versus-baseline comparison. */
export interface MarginAdminView extends MarginReport {
  comparison: MarginBaselineComparison[];
}

/**
 * Puts the actual cost per Application beside what an Application earns net of
 * Stripe's domestic fee on each paid plan, so the owner sees headroom or a loss
 * without doing the arithmetic. The baselines are read from the report's own
 * plan rows, so the page can never disagree with the table beside it.
 * @param report The measured margin report.
 * @returns The report plus one comparison row per paid plan baseline.
 */
export function marginAdminView(report: MarginReport) {
  const actualMicrosPerApplication = report.actual?.totalMicrosPerApplication ?? null;

  const comparison = (["month", "week"] as const).flatMap((plan) => {
    const row = report.plans.find((candidate) => candidate.plan === plan);

    if (row === undefined) {
      return [];
    }

    return [
      {
        actualMicrosPerApplication,
        applications: row.applications,
        costShareOfNetRevenue:
          actualMicrosPerApplication === null
            ? null
            : actualMicrosPerApplication / row.netRevenueMicrosPerApplication,
        marginMicrosPerApplication:
          actualMicrosPerApplication === null
            ? null
            : row.netRevenueMicrosPerApplication - actualMicrosPerApplication,
        netRevenueMicrosPerApplication: row.netRevenueMicrosPerApplication,
        plan,
      } satisfies MarginBaselineComparison,
    ];
  });

  return { ...report, comparison } satisfies MarginAdminView;
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

  const refundedPeriod =
    period ?? rows.find((grant) => grant.source === "period" && refunded.has(grant.id)) ?? null;

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
    current: refundedPeriod === null ? null : describeGrant(refundedPeriod),
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
