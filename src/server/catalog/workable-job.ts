import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { CatalogSweepWorker } from "./sweep-worker-runner.ts";
import type { WorkableIngestReport } from "./workable-ingest.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { STALE_AFTER_MS } from "./workable-ingest.ts";

export const WORKABLE_INGEST_JOB_KIND = "catalog.workable";

const DAILY_DEDUPE_KEY = "catalog.workable.daily";
const RUN_HOUR_UTC = 5;

export function nextWorkableRunAt(now: number) {
  const at = new Date(now);

  const today = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    RUN_HOUR_UTC,
    0,
    0,
    0,
  );

  return now < today ? today : today + 86_400_000;
}

export function scheduleNextWorkableIngest(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, WORKABLE_INGEST_JOB_KIND, "{}", {
    dedupeKey: DAILY_DEDUPE_KEY,
    maxAttempts: 1,
    runAt: nextWorkableRunAt(clock.now()),
  });
}

export function ensureWorkableIngestQueued(db: AppDatabase, clock: Clock) {
  const active = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(
      and(eq(bgJobs.kind, WORKABLE_INGEST_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])),
    )
    .limit(1)
    .get();

  if (active !== undefined) {
    return false;
  }

  return scheduleNextWorkableIngest(db, clock).inserted;
}

function raiseIngestAlert(db: AppDatabase, clock: Clock, report: WorkableIngestReport) {
  if (report.outcome === "missing_manifest") {
    raiseAlert(db, clock, "workable.feed", { reason: "missing_manifest" });
  }

  if (report.outcome === "missing_snapshot") {
    raiseAlert(db, clock, "workable.feed", {
      reason: "missing_snapshot",
      snapshot: report.snapshot,
    });
  }

  if (report.dropped) {
    raiseAlert(db, clock, "workable.feed", {
      reason: "row_drop",
      rows: report.rows,
      previousRows: report.previousRows,
      snapshot: report.snapshot,
    });
  }

  if (report.ageMs !== null && report.ageMs > STALE_AFTER_MS) {
    raiseAlert(db, clock, "workable.feed", {
      reason: "stale",
      ageHours: Math.round(report.ageMs / 3_600_000),
      snapshot: report.snapshot,
    });
  }
}

export async function runWorkableIngestJob(
  worker: CatalogSweepWorker,
  deps: { db: AppDatabase; clock: Clock },
) {
  try {
    const summary = await worker.run("workable");
    const report = summary.workable ?? null;

    if (report !== null) {
      raiseIngestAlert(deps.db, deps.clock, report);
    }
  } catch (error) {
    raiseAlert(deps.db, deps.clock, "workable.feed", {
      reason: "ingest_failed",
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  } finally {
    scheduleNextWorkableIngest(deps.db, deps.clock);
  }
}
