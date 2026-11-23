import { copy } from "../../../shared/copy.ts";
import type { AttemptOutcome, AttemptOutcomeFilter, AttemptRow } from "../../lib/admin-api.ts";

export const ATTEMPT_OUTCOME_FILTER_ORDER: readonly AttemptOutcomeFilter[] = [
  "all",
  "completed",
  "challenge_blocked",
  "error",
  "timeout",
];

export type AttemptTone = "active" | "ok" | "need" | "muted";

const OUTCOME_DISPLAY: Record<AttemptOutcome, { label: string; tone: AttemptTone }> = {
  blocked: { label: copy.admin.attemptsOutcomeBlocked, tone: "need" },
  captcha_blocked: { label: copy.admin.attemptsOutcomeCaptchaBlocked, tone: "need" },
  code_timeout: { label: copy.admin.attemptsOutcomeCodeTimeout, tone: "need" },
  crash: { label: copy.admin.attemptsOutcomeCrash, tone: "need" },
  duplicate: { label: copy.admin.attemptsOutcomeDuplicate, tone: "muted" },
  form_changed: { label: copy.admin.attemptsOutcomeFormChanged, tone: "need" },
  identity_mismatch: { label: copy.admin.attemptsOutcomeIdentityMismatch, tone: "need" },
  interrupted: { label: copy.admin.attemptsOutcomeInterrupted, tone: "muted" },
  needs_review: { label: copy.admin.attemptsOutcomeNeedsReview, tone: "muted" },
  posting_closed: { label: copy.admin.attemptsOutcomePostingClosed, tone: "muted" },
  provider_error: { label: copy.admin.attemptsOutcomeProviderError, tone: "need" },
  sent: { label: copy.admin.attemptsOutcomeSent, tone: "ok" },
  timeout: { label: copy.admin.attemptsOutcomeTimeout, tone: "need" },
  unconfirmed: { label: copy.admin.attemptsOutcomeUnconfirmed, tone: "muted" },
  upload_failed: { label: copy.admin.attemptsOutcomeUploadFailed, tone: "need" },
};

export const ATTEMPT_TONE_CLASSES: Record<AttemptTone, string> = {
  active: "bg-signal-soft text-signal-text",
  muted: "bg-muted text-muted-foreground",
  need: "bg-need-soft text-need",
  ok: "bg-ok-soft text-ok",
};

export function isActiveAttempt(attempt: AttemptRow) {
  return attempt.endedAt === null || attempt.outcome === null;
}

export function attemptOutcomeDisplay(outcome: AttemptOutcome | null) {
  if (outcome === null) {
    return { label: copy.admin.attemptsOutcomeActive, tone: "active" as const };
  }

  return OUTCOME_DISPLAY[outcome];
}

export function attemptFilterLabel(
  filter: AttemptOutcomeFilter,
  counts: {
    all: number;
    challenge_blocked: number;
    completed: number;
    error: number;
    timeout: number;
  },
) {
  if (filter === "all") {
    return copy.admin.attemptsFilterAll(counts.all);
  }

  if (filter === "completed") {
    return copy.admin.attemptsFilterCompleted(counts.completed);
  }

  if (filter === "challenge_blocked") {
    return copy.admin.attemptsFilterChallengeBlocked(counts.challenge_blocked);
  }

  if (filter === "timeout") {
    return copy.admin.attemptsFilterTimeout(counts.timeout);
  }

  return copy.admin.attemptsFilterError(counts.error);
}

export function formatProxyTraffic(proxyBytes: number | null) {
  if (proxyBytes === null) {
    return copy.admin.reportNone;
  }

  return copy.admin.reportMegabytes(proxyBytes / 1_000_000);
}

export function formatAttemptDuration(browserMs: number | null) {
  if (browserMs === null) {
    return copy.admin.reportNone;
  }

  return copy.admin.reportSeconds(browserMs);
}

export function formatAttemptCost(costMicros: number | null) {
  if (costMicros === null) {
    return copy.admin.reportNone;
  }

  return copy.admin.reportDollars(costMicros);
}

export function safeExternalHttpUrl(raw: string | null) {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.protocol === "https:") {
      return parsed.toString();
    }

    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return parsed.toString();
    }

    return null;
  } catch {
    return null;
  }
}
