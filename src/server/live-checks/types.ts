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

/**
 * Records a check deliberately not run because the app is degraded; it is not a failure.
 * @param check the check's name
 * @param startedAt when the group started, in epoch milliseconds
 * @param reason why it was skipped, shown in the recorded result
 * @returns an ok result carrying the skip reason
 */
export function skippedResult(check: string, startedAt: number, reason: string) {
  return {
    check,
    ok: true,
    startedAt,
    durationMs: 0,
    detail: { skipped: reason },
  } satisfies LiveCheckResult;
}
