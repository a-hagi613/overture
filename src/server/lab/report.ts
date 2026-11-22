import type { AppDatabase } from "../platform/db/client.ts";

import { percentile, ratio } from "../platform/stats.ts";
import { readLabRuns } from "./store.ts";

export interface LabReportRow {
  provider: string;
  page: string;
  ats: string | null;
  sessions: number;
  completed: number;
  completionRate: number | null;
  challengeRate: number | null;
  codeRate: number | null;
  captchaScore: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
  proxyMbPerCompleted: number | null;
  costMicrosPerCompleted: number | null;
  lastError: string | null;
}

interface LabRow {
  provider: string;
  page: string;
  ats: string | null;
  outcome: string;
  challengeSeen: boolean;
  codeAsked: boolean;
  durationMs: number;
  proxyBytes: number | null;
  costMicros: number | null;
  captchaScore: number | null;
  errorCode: string | null;
}

const pageLabel = (row: LabRow) => (row.ats === null ? row.page : `${row.page}:${row.ats}`);

export function summariseLabRows(rows: LabRow[]) {
  const groups = new Map<string, LabRow[]>();

  for (const row of rows) {
    const key = `${row.provider}\u0000${pageLabel(row)}`;
    const group = groups.get(key) ?? [];

    group.push(row);
    groups.set(key, group);
  }

  const summarised = [...groups.entries()]
    .map(([key, group]) => {
      const [provider = "", page = ""] = key.split("\u0000");

      const [first] = group;

      const completed = group.filter((row) => row.outcome === "completed");
      const durations = group.map((row) => row.durationMs).filter((value) => value > 0);

      const scores = group
        .map((row) => row.captchaScore)
        .filter((value): value is number => value !== null);

      const proxyBytes = group.reduce((total, row) => total + (row.proxyBytes ?? 0), 0);
      const costMicros = group.reduce((total, row) => total + (row.costMicros ?? 0), 0);

      return {
        ats: first?.ats ?? null,
        captchaScore: ratio(
          scores.reduce((total, value) => total + value, 0),
          scores.length,
        ),
        challengeRate: ratio(group.filter((row) => row.challengeSeen).length, group.length),
        codeRate: ratio(group.filter((row) => row.codeAsked).length, group.length),
        completed: completed.length,
        completionRate: ratio(completed.length, group.length),
        costMicrosPerCompleted: ratio(costMicros, completed.length),
        lastError:
          group.flatMap((row) => (row.errorCode === null ? [] : [row.errorCode])).at(-1) ?? null,
        p50DurationMs: percentile(durations, 0.5),
        p95DurationMs: percentile(durations, 0.95),
        page,
        provider,
        proxyMbPerCompleted: ratio(proxyBytes, completed.length * 1_000_000),
        sessions: group.length,
      };
    })
    .toSorted(
      (left, right) =>
        left.provider.localeCompare(right.provider) || left.page.localeCompare(right.page),
    );

  return summarised satisfies LabReportRow[];
}

export function buildLabReport(db: AppDatabase) {
  return summariseLabRows(readLabRuns(db));
}
