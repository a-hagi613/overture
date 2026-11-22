import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { CatalogSweepWorker } from "./sweep-worker-runner.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { companyBoards } from "../platform/db/catalog-schema.ts";
import { reconcileClosedPostings } from "./closed-postings.ts";
import { readSweepIntervalMs } from "./sweep-config.ts";

export const SWEEP_JOB_KIND = "catalog.sweep";
export const BACKFILL_JOB_KIND = "catalog.backfill";

export const SINGLETON_JOB_KINDS = [SWEEP_JOB_KIND];

const SWEEP_MAX_ATTEMPTS = 1;
const SWEEP_DEDUPE_KEY = "catalog.sweep";
const BACKFILL_DEDUPE_KEY = "catalog.backfill";

export interface CatalogDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
}

export function enqueueSweep(deps: CatalogDeps, runAt: number) {
  return enqueueJob(deps.db, deps.clock, SWEEP_JOB_KIND, "{}", {
    runAt,
    dedupeKey: SWEEP_DEDUPE_KEY,
    maxAttempts: SWEEP_MAX_ATTEMPTS,
  });
}

export function ensureBackfillQueued(db: AppDatabase, clock: Clock) {
  const active = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, BACKFILL_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])))
    .limit(1)
    .get();

  if (active !== undefined) {
    return { jobId: active.id, enqueued: false };
  }

  const job = enqueueJob(db, clock, BACKFILL_JOB_KIND, "{}", { dedupeKey: BACKFILL_DEDUPE_KEY });

  return { jobId: job.id, enqueued: job.inserted };
}

export async function runBackfillJob(worker: CatalogSweepWorker, deps: CatalogDeps) {
  const summary = await worker.run("backfill");

  reconcileClosedPostings(deps, summary.closedPostingIds);

  enqueueSweep(deps, deps.clock.now() + readSweepIntervalMs(deps.db));
}

export async function runSweepJob(worker: CatalogSweepWorker, deps: CatalogDeps) {
  try {
    const summary = await worker.run("sweep");

    reconcileClosedPostings(deps, summary.closedPostingIds);
  } finally {
    enqueueSweep(deps, deps.clock.now() + readSweepIntervalMs(deps.db));
  }
}

export function ensureSweepQueued(deps: CatalogDeps) {
  const hasBoards = deps.catalogDb
    .select({ one: companyBoards.id })
    .from(companyBoards)
    .limit(1)
    .get();

  if (hasBoards === undefined) {
    return false;
  }

  const existing = deps.db
    .select({ one: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, SWEEP_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])))
    .limit(1)
    .get();

  if (existing !== undefined) {
    return false;
  }

  return enqueueSweep(deps, deps.clock.now()).inserted;
}
