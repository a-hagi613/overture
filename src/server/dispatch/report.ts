import { asc, eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, attempts, postings, users } from "../platform/db/schema.ts";
import { raiseAlert } from "../platform/alerts.ts";

export const COST_GATE_MICROS = 30_000;
const TREND_WINDOW = 20;
const TREND_MINIMUM = 10;
const TREND_RATIO = 1.2;

const ATTEMPTED_EXCLUDED = new Set(["posting_closed", "duplicate", "needs_review"]);

interface AttemptRow {
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

const attemptedRows = (rows: AttemptRow[]) =>
  rows.filter((row) => row.outcome === null || !ATTEMPTED_EXCLUDED.has(row.outcome));

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));

  return sorted[index] ?? null;
};

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? null : numerator / denominator;

function summarise(rows: AttemptRow[], trend: boolean) {
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
      const costMicros = attempted.reduce((total, row) => total + (row.costMicros ?? 0), 0);
      const costPerCompleted = ratio(costMicros, sent.length);

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

  return summarise(rows, trend);
}

export function buildCostSummary(db: AppDatabase) {
  const rows = attemptRows(db);
  const attempted = attemptedRows(rows);
  const sent = rows.filter((row) => row.outcome === "sent").length;
  const costMicros = attempted.reduce((total, row) => total + (row.costMicros ?? 0), 0);
  const proxyBytes = attempted.reduce((total, row) => total + (row.proxyBytes ?? 0), 0);
  const costPerCompleted = ratio(costMicros, sent);

  return {
    completed: sent,
    costGateMicros: COST_GATE_MICROS,
    costGateMet: costPerCompleted === null ? null : costPerCompleted <= COST_GATE_MICROS,
    costMicrosPerCompleted: costPerCompleted,
    proxyMbPerCompleted: ratio(proxyBytes, sent * 1_000_000),
    proxyTrend: proxyTrend(rows),
  };
}
