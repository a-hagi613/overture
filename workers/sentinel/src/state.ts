import { z } from "zod";

import type { SentinelBucket } from "./bucket.ts";

export const SENTINEL_STATE_KEY = "ops/sentinel-state.json";

const stateSchema = z.object({
  version: z.literal(1),
  health: z.enum(["ok", "failing"]).nullable(),
  manifest: z.enum(["ok", "failing"]).nullable(),
  degradedSince: z.string().nullable(),
  lastAlerts: z.record(z.string(), z.string()),
});

export type SentinelState = z.infer<typeof stateSchema>;

export function emptyState() {
  return {
    version: 1,
    health: null,
    manifest: null,
    degradedSince: null,
    lastAlerts: {},
  } satisfies SentinelState;
}

export async function readState(bucket: SentinelBucket) {
  const raw = await bucket.get(SENTINEL_STATE_KEY);

  if (raw === null) {
    return emptyState();
  }

  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : emptyState();
  } catch {
    return emptyState();
  }
}

export async function writeState(bucket: SentinelBucket, state: SentinelState) {
  await bucket.put(SENTINEL_STATE_KEY, `${JSON.stringify(state)}\n`);
}

/**
 * Decides whether a recurring condition pushes again. The first occurrence always pushes; after
 * that it waits for the window, so a ten-minute cron cannot flood the phone.
 * @param state the persisted sentinel state
 * @param key the alert kind
 * @param at the instant of this run, in epoch milliseconds
 * @param windowMs how long to stay quiet in the same condition
 * @returns whether this run should push
 */
export function shouldAlert(state: SentinelState, key: string, at: number, windowMs: number) {
  const last = state.lastAlerts[key];

  if (last === undefined) {
    return true;
  }

  const lastAt = Date.parse(last);

  return Number.isNaN(lastAt) || at - lastAt >= windowMs;
}

export function markAlert(state: SentinelState, key: string, at: number) {
  state.lastAlerts[key] = new Date(at).toISOString();
}
