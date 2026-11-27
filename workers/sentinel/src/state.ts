import { z } from "zod";

import type { SentinelBucket } from "./bucket.ts";

export const SENTINEL_STATE_KEY = "ops/sentinel-state.json";

const runRecordSchema = z.object({
  at: z.string().min(1),
  health: z.enum(["ok", "failing"]),
  usage: z.enum(["ok", "unconfigured", "failed"]),
  ops: z.enum(["ok", "failing", "failed"]).optional(),
  degraded: z.boolean(),
  flag: z.enum(["written", "unchanged", "cleared", "kept", "absent", "failed"]),
  alerts: z.array(z.string()),
  errors: z.array(z.string()),
});

export type SentinelRunRecord = z.infer<typeof runRecordSchema>;

const stateSchema = z.object({
  version: z.literal(1),
  health: z.enum(["ok", "failing"]).nullable(),
  ops: z.enum(["ok", "failing"]).nullish(),
  degradedSince: z.string().nullable(),
  lastAlerts: z.record(z.string(), z.string()),
  lastRun: runRecordSchema.nullish(),
});

export type SentinelState = z.infer<typeof stateSchema>;

export function emptyState() {
  return {
    version: 1,
    health: null,
    ops: null,
    degradedSince: null,
    lastAlerts: {},
    lastRun: null,
  } satisfies SentinelState;
}

/**
 * Reads the persisted alert state. A missing object is a first run. An unreadable one is treated
 * as a first run too, so the sentinel alerts rather than stays quiet; the reason is returned so the
 * run can record it.
 * @param bucket the files bucket the state object lives in
 * @returns the last known state, and why it could not be read when that happened
 */
export async function readState(bucket: SentinelBucket) {
  let raw: string | null;

  try {
    raw = await bucket.get(SENTINEL_STATE_KEY);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      state: emptyState(),
      error: `state read failed, treating as a first run and alerting again: ${reason}`,
    };
  }

  if (raw === null) {
    return { state: emptyState(), error: null };
  }

  const parsed = parseState(raw);

  if (parsed.success) {
    return { state: { ...parsed.data, lastRun: parsed.data.lastRun ?? null }, error: null };
  }

  return {
    state: emptyState(),
    error: "state object unreadable, treating as a first run and alerting again",
  };
}

function parseState(raw: string) {
  try {
    return stateSchema.safeParse(JSON.parse(raw));
  } catch {
    return stateSchema.safeParse(null);
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
