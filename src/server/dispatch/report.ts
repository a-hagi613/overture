import { asc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, attempts, postings, users } from "../platform/db/schema.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { percentile, ratio } from "../platform/stats.ts";

import { applicationLlmMicrosByUser } from "./application-spend.ts";

export const COST_GATE_MICROS = 30_000;
const TREND_WINDOW = 20;
const TREND_MINIMUM = 10;
const TREND_RATIO = 1.2;

const ATTEMPTED_EXCLUDED = new Set(["posting_closed", "duplicate", "needs_review"]);

/**
 * Whether a try with this outcome counts as an attempted Application (ADR 0026).
 * @param outcome The outcome of the try, or null while it is still running.
 * @returns True when the try counts towards the cost denominator.
 */
export const isAttempted = (outcome: string | null) =>
  outcome === null || !ATTEMPTED_EXCLUDED.has(outcome);

interface AttemptRow {
  userId: string;
  provider: string;
  ats: string | null;
  outcome: string | null;
  browserMs: number | null;
  proxyBytes: number | null;
  costMicros: number | null;
  captchaSeen: boolean;
  codeUsed: boolean;
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

const attemptedRows = (rows: AttemptRow[]) => rows.filter((row) => isAttempted(row.outcome));

function anthropicMicrosOf(
  group: AttemptRow[],
  population: AttemptRow[],
  llmByUser: Map<string, number>,
) {
  const perUser = (rows: AttemptRow[]) => {
    const counts = new Map<string, number>();

    for (const row of rows) {
      counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    }

    return counts;
  };

  const totals = perUser(attemptedRows(population));
  const inGroup = perUser(attemptedRows(group));

  return [...inGroup].reduce(
    (total, [userId, count]) =>
      total + ((llmByUser.get(userId) ?? 0) * count) / (totals.get(userId) ?? count),
    0,
  );
}

function summarise(rows: AttemptRow[], trend: boolean, llmByUser: Map<string, number>) {
  const groups = new Map<string, AttemptRow[]>();

  for (const row of rows) {
    const key = `${row.provider}\u0000${row.ats ?? "unknown"}`;
    const group = groups.get(key) ?? [];

    group.push(row);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const [provider = "", ats = "unknown"] = key.split("\u0000");

      const attempted = attemptedRows(group);

      const sent = group.filter((row) => row.outcome === "sent");

      const durations = group
        .map((row) => row.browserMs)
        .filter((value): value is number => value !== null && value > 0);

      const proxyBytes = attempted.reduce((total, row) => total + (row.proxyBytes ?? 0), 0);
      const browserMicros = attempted.reduce((total, row) => total + (row.costMicros ?? 0), 0);

      const costPerCompleted = ratio(
        browserMicros + anthropicMicrosOf(attempted, rows, llmByUser),
        sent.length,
      );

      return {
        ats,
        attempted: attempted.length,
        challengeRate: ratio(attempted.filter((row) => row.captchaSeen).length, attempted.length),
        codeRate: ratio(attempted.filter((row) => row.codeUsed).length, attempted.length),
        completionRate: ratio(sent.length, attempted.length),
        costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
        costGateMicros: COST_GATE_MICROS,
        costMicrosPerCompleted: costPerCompleted,
        p50BrowserMs: percentile(durations, 0.5),
        p95BrowserMs: percentile(durations, 0.95),
        provider,
        proxyMbPerCompleted: ratio(proxyBytes, sent.length * 1_000_000),
        proxyTrend: trend,
        sent: sent.length,
      };
    })
    .toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.ats.localeCompare(right.ats),
    );
}

function proxyTrend(rows: AttemptRow[]) {
  const completed = rows.flatMap((row) => (row.outcome === "sent" ? [row.proxyBytes ?? 0] : []));

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
}

function attemptRows(db: AppDatabase) {
  return db
    .select({
      ats: postings.ats,
      browserMs: attempts.browserMs,
      userId: attempts.userId,
      captchaSeen: attempts.captchaSeen,
      codeUsed: attempts.codeUsed,
      costMicros: attempts.costMicros,
      outcome: attempts.outcome,
      provider: attempts.provider,
      proxyBytes: attempts.proxyBytes,
      startedAt: attempts.startedAt,
    })
    .from(attempts)
    .innerJoin(applications, eq(attempts.applicationId, applications.id))
    .innerJoin(postings, eq(applications.postingId, postings.id))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(sql`${users.role} <> 'demo'`)
    .orderBy(asc(attempts.startedAt))
    .all();
}

export function buildProviderReport(db: AppDatabase, clock: Clock) {
  const rows = attemptRows(db);
  const trend = proxyTrend(rows);

  if (trend) {
    raiseAlert(db, clock, "browser.proxy_trend", {
      recentWindow: TREND_WINDOW,
      ratio: TREND_RATIO,
    });
  }

  return summarise(rows, trend, applicationLlmMicrosByUser(db, null));
}

/**
 * Cost per completed Application for the population of attempts (ADR 0026):
 * the attempted Browser Use spend plus the Anthropic spend of the users whose
 * attempts are counted, divided by the sent Applications.
 * @param db The database to read.
 * @returns The completed count, the cost split, the gate verdict and the proxy figures.
 */
export function buildCostSummary(db: AppDatabase) {
  const rows = attemptRows(db);
  const attempted = attemptedRows(rows);
  const sent = rows.filter((row) => row.outcome === "sent").length;
  const browserMicros = attempted.reduce((total, row) => total + (row.costMicros ?? 0), 0);
  const proxyBytes = attempted.reduce((total, row) => total + (row.proxyBytes ?? 0), 0);
  const anthropicMicros = anthropicMicrosOf(attempted, rows, applicationLlmMicrosByUser(db, null));

  const costPerCompleted = ratio(browserMicros + anthropicMicros, sent);

  return {
    anthropicMicros,
    browserMicros,
    completed: sent,
    costGateMicros: COST_GATE_MICROS,
    costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
    costMicrosPerCompleted: costPerCompleted,
    proxyMbPerCompleted: ratio(proxyBytes, sent * 1_000_000),
    proxyTrend: proxyTrend(rows),
  };
}
