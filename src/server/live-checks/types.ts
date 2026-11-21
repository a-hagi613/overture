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

/** A check deliberately not run because the app is degraded; it is not a failure. */
export function skippedResult(check: string, startedAt: number, reason: string) {
  return {
    check,
    ok: true,
    startedAt,
    durationMs: 0,
    detail: { skipped: reason },
  } satisfies LiveCheckResult;
}
