import type { AlertDetail } from "../platform/alerts.ts";

export const LIVE_CHECK_GROUPS = ["forms", "llm", "mail", "r2", "alerts"] as const;

export type LiveCheckGroup = (typeof LIVE_CHECK_GROUPS)[number];

export interface LiveCheckResult {
  check: string;
  ok: boolean;
  startedAt: number;
  durationMs: number;
  detail: AlertDetail;
}

export function failedResult(check: string, startedAt: number, error: string, durationMs = 0) {
  return { check, ok: false, startedAt, durationMs, detail: { error } } satisfies LiveCheckResult;
}
