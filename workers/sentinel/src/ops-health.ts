import { z } from "zod";

/** The signed ops path the app answers (WS-21, issue #634). */
export const OPS_HEALTH_PATH = "/internal/ops/health";

/** The epoch-millisecond header the signature covers. */
export const OPS_HEALTH_TIMESTAMP_HEADER = "x-overture-ops-timestamp";

/** The lowercase-hex HMAC-SHA256 signature header. */
export const OPS_HEALTH_SIGNATURE_HEADER = "x-overture-ops-signature";

export const OPS_HEALTH_TIMEOUT_MS = 15_000;

export const OPS_MEMORY_CEILING = 0.8;
export const OPS_DISK_CEILING = 0.75;
export const OPS_EVENT_LOOP_LAG_CEILING_MS = 500;
export const OPS_ATS_FAILURE_CEILING = 0.3;
export const OPS_ATS_MIN_ATTEMPTS = 5;

export const opsHealthBodySchema = z.object({
  ats: z.object({
    attempts: z.number().nonnegative(),
    failures: z.number().nonnegative(),
    failureRate: z.number().min(0).max(1),
    windowMs: z.number().positive(),
  }),
  disk: z.object({ mount: z.string(), usedRatio: z.number().min(0).max(1) }),
  eventLoopLag: z.object({ p95Ms: z.number().nonnegative().nullable() }),
  memory: z.object({
    rssBytes: z.number().nonnegative(),
    totalBytes: z.number().nonnegative(),
    usedRatio: z.number().min(0).max(1),
  }),
  status: z.string(),
});

export type OpsHealthBody = z.infer<typeof opsHealthBodySchema>;

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The headers the app's internal ops endpoint verifies: HMAC-SHA256 over
 * `METHOD\npath\ntimestamp`. A Worker has no `node:crypto`, so this uses Web Crypto.
 * @param secret The shared ops secret.
 * @param timestampMs The epoch-millisecond timestamp.
 * @param method The HTTP method.
 * @param path The signed path.
 * @returns The two signed-request headers.
 */
export async function opsHealthHeaders(
  secret: string,
  timestampMs: number,
  method = "GET",
  path = OPS_HEALTH_PATH,
) {
  const timestamp = String(Math.trunc(timestampMs));
  const signature = await hmacHex(secret, `${method}\n${path}\n${timestamp}`);

  return {
    [OPS_HEALTH_SIGNATURE_HEADER]: signature,
    [OPS_HEALTH_TIMESTAMP_HEADER]: timestamp,
  } satisfies Record<string, string>;
}

export async function probeOpsHealth(
  url: string,
  secret: string,
  fetchImpl: typeof fetch,
  now: () => number,
) {
  let headers: Record<string, string>;

  try {
    headers = await opsHealthHeaders(secret, now());
  } catch (error) {
    return { detail: error instanceof Error ? error.message : "signing failed", ok: false };
  }

  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json", ...headers },
      redirect: "manual",
      signal: AbortSignal.timeout(OPS_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      detail: error instanceof Error ? `${error.name}: ${error.message}` : "request failed",
      ok: false,
    };
  }

  if (!response.ok) {
    return { detail: `HTTP ${String(response.status)}`, ok: false };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = opsHealthBodySchema.safeParse(body);

  if (!parsed.success) {
    return { detail: "the ops health answer is unreadable", ok: false };
  }

  return { body: parsed.data, detail: "ok", ok: true };
}

/**
 * The threshold breaches one ops health answer contains, as short alert-body strings. Pure so the
 * boundaries can be tested without a Worker or a network.
 * @param body A validated ops health answer.
 * @returns One sentence per breach; empty means every threshold is inside its ceiling.
 */
export function opsHealthProblems(body: OpsHealthBody) {
  const problems: string[] = [];

  if (body.memory.usedRatio > OPS_MEMORY_CEILING) {
    problems.push(
      `RAM at ${String(Math.round(body.memory.usedRatio * 100))}% (ceiling ${String(OPS_MEMORY_CEILING * 100)}%)`,
    );
  }

  if (body.disk.usedRatio > OPS_DISK_CEILING) {
    problems.push(
      `NVMe ${body.disk.mount} at ${String(Math.round(body.disk.usedRatio * 100))}% (ceiling ${String(OPS_DISK_CEILING * 100)}%)`,
    );
  }

  if (body.eventLoopLag.p95Ms !== null && body.eventLoopLag.p95Ms > OPS_EVENT_LOOP_LAG_CEILING_MS) {
    problems.push(
      `event-loop lag p95 ${String(Math.round(body.eventLoopLag.p95Ms))} ms (ceiling ${String(OPS_EVENT_LOOP_LAG_CEILING_MS)} ms)`,
    );
  }

  if (body.ats.attempts >= OPS_ATS_MIN_ATTEMPTS && body.ats.failureRate > OPS_ATS_FAILURE_CEILING) {
    problems.push(
      `ATS apply failures ${String(Math.round(body.ats.failureRate * 100))}% of ${String(body.ats.attempts)} attempts (ceiling ${String(OPS_ATS_FAILURE_CEILING * 100)}%)`,
    );
  }

  return problems;
}
