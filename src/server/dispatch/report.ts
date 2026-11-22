import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, attempts, postings, users } from "../platform/db/schema.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { ratio } from "../platform/stats.ts";

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
  attempted: number;
  browserMicros: number;
  captchaSeen: number;
  codeUsed: number;
  proxyBytes: number;
  sent: number;
}

interface DurationRanks {
  ats: string | null;
  provider: string;
  p50: number | null;
  p95: number | null;
}

interface GroupSummary {
  key: string;
  ats: string;
  provider: string;
  attempted: number;
  attemptedByUser: Map<string, number>;
  browserMicros: number;
  captchaSeen: number;
  codeUsed: number;
  proxyBytes: number;
  sent: number;
}

interface CostPopulation {
  groups: GroupSummary[];
  attemptedByUser: Map<string, number>;
  llmByUser: Map<string, number>;
}

export interface ProviderReportRow {
  provider: string;
  ats: string;
  attempted: number;
  sent: number;
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

const sinceOf = (clock: Clock) => clock.now() - COST_REPORT_WINDOW_DAYS * DAY_MS;

const readGroupTotals = (db: AppDatabase, sinceMs: number) =>
  db
    .select({
      ats: postings.ats,
      provider: attempts.provider,
      userId: applications.userId,
      attempted: sql<number>`sum(case when ${ATTEMPTED} then 1 else 0 end)`,
      browserMicros: sql<number>`sum(case when ${ATTEMPTED} then coalesce(${attempts.costMicros}, 0) else 0 end)`,
      captchaSeen: sql<number>`sum(case when ${ATTEMPTED} and ${attempts.captchaSeen} then 1 else 0 end)`,
      codeUsed: sql<number>`sum(case when ${ATTEMPTED} and ${attempts.codeUsed} then 1 else 0 end)`,
      proxyBytes: sql<number>`sum(case when ${ATTEMPTED} then coalesce(${attempts.proxyBytes}, 0) else 0 end)`,
      sent: sql<number>`sum(case when ${attempts.outcome} = 'sent' then 1 else 0 end)`,
    })
    .from(attempts)
    .innerJoin(applications, eq(attempts.applicationId, applications.id))
    .innerJoin(postings, eq(applications.postingId, postings.id))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(sql`${users.role} <> 'demo'`, gte(attempts.startedAt, sinceMs)))
    .groupBy(attempts.provider, postings.ats, applications.userId)
    .all();

const readDurationRanks = (db: AppDatabase, sinceMs: number) =>
  db.all<DurationRanks>(sql`
    SELECT provider, ats,
      max(CASE WHEN position = p50_position THEN browser_ms END) AS p50,
      max(CASE WHEN position = p95_position THEN browser_ms END) AS p95
    FROM (
      SELECT provider, ats, browser_ms, position,
        CAST((total - 1) * 0.5 AS INTEGER) + 1 AS p50_position,
        CAST((total - 1) * 0.95 AS INTEGER) + 1 AS p95_position
      FROM (
        SELECT ${attempts.provider} AS provider, ${postings.ats} AS ats,
          ${attempts.browserMs} AS browser_ms,
          row_number() OVER (
            PARTITION BY ${attempts.provider}, ${postings.ats} ORDER BY ${attempts.browserMs}
          ) AS position,
          count(*) OVER (PARTITION BY ${attempts.provider}, ${postings.ats}) AS total
        FROM ${attempts}
        INNER JOIN ${applications} ON ${applications.id} = ${attempts.applicationId}
        INNER JOIN ${postings} ON ${postings.id} = ${applications.postingId}
        INNER JOIN ${users} ON ${users.id} = ${applications.userId}
        WHERE ${users.role} <> 'demo' AND ${attempts.startedAt} >= ${sinceMs}
          AND ${attempts.browserMs} IS NOT NULL AND ${attempts.browserMs} > 0
      )
    )
    GROUP BY provider, ats
  `);

const summariseGroups = (totals: GroupTotals[]) => {
  const groups = new Map<string, GroupSummary>();

  for (const row of totals) {
    const key = groupKey(row.provider, row.ats);

    const group = groups.get(key) ?? {
      ats: row.ats ?? "unknown",
      attempted: 0,
      attemptedByUser: new Map<string, number>(),
      browserMicros: 0,
      captchaSeen: 0,
      codeUsed: 0,
      key,
      provider: row.provider,
      proxyBytes: 0,
      sent: 0,
    };

    group.attempted += row.attempted;
    group.attemptedByUser.set(
      row.userId,
      (group.attemptedByUser.get(row.userId) ?? 0) + row.attempted,
    );
    group.browserMicros += row.browserMicros;
    group.captchaSeen += row.captchaSeen;
    group.codeUsed += row.codeUsed;
    group.proxyBytes += row.proxyBytes;
    group.sent += row.sent;
    groups.set(key, group);
  }

  return [...groups.values()];
};

const populationByUser = (groups: GroupSummary[]) => {
  const totals = new Map<string, number>();

  for (const group of groups) {
    for (const [userId, count] of group.attemptedByUser) {
      totals.set(userId, (totals.get(userId) ?? 0) + count);
    }
  }

  return totals;
};

const readCostPopulation = (db: AppDatabase, sinceMs: number) => {
  const groups = summariseGroups(readGroupTotals(db, sinceMs));

  return {
    attemptedByUser: populationByUser(groups),
    groups,
    llmByUser: applicationLlmMicrosByUser(db, sinceMs),
  };
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

const summarise = (
  groups: GroupSummary[],
  ranks: DurationRanks[],
  trend: boolean,
  population: CostPopulation,
) => {
  const percentiles = new Map(ranks.map((row) => [groupKey(row.provider, row.ats), row]));

  return groups
    .map((group) => {
      const durations = percentiles.get(group.key);

      const costPerCompleted = ratio(
        group.browserMicros +
          anthropicMicrosOf(
            group.attemptedByUser,
            population.attemptedByUser,
            population.llmByUser,
          ),
        group.sent,
      );

      return {
        ats: group.ats,
        attempted: group.attempted,
        challengeRate: ratio(group.captchaSeen, group.attempted),
        codeRate: ratio(group.codeUsed, group.attempted),
        completionRate: ratio(group.sent, group.attempted),
        costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
        costGateMicros: COST_GATE_MICROS,
        costMicrosPerCompleted: costPerCompleted,
        p50BrowserMs: durations?.p50 ?? null,
        p95BrowserMs: durations?.p95 ?? null,
        provider: group.provider,
        proxyMbPerCompleted: ratio(group.proxyBytes, group.sent * 1_000_000),
        proxyTrend: trend,
        sent: group.sent,
      };
    })
    .toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.ats.localeCompare(right.ats),
    );
};

const completedProxyBytes = (db: AppDatabase, sinceMs: number) =>
  db
    .select({ proxyBytes: attempts.proxyBytes })
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
    .toReversed()
    .map((row) => row.proxyBytes ?? 0);

const proxyTrend = (completed: number[]) => {
  if (completed.length < TREND_WINDOW + TREND_MINIMUM) {
    return false;
  }

  const recent = completed.slice(-TREND_WINDOW);
  const previous = completed.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
  const recentAverage = recent.reduce((total, value) => total + value, 0) / recent.length;
  const previousAverage = previous.reduce((total, value) => total + value, 0) / previous.length;

  return (
    previous.length >= TREND_MINIMUM &&
    previousAverage > 0 &&
    recentAverage > previousAverage * TREND_RATIO
  );
};

/**
 * The per-provider × ATS report, measured over the last
 * `COST_REPORT_WINDOW_DAYS` days. Every total is summed in SQLite and the
 * p50/p95 durations are picked by rank there, so a page load reads two rows per
 * group instead of every attempt.
 * @param db The database to read.
 * @param clock The clock that sets the window.
 * @returns One row per provider and ATS, sorted by provider then ATS.
 */
export function buildProviderReport(db: AppDatabase, clock: Clock) {
  const sinceMs = sinceOf(clock);
  const population = readCostPopulation(db, sinceMs);
  const trend = proxyTrend(completedProxyBytes(db, sinceMs));

  if (trend) {
    raiseAlert(db, clock, "browser.proxy_trend", {
      recentWindow: TREND_WINDOW,
      ratio: TREND_RATIO,
    });
  }

  return summarise(population.groups, readDurationRanks(db, sinceMs), trend, population);
}

/**
 * Cost per completed Application over the last `COST_REPORT_WINDOW_DAYS` days
 * (ADR 0026): the attempted Browser Use spend plus the Anthropic spend of the
 * users whose attempts are counted, divided by the sent Applications. The
 * population's share of a user's spend is all of it, by definition.
 * @param db The database to read.
 * @param clock The clock that sets the window.
 * @returns The completed count, the cost split, the gate verdict and the proxy figures.
 */
export function buildCostSummary(db: AppDatabase, clock: Clock) {
  const sinceMs = sinceOf(clock);
  const population = readCostPopulation(db, sinceMs);

  const browserMicros = population.groups.reduce((total, group) => total + group.browserMicros, 0);
  const proxyBytes = population.groups.reduce((total, group) => total + group.proxyBytes, 0);
  const sent = population.groups.reduce((total, group) => total + group.sent, 0);

  const anthropicMicros = [...population.attemptedByUser.keys()].reduce(
    (total, userId) => total + (population.llmByUser.get(userId) ?? 0),
    0,
  );

  const costPerCompleted = ratio(browserMicros + anthropicMicros, sent);

  return {
    anthropicMicros,
    browserMicros,
    completed: sent,
    costGateMicros: COST_GATE_MICROS,
    costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
    costMicrosPerCompleted: costPerCompleted,
    proxyMbPerCompleted: ratio(proxyBytes, sent * 1_000_000),
    proxyTrend: proxyTrend(completedProxyBytes(db, sinceMs)),
  };
}
