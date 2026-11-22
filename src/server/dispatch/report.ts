import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, attempts, users } from "../platform/db/schema.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { percentile, ratio } from "../platform/stats.ts";

import { applicationLlmMicrosByUser } from "./application-spend.ts";

export const COST_GATE_MICROS = 30_000;
const TREND_WINDOW = 20;
const TREND_MINIMUM = 10;
const TREND_RATIO = 1.2;

const DAY_MS = 86_400_000;

/**
 * The window the cost report measures over: the current billing period, the
 * same window the margin page reports (SPEC §5.7). The `since` bound keeps the
 * report off the whole `attempts` table (`docs/research/cost-m1.md` §5.5); the
 * retention job prunes that table at 180 days.
 */
export const COST_REPORT_WINDOW_DAYS = 30;

const NOT_ATTEMPTED: readonly string[] = ["posting_closed", "duplicate", "needs_review"];

const ATTEMPTED = sql`(${attempts.outcome} IS NULL OR ${attempts.outcome} NOT IN (${sql.join(
  NOT_ATTEMPTED.map((outcome) => sql`${outcome}`),
  sql`, `,
)}))`;

const DURATIONS = sql<
  string | null
>`group_concat(${attempts.browserMs}) FILTER (WHERE ${attempts.browserMs} > 0)`;

/**
 * Whether a try with this outcome counts as an attempted Application (ADR 0026).
 * @param outcome The outcome of the try, or null while it is still running.
 * @returns True when the try counts towards the cost denominator.
 */
export const isAttempted = (outcome: string | null) =>
  outcome === null || !NOT_ATTEMPTED.includes(outcome);

interface GroupTotals {
  ats: string | null;
  provider: string;
  userId: string;
  attemptedApplications: number;
  attemptCount: number;
  browserMicros: number;
  captchaSeen: number;
  codeUsed: number;
  completedApplications: number;
  durations: string | null;
  proxyBytes: number;
  sentAttemptCount: number;
}

interface GroupSummary {
  key: string;
  ats: string;
  provider: string;
  attemptedApplications: number;
  attemptedByUser: Map<string, number>;
  attemptCount: number;
  browserMicros: number;
  captchaSeen: number;
  codeUsed: number;
  completedApplications: number;
  durations: number[];
  proxyBytes: number;
  sentAttemptCount: number;
}

interface CostPopulation {
  groups: GroupSummary[];
  attempted: number;
  attemptedByUser: Map<string, number>;
  completed: number;
  llmByUser: Map<string, number>;
}

export interface ProviderReportRow {
  provider: string;
  ats: string;
  /** Distinct attempted Applications: the product denominator. */
  attempted: number;
  /** Distinct attempted Applications whose Status is sent: the product numerator. */
  completed: number;
  /** Attempted tries, including failed ones. Diagnostics only. */
  attemptCount: number;
  /** Tries the page confirmed as sent. Diagnostics only (email confirmations keep `unconfirmed`). */
  sentAttemptCount: number;
  completionRate: number | null;
  codeRate: number | null;
  challengeRate: number | null;
  p50BrowserMs: number | null;
  p95BrowserMs: number | null;
  proxyMbPerCompleted: number | null;
  costMicrosPerCompleted: number | null;
  costGateMicros: number;
  costGateMet: boolean | null;
  proxyTrend: boolean;
}

const groupKey = (provider: string, ats: string | null) => `${provider}\u0000${ats ?? "unknown"}`;

const durationsOf = (values: string | null) =>
  values === null || values === "" ? [] : values.split(",").map(Number);

const sinceOf = (clock: Clock) => clock.now() - COST_REPORT_WINDOW_DAYS * DAY_MS;

const readGroupTotals = (db: AppDatabase, sinceMs: number) =>
  db
    .select({
      ats: applications.ats,
      provider: attempts.provider,
      userId: applications.userId,
      attemptedApplications: sql<number>`count(distinct case when ${ATTEMPTED} then ${attempts.applicationId} end)`,
      attemptCount: sql<number>`sum(case when ${ATTEMPTED} then 1 else 0 end)`,
      browserMicros: sql<number>`sum(case when ${ATTEMPTED} then coalesce(${attempts.costMicros}, 0) else 0 end)`,
      captchaSeen: sql<number>`sum(case when ${ATTEMPTED} and ${attempts.captchaSeen} then 1 else 0 end)`,
      codeUsed: sql<number>`sum(case when ${ATTEMPTED} and ${attempts.codeUsed} then 1 else 0 end)`,
      completedApplications: sql<number>`count(distinct case when ${ATTEMPTED} and ${applications.status} = 'sent' then ${attempts.applicationId} end)`,
      durations: DURATIONS,
      proxyBytes: sql<number>`sum(case when ${ATTEMPTED} then coalesce(${attempts.proxyBytes}, 0) else 0 end)`,
      sentAttemptCount: sql<number>`sum(case when ${attempts.outcome} = 'sent' then 1 else 0 end)`,
    })
    .from(attempts)
    .innerJoin(applications, eq(attempts.applicationId, applications.id))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(sql`${users.role} <> 'demo'`, gte(attempts.startedAt, sinceMs)))
    .groupBy(attempts.provider, applications.ats, applications.userId)
    .all();

const summariseGroups = (totals: GroupTotals[]) => {
  const groups = new Map<string, GroupSummary>();

  for (const row of totals) {
    const key = groupKey(row.provider, row.ats);

    const group = groups.get(key) ?? {
      ats: row.ats ?? "unknown",
      attemptedApplications: 0,
      attemptedByUser: new Map<string, number>(),
      attemptCount: 0,
      browserMicros: 0,
      captchaSeen: 0,
      codeUsed: 0,
      completedApplications: 0,
      durations: [],
      key,
      provider: row.provider,
      proxyBytes: 0,
      sentAttemptCount: 0,
    };

    group.attemptedApplications += row.attemptedApplications;
    group.attemptedByUser.set(
      row.userId,
      (group.attemptedByUser.get(row.userId) ?? 0) + row.attemptedApplications,
    );
    group.attemptCount += row.attemptCount;
    group.browserMicros += row.browserMicros;
    group.captchaSeen += row.captchaSeen;
    group.codeUsed += row.codeUsed;
    group.completedApplications += row.completedApplications;
    group.durations.push(...durationsOf(row.durations));
    group.proxyBytes += row.proxyBytes;
    group.sentAttemptCount += row.sentAttemptCount;
    groups.set(key, group);
  }

  return [...groups.values()].filter((group) => group.attemptedApplications > 0);
};

const readPopulationTotals = (db: AppDatabase, sinceMs: number) =>
  db
    .select({
      userId: applications.userId,
      attemptedApplications: sql<number>`count(*)`,
      completedApplications: sql<number>`sum(case when ${applications.status} = 'sent' then 1 else 0 end)`,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        sql`${users.role} <> 'demo'`,
        sql`exists (select 1 from ${attempts} where ${attempts.applicationId} = ${applications.id} and ${attempts.startedAt} >= ${sinceMs} and ${ATTEMPTED})`,
      ),
    )
    .groupBy(applications.userId)
    .all();

const readCostPopulation = (db: AppDatabase, sinceMs: number) => {
  const population = readPopulationTotals(db, sinceMs);

  return {
    attempted: population.reduce((total, row) => total + row.attemptedApplications, 0),
    attemptedByUser: new Map(
      population.map((row) => [row.userId, row.attemptedApplications] as const),
    ),
    completed: population.reduce((total, row) => total + row.completedApplications, 0),
    groups: summariseGroups(readGroupTotals(db, sinceMs)),
    llmByUser: applicationLlmMicrosByUser(db, sinceMs),
  } satisfies CostPopulation;
};

const anthropicMicrosOf = (
  inGroup: Map<string, number>,
  population: Map<string, number>,
  llmByUser: Map<string, number>,
) =>
  [...inGroup].reduce(
    (total, [userId, count]) =>
      total + ((llmByUser.get(userId) ?? 0) * count) / (population.get(userId) ?? count),
    0,
  );

const summarise = (groups: GroupSummary[], trend: boolean, population: CostPopulation) =>
  groups
    .map((group) => {
      const costPerCompleted = ratio(
        group.browserMicros +
          anthropicMicrosOf(
            group.attemptedByUser,
            population.attemptedByUser,
            population.llmByUser,
          ),
        group.completedApplications,
      );

      return {
        ats: group.ats,
        attempted: group.attemptedApplications,
        attemptCount: group.attemptCount,
        challengeRate: ratio(group.captchaSeen, group.attemptCount),
        codeRate: ratio(group.codeUsed, group.attemptCount),
        completed: group.completedApplications,
        completionRate: ratio(group.completedApplications, group.attemptedApplications),
        costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
        costGateMicros: COST_GATE_MICROS,
        costMicrosPerCompleted: costPerCompleted,
        p50BrowserMs: percentile(group.durations, 0.5),
        p95BrowserMs: percentile(group.durations, 0.95),
        provider: group.provider,
        proxyMbPerCompleted: ratio(group.proxyBytes, group.completedApplications * 1_000_000),
        proxyTrend: trend,
        sentAttemptCount: group.sentAttemptCount,
      };
    })
    .toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.ats.localeCompare(right.ats),
    );

const completedUsage = (db: AppDatabase, sinceMs: number) =>
  db
    .select({ browserMs: attempts.browserMs, proxyBytes: attempts.proxyBytes })
    .from(attempts)
    .innerJoin(applications, eq(attempts.applicationId, applications.id))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        sql`${users.role} <> 'demo'`,
        gte(attempts.startedAt, sinceMs),
        eq(attempts.outcome, "sent"),
      ),
    )
    .orderBy(desc(attempts.startedAt))
    .limit(TREND_WINDOW * 2)
    .all()
    .toReversed();

interface CompletedUsage {
  browserMs: number | null;
  proxyBytes: number | null;
}

const risingTrend = (values: number[]) => {
  if (values.length < TREND_WINDOW + TREND_MINIMUM) {
    return false;
  }

  const recent = values.slice(-TREND_WINDOW);
  const previous = values.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
  const recentAverage = recent.reduce((total, value) => total + value, 0) / recent.length;
  const previousAverage = previous.reduce((total, value) => total + value, 0) / previous.length;

  return (
    previous.length >= TREND_MINIMUM &&
    previousAverage > 0 &&
    recentAverage > previousAverage * TREND_RATIO
  );
};

const proxyTrend = (completed: CompletedUsage[]) =>
  risingTrend(completed.map((usage) => usage.proxyBytes ?? 0));

const minutesTrend = (completed: CompletedUsage[]) =>
  risingTrend(completed.map((usage) => usage.browserMs ?? 0));

/**
 * The per-provider × ATS report, measured over the last
 * `COST_REPORT_WINDOW_DAYS` days. Completion is Applications, not tries: a
 * retried Application is one attempt at the product, and an email-confirmed
 * send is completed even though its attempt keeps the `unconfirmed` outcome.
 * Every total is summed in SQLite, and only the window's browser durations
 * leave the database: a page load reads one row per provider, ATS and user
 * instead of every attempt.
 * @param db The database to read.
 * @param clock The clock that sets the window.
 * @returns One row per provider and ATS, sorted by provider then ATS.
 */
export function buildProviderReport(db: AppDatabase, clock: Clock) {
  const sinceMs = sinceOf(clock);
  const population = readCostPopulation(db, sinceMs);
  const completed = completedUsage(db, sinceMs);
  const trend = proxyTrend(completed);
  const minutes = minutesTrend(completed);

  if (trend) {
    raiseAlert(db, clock, "browser.proxy_trend", {
      recentWindow: TREND_WINDOW,
      ratio: TREND_RATIO,
    });
  }

  if (minutes) {
    raiseAlert(db, clock, "browser.minutes_trend", {
      recentWindow: TREND_WINDOW,
      ratio: TREND_RATIO,
    });
  }

  return summarise(population.groups, trend, population);
}

/**
 * Cost per completed Application over the last `COST_REPORT_WINDOW_DAYS` days
 * (ADR 0026): the attempted Browser Use spend plus the Anthropic spend of the
 * users whose attempts are counted, divided by the sent Applications. The
 * population's share of a user's spend is all of it, by definition.
 * @param db The database to read.
 * @param clock The clock that sets the window.
 * @returns The attempted and completed Application counts, the cost split, the gate verdict and the proxy figures.
 */
export function buildCostSummary(db: AppDatabase, clock: Clock) {
  const sinceMs = sinceOf(clock);
  const population = readCostPopulation(db, sinceMs);

  const browserMicros = population.groups.reduce((total, group) => total + group.browserMicros, 0);
  const proxyBytes = population.groups.reduce((total, group) => total + group.proxyBytes, 0);

  const anthropicMicros = [...population.attemptedByUser.keys()].reduce(
    (total, userId) => total + (population.llmByUser.get(userId) ?? 0),
    0,
  );

  const costPerCompleted = ratio(browserMicros + anthropicMicros, population.completed);

  return {
    anthropicMicros,
    attempted: population.attempted,
    browserMicros,
    completed: population.completed,
    costGateMicros: COST_GATE_MICROS,
    costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
    costMicrosPerCompleted: costPerCompleted,
    proxyMbPerCompleted: ratio(proxyBytes, population.completed * 1_000_000),
    proxyTrend: proxyTrend(completedUsage(db, sinceMs)),
  };
}
