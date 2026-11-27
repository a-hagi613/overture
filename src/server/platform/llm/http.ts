import { randomInt } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { logRetry } from "../log.ts";

export const DEFAULT_LLM_TIMEOUT_MS = 60_000;
export const DEFAULT_LLM_MAX_ATTEMPTS = 3;
export const LLM_RETRY_BASE_MS = 200;

const MAX_RETRY_DELAY_MS = 5000;
const MAX_RETRY_AFTER_MS = 30_000;
const ERROR_BODY_SLICE = 500;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const NOT_PROCESSED_STATUSES = new Set([429, 503]);

/**
 * A failed LLM HTTP call with the status and the attempt count attached, so a caller can decide
 * between a permanent failure, a retry and a batch that is gone without parsing an error string.
 */
export class LlmHttpError extends Error {
  readonly attempts: number;
  readonly detail: string;
  readonly label: string;
  readonly status: number | null;
  readonly timedOut: boolean;

  constructor(input: {
    attempts: number;
    detail: string;
    label: string;
    status: number | null;
    timedOut: boolean;
  }) {
    const prefix =
      input.status === null
        ? `the LLM request ${input.label} failed`
        : `LLM API ${String(input.status)} on ${input.label}`;

    super(`${prefix} after ${String(input.attempts)} attempt(s): ${input.detail}`);

    this.name = "LlmHttpError";
    this.attempts = input.attempts;
    this.detail = input.detail;
    this.label = input.label;
    this.status = input.status;
    this.timedOut = input.timedOut;
  }
}

export interface LlmFetchOptions {
  body?: string | undefined;
  headers: Record<string, string>;
  /** True when resending the request cannot bill or duplicate work. */
  idempotent: boolean;
  /** A safe path label for the error and the retry log; never a signed URL or a query string. */
  label: string;
  method: "GET" | "POST";
  maxAttempts?: number | undefined;
  retryBaseMs?: number | undefined;
  timeoutMs?: number | undefined;
}

type AttemptResult =
  | { kind: "ok"; response: Response }
  | { error: LlmHttpError; kind: "failed"; retryAfterMs: number | null; retryable: boolean };

function isTimeoutError(cause: unknown) {
  return cause instanceof Error && cause.name === "TimeoutError";
}

function isRetryableStatus(status: number) {
  return RETRYABLE_STATUSES.has(status);
}

function retryAfterMs(headers: Headers) {
  const raw = headers.get("retry-after");

  if (raw === null) {
    return null;
  }

  const seconds = Number(raw);

  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1000))
    : null;
}

function backoffMs(attempt: number, baseMs: number, hintedMs: number | null) {
  if (hintedMs !== null) {
    return hintedMs;
  }

  const ceiling = Math.min(MAX_RETRY_DELAY_MS, baseMs * 2 ** Math.max(0, attempt - 1));

  return randomInt(0, ceiling + 1);
}

function networkFailureMessage(cause: unknown, timeoutMs: number, timedOut: boolean) {
  if (timedOut) {
    return `no response within ${String(timeoutMs)} ms`;
  }

  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}

async function fetchWithTimeout(url: string, options: LlmFetchOptions, timeoutMs: number) {
  const init: RequestInit = {
    headers: options.headers,
    method: options.method,
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (options.body !== undefined) {
    init.body = options.body;
  }

  return await fetch(url, init);
}

async function attemptOnce(
  url: string,
  options: LlmFetchOptions,
  timeoutMs: number,
  attempt: number,
  maxAttempts: number,
) {
  let response: Response;

  try {
    response = await fetchWithTimeout(url, options, timeoutMs);
  } catch (error) {
    const timedOut = isTimeoutError(error);

    const failure = new LlmHttpError({
      attempts: attempt,
      detail: networkFailureMessage(error, timeoutMs, timedOut).slice(0, ERROR_BODY_SLICE),
      label: options.label,
      status: null,
      timedOut,
    });

    return {
      error: failure,
      kind: "failed",
      retryAfterMs: null,
      retryable: attempt < maxAttempts && options.idempotent,
    } satisfies AttemptResult;
  }

  if (response.ok) {
    return { kind: "ok", response } satisfies AttemptResult;
  }

  const detail = (await response.text()).slice(0, ERROR_BODY_SLICE);

  const failure = new LlmHttpError({
    attempts: attempt,
    detail,
    label: options.label,
    status: response.status,
    timedOut: false,
  });

  return {
    error: failure,
    kind: "failed",
    retryAfterMs: retryAfterMs(response.headers),
    retryable:
      attempt < maxAttempts &&
      isRetryableStatus(response.status) &&
      (options.idempotent || NOT_PROCESSED_STATUSES.has(response.status)),
  } satisfies AttemptResult;
}

/**
 * Fetches one LLM HTTP endpoint with an explicit timeout and bounded retries.
 *
 * Every attempt aborts after `timeoutMs`, so an upstream that accepts the socket and stalls can
 * never hold a request or a job open forever. A retry happens only for a transient failure
 * (timeout, network error, 408, 429, 500, 502, 503, 504) and only when resending is safe: a
 * non-idempotent call is retried solely for a status the provider refuses before processing it, so
 * a retried message can never be billed twice.
 * @param url The absolute request URL.
 * @param options The request and its retry policy.
 * @returns The successful response; its body is still unread.
 * @throws {LlmHttpError} when the call fails permanently or exhausts its attempts.
 */
export async function llmFetch(url: string, options: LlmFetchOptions) {
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS);
  const baseMs = Math.max(1, options.retryBaseMs ?? LLM_RETRY_BASE_MS);

  const run: (attempt: number) => Promise<Response> = async (attempt) => {
    const result = await attemptOnce(url, options, timeoutMs, attempt, maxAttempts);

    if (result.kind === "ok") {
      return result.response;
    }

    if (!result.retryable) {
      throw result.error;
    }

    logRetry(`llm.http ${options.label}`, attempt, result.error);

    await delay(backoffMs(attempt, baseMs, result.retryAfterMs));

    return await run(attempt + 1);
  };

  return await run(1);
}
