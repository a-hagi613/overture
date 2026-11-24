import { desc, eq, gte, notInArray, sql, and } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import {
  applicationLlmMicrosByUser,
  APPLICATION_LLM_PURPOSES,
} from "../dispatch/application-spend.ts";
import { recordedApplicationCostsByUser, recordedCostTotal } from "../dispatch/application-cost.ts";
import type { RecordedApplicationCost } from "../dispatch/application-cost.ts";
import { COST_GATE_MICROS, COST_REPORT_WINDOW_DAYS, isAttempted } from "../dispatch/report.ts";
import { attempts, grants, llmUsage, mailUsage, users } from "../platform/db/schema.ts";

import { PLAN_DEFINITIONS } from "./plans.ts";
import {
  netRevenueMicrosPerApplication,
  STRIPE_DOMESTIC_FEE_RATE,
  STRIPE_FIXED_FEE_MICROS,
  STRIPE_INTERNATIONAL_FEE_RATE,
} from "./stripe-fees.ts";

const DAY_MS = 24 * 60 * 60_000;

/** The margin page measures over the same window as the cost report. */
export const MARGIN_WINDOW_DAYS = COST_REPORT_WINDOW_DAYS;

/** Trial Applications, once per person (ADR 0018). */
export const TRIAL_APPLICATIONS = 3;

export const MARGIN_PLANS = ["trial", "week", "month"] as const;

export type MarginPlan = (typeof MARGIN_PLANS)[number];

/** Public prices in micros (ADR 0018). Stripe holds the live price ids. */
export const PLAN_PRICE_MICROS: Record<MarginPlan, number> = {
  trial: 0,
  week: 9_990_000,
  month: 29_990_000,
};

export const PLAN_APPLICATIONS: Record<MarginPlan, number> = {
  trial: TRIAL_APPLICATIONS,
  week: PLAN_DEFINITIONS.week.applications,
  month: PLAN_DEFINITIONS.month.applications,
};

/**
 * Net revenue per Application after Stripe's domestic fee (ADR 0018): what one
 * Application earns on the Month plan ($0.1144) and the Week plan ($0.1866).
 * The actual per-Application cost is compared against these.
 */
export const MONTH_NET_MICROS_PER_APPLICATION = netRevenueMicrosPerApplication(
  PLAN_PRICE_MICROS.month,
  PLAN_APPLICATIONS.month,
);

export const WEEK_NET_MICROS_PER_APPLICATION = netRevenueMicrosPerApplication(
  PLAN_PRICE_MICROS.week,
  PLAN_APPLICATIONS.week,
);

/**
 * The measured variable cost of one completed Application, split by what spent
 * it (ADR 0041). `llm` and `retry` are parts of the same total, never an
 * alternative accounting of it.
 */
export interface ActualApplicationCost {
  applications: number;
  llmMicrosPerApplication: number;
  browserMicrosPerApplication: number;
  retryMicrosPerApplication: number;
  totalMicrosPerApplication: number;
}

const emptyRecordedCost = () =>
  ({
    applications: 0,
    browserMicros: 0,
    llmMicros: 0,
    retryMicros: 0,
  }) satisfies RecordedApplicationCost;

function addRecordedCost(into: RecordedApplicationCost, cost: RecordedApplicationCost) {
  into.applications += cost.applications;
  into.browserMicros += cost.browserMicros;
  into.llmMicros += cost.llmMicros;
  into.retryMicros += cost.retryMicros;
}

/**
 * Averages the stored cost totals over the Applications that reported one.
 * @param cost The stored totals.
 * @returns The per-Application breakdown, or null when nothing reported a cost.
 */
export function actualApplicationCost(cost: RecordedApplicationCost) {
  if (cost.applications === 0) {
    return null;
  }

  return {
    applications: cost.applications,
    browserMicrosPerApplication: Math.round(cost.browserMicros / cost.applications),
    llmMicrosPerApplication: Math.round(cost.llmMicros / cost.applications),
    retryMicrosPerApplication: Math.round(cost.retryMicros / cost.applications),
    totalMicrosPerApplication: Math.round(recordedCostTotal(cost) / cost.applications),
  } satisfies ActualApplicationCost;
}

/** The actual cost per Application beside the Regular Stripe net revenue baselines (ADR 0018). */
export interface MarginBaselineComparison {
  plan: "month" | "week";
  applications: number;
  netRevenueMicrosPerApplication: number;
  actualMicrosPerApplication: number | null;
  marginMicrosPerApplication: number | null;
  /** The actual cost as a share of the net revenue one Application brings in. */
  costShareOfNetRevenue: number | null;
}

/**
 * Fixed monthly infrastructure: Fly machine $13.39, volume $1.50, Cloudflare
 * Workers $5.00 and the domain $0.87 (`docs/research/cost-m1.md` §1). Reported
 * beside the per-Application cost, never inside it (ADR 0026).
 */
export const FIXED_INFRA_MICROS_PER_MONTH = 20_760_000;

/** Cloudflare Email Sending: 3,000 emails a month included, then $0.35 per 1,000. */
export const MAIL_INCLUDED_SENDS = 3000;
export const MAIL_MICROS_PER_SEND_OVER_INCLUDED = 350;

interface Totals {
  users: Set<string>;
  sent: number;
  browserMicros: number;
  anthropicMicros: number;
}

export interface MarginPlanRow {
  plan: MarginPlan;
  priceMicros: number;
  applications: number;
  users: number;
  completed: number;
  costMicrosPerCompleted: number | null;
  /** The plan price divided by its Applications, before Stripe's fee. */
  revenueMicrosPerApplication: number;
  /** Stripe's fee per Application (3.6 % + $0.30 domestic, 5.1 % + $0.30 international). */
  stripeFeeMicrosPerApplication: number;
  /** Net revenue per Application after a domestic card's fee. */
  netRevenueMicrosPerApplication: number;
  /** Net revenue per Application if the same charge were on an international card. */
  internationalNetRevenueMicrosPerApplication: number;
  marginMicrosPerApplication: number | null;
  marginRatio: number | null;
  costGateMet: boolean | null;
  /** The actual cost per Application from the stored per-Application columns, once one is measured. */
  actual: ActualApplicationCost | null;
}

function planByUser(db: AppDatabase) {
  const rows = db
    .select({
      quantity: grants.quantity,
      source: grants.source,
      startsAt: grants.startsAt,
      userId: grants.userId,
    })
    .from(grants)
    .orderBy(desc(grants.startsAt))
    .all();

  const plans = new Map<string, MarginPlan | null>();

  for (const row of rows) {
    if (row.source !== "period") {
      continue;
    }

    if (!plans.has(row.userId)) {
      const plan = MARGIN_PLANS.find(
        (candidate) => candidate !== "trial" && PLAN_APPLICATIONS[candidate] === row.quantity,
      );

      plans.set(row.userId, plan ?? null);
    }
  }

  for (const row of rows) {
    if (!plans.has(row.userId)) {
      plans.set(row.userId, "trial");
    }
  }

  return plans;
}

function emptyTotals() {
  return {
    users: new Set<string>(),
    sent: 0,
    browserMicros: 0,
    anthropicMicros: 0,
  } satisfies Totals;
}

function rowFor(plan: MarginPlan, totals: Totals, recorded: RecordedApplicationCost) {
  const priceMicros = PLAN_PRICE_MICROS[plan];
  const applications = PLAN_APPLICATIONS[plan];
  const costMicros = totals.browserMicros + totals.anthropicMicros;
  const costPerCompleted = totals.sent === 0 ? null : Math.round(costMicros / totals.sent);
  const revenuePerApplication = Math.round(priceMicros / applications);
  const netPerApplication = netRevenueMicrosPerApplication(priceMicros, applications);

  const internationalNetPerApplication = netRevenueMicrosPerApplication(
    priceMicros,
    applications,
    STRIPE_INTERNATIONAL_FEE_RATE,
  );

  const margin = costPerCompleted === null ? null : netPerApplication - costPerCompleted;

  return {
    plan,
    priceMicros,
    applications,
    users: totals.users.size,
    completed: totals.sent,
    costMicrosPerCompleted: costPerCompleted,
    revenueMicrosPerApplication: revenuePerApplication,
    stripeFeeMicrosPerApplication: revenuePerApplication - netPerApplication,
    netRevenueMicrosPerApplication: netPerApplication,
    internationalNetRevenueMicrosPerApplication: internationalNetPerApplication,
    marginMicrosPerApplication: margin,
    marginRatio: margin === null || netPerApplication === 0 ? null : margin / netPerApplication,
    costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
    actual: actualApplicationCost(recorded),
  } satisfies MarginPlanRow;
}

/**
 * Measured cost and margin per completed Application for each plan over the
 * last thirty days (ADR 0026). Browser Use spend comes from `attempts`,
 * Anthropic spend from `llm_usage` for the Application purposes, attributed
 * to each user. Demo users are excluded, as in the provider report.
 * @param db The database to read.
 * @param clock The clock that sets the window and the mail month.
 * @returns The per-plan rows, the overall cost and the costs reported beside it.
 */
export function buildMarginReport(db: AppDatabase, clock: Clock) {
  const now = clock.now();
  const sinceMs = now - MARGIN_WINDOW_DAYS * DAY_MS;

  const attemptRows = db
    .select({
      costMicros: attempts.costMicros,
      outcome: attempts.outcome,
      userId: attempts.userId,
    })
    .from(attempts)
    .innerJoin(users, eq(users.id, attempts.userId))
    .where(and(sql`${users.role} <> 'demo'`, gte(attempts.startedAt, sinceMs)))
    .all();

  const llmByUser = applicationLlmMicrosByUser(db, sinceMs);
  const plans = planByUser(db);
  const perUser = new Map<string, Totals>();

  for (const row of attemptRows) {
    const totals = perUser.get(row.userId) ?? emptyTotals();

    totals.users.add(row.userId);

    if (isAttempted(row.outcome)) {
      totals.browserMicros += row.costMicros ?? 0;
    }

    if (row.outcome === "sent") {
      totals.sent += 1;
    }

    perUser.set(row.userId, totals);
  }

  for (const [userId, totals] of perUser) {
    totals.anthropicMicros = llmByUser.get(userId) ?? 0;
  }

  const overall = emptyTotals();
  const byPlan = new Map<MarginPlan, Totals>();

  for (const plan of MARGIN_PLANS) {
    byPlan.set(plan, emptyTotals());
  }

  for (const [userId, totals] of perUser) {
    overall.users.add(userId);
    overall.sent += totals.sent;
    overall.browserMicros += totals.browserMicros;
    overall.anthropicMicros += totals.anthropicMicros;

    const plan = plans.get(userId);

    if (plan === undefined || plan === null) {
      continue;
    }

    const planTotals = byPlan.get(plan) ?? emptyTotals();

    planTotals.users.add(userId);
    planTotals.sent += totals.sent;
    planTotals.browserMicros += totals.browserMicros;
    planTotals.anthropicMicros += totals.anthropicMicros;
    byPlan.set(plan, planTotals);
  }

  const overallCost = overall.browserMicros + overall.anthropicMicros;
  const completed = overall.sent;

  const recordedByUser = recordedApplicationCostsByUser(db, sinceMs);
  const overallRecorded = emptyRecordedCost();
  const recordedByPlan = new Map<MarginPlan, RecordedApplicationCost>();

  for (const [userId, cost] of recordedByUser) {
    addRecordedCost(overallRecorded, cost);

    const plan = plans.get(userId);

    if (plan === undefined || plan === null) {
      continue;
    }

    const planCost = recordedByPlan.get(plan) ?? emptyRecordedCost();

    addRecordedCost(planCost, cost);
    recordedByPlan.set(plan, planCost);
  }

  const otherAnthropic = db
    .select({ total: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)` })
    .from(llmUsage)
    .where(
      and(
        gte(llmUsage.createdAt, sinceMs),
        notInArray(llmUsage.purpose, [...APPLICATION_LLM_PURPOSES]),
      ),
    )
    .get();

  const month = new Date(now).toISOString().slice(0, 7);

  const mailRow = db
    .select({
      auth: mailUsage.authSends,
      notice: mailUsage.noticeSends,
      system: mailUsage.systemSends,
    })
    .from(mailUsage)
    .where(eq(mailUsage.month, month))
    .get();

  const mailSends = (mailRow?.auth ?? 0) + (mailRow?.system ?? 0) + (mailRow?.notice ?? 0);

  return {
    windowDays: MARGIN_WINDOW_DAYS,
    sinceMs,
    generatedAt: now,
    costGateMicros: COST_GATE_MICROS,
    completed,
    costMicrosPerCompleted: completed === 0 ? null : Math.round(overallCost / completed),
    browserMicrosPerCompleted:
      completed === 0 ? null : Math.round(overall.browserMicros / completed),
    anthropicMicrosPerCompleted:
      completed === 0 ? null : Math.round(overall.anthropicMicros / completed),
    actual: actualApplicationCost(overallRecorded),
    stripe: {
      domesticRate: STRIPE_DOMESTIC_FEE_RATE,
      fixedFeeMicros: STRIPE_FIXED_FEE_MICROS,
      internationalRate: STRIPE_INTERNATIONAL_FEE_RATE,
    },
    plans: MARGIN_PLANS.map((plan) =>
      rowFor(
        plan,
        byPlan.get(plan) ?? emptyTotals(),
        recordedByPlan.get(plan) ?? emptyRecordedCost(),
      ),
    ),
    beside: {
      fixedInfraMicrosPerMonth: FIXED_INFRA_MICROS_PER_MONTH,
      mail: {
        month,
        sends: mailSends,
        includedSends: MAIL_INCLUDED_SENDS,
        overageMicros:
          Math.max(0, mailSends - MAIL_INCLUDED_SENDS) * MAIL_MICROS_PER_SEND_OVER_INCLUDED,
      },
      otherAnthropicMicros: otherAnthropic?.total ?? 0,
    },
  };
}

export type MarginReport = ReturnType<typeof buildMarginReport>;
