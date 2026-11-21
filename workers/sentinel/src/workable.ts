import { z } from "zod";

import type { SentinelBucket } from "./bucket.ts";

/** Written by the Workable Action and read by the app; ADR 0032, `src/server/catalog/workable-feed.ts`. */
export const WORKABLE_MANIFEST_KEY = "workable/manifest.json";

/** A daily pass plus the scheduler's slack; ADR 0032. */
export const WORKABLE_STALE_AFTER_MS = 26 * 3_600_000;

const manifestSchema = z.object({ fetchedAt: z.string().min(1) });

export type ManifestFreshness =
  | { state: "fresh"; ageMs: number }
  | { state: "stale"; ageMs: number }
  | { state: "missing" }
  | { state: "unreadable"; detail: string };

/**
 * Reads the manifest the Workable Action writes to R2 and judges its age, so the alert does not
 * depend on the GitHub Action's own reporting (ADR 0032).
 * @param bucket the files bucket the app and the Action share
 * @param at the instant the run started, in epoch milliseconds
 * @returns fresh, stale, missing or unreadable with the measured age
 */
export async function manifestFreshness(
  bucket: SentinelBucket,
  at: number,
): Promise<ManifestFreshness> {
  const raw = await bucket.get(WORKABLE_MANIFEST_KEY);

  if (raw === null) {
    return { state: "missing" };
  }

  let fetchedAt: number | null = null;

  try {
    fetchedAt = Date.parse(manifestSchema.parse(JSON.parse(raw)).fetchedAt);
  } catch {
    fetchedAt = null;
  }

  if (fetchedAt === null || Number.isNaN(fetchedAt)) {
    return { state: "unreadable", detail: "manifest has no parsed fetchedAt" };
  }

  const ageMs = Math.max(0, at - fetchedAt);

  return ageMs > WORKABLE_STALE_AFTER_MS ? { state: "stale", ageMs } : { state: "fresh", ageMs };
}

export function describeAge(ageMs: number) {
  return `${(ageMs / 3_600_000).toFixed(1)} h`;
}
