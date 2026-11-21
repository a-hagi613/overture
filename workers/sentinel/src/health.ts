import { z } from "zod";

export const HEALTH_TIMEOUT_MS = 15_000;

const healthBodySchema = z.object({ status: z.string() });

/**
 * Probes the app from outside Fly: a 2xx carrying `{"status":"ok"}` is healthy; a 5xx, a
 * Cloudflare error page, a timeout or any other body is not.
 * @param url the health endpoint to call
 * @param fetchImpl an injectable fetch, so tests answer from a local replay server
 * @returns whether the app is healthy and a short reason for the alert when it is not
 */
export async function probeHealth(url: string, fetchImpl: typeof fetch = fetch) {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? `${error.name}: ${error.message}` : "request failed",
    };
  }

  if (!response.ok) {
    return { ok: false, detail: `HTTP ${String(response.status)}` };
  }

  let status: string | null = null;

  try {
    status = healthBodySchema.parse(await response.json()).status;
  } catch {
    status = null;
  }

  if (status !== "ok") {
    return { ok: false, detail: `health body status ${String(status)}` };
  }

  return { ok: true, detail: "ok" };
}
