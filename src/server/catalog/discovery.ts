import { and, eq, inArray, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { bgJobs, companyBoards } from "../platform/db/schema.ts";
import { pollBoard } from "./poll-board.ts";

import type { GreenhouseFeed } from "./greenhouse-feed.ts";

export const SWEEP_JOB_KIND = "catalog.sweep";
export const BACKFILL_JOB_KIND = "catalog.backfill";

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1000;
const DEFAULT_SWEEP_BATCH = 50;

export interface CatalogDeps {
  db: AppDatabase;
  clock: Clock;
  greenhouse: GreenhouseFeed;
}

export function readSweepIntervalMs(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_interval_ms");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= MIN_SWEEP_INTERVAL_MS
    ? Math.trunc(parsed)
    : DEFAULT_SWEEP_INTERVAL_MS;
}

function readSweepBatch(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_batch");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : DEFAULT_SWEEP_BATCH;
}

export function enqueueSweep(deps: CatalogDeps, runAt: number) {
  return enqueueJob(deps.db, deps.clock, SWEEP_JOB_KIND, "{}", { runAt });
}

export function enqueueBackfill(deps: CatalogDeps) {
  return enqueueJob(deps.db, deps.clock, BACKFILL_JOB_KIND, "{}");
}

export async function pollDueBoards(deps: CatalogDeps) {
  const now = deps.clock.now();

  const due = deps.db
    .select()
    .from(companyBoards)
    .where(
      and(inArray(companyBoards.status, ["active", "empty"]), lte(companyBoards.nextPollAt, now)),
    )
    .limit(readSweepBatch(deps.db))
    .all();

  await Promise.all(
    due.map(async (board) => pollBoard(deps.db, deps.clock, deps.greenhouse, board)),
  );
}

export async function runBackfillJob(deps: CatalogDeps) {
  const now = deps.clock.now();

  deps.db
    .update(companyBoards)
    .set({ nextPollAt: now })
    .where(inArray(companyBoards.status, ["active", "empty"]))
    .run();

  await pollDueBoards(deps);

  enqueueSweep(deps, now + readSweepIntervalMs(deps.db));
}

export async function runSweepJob(deps: CatalogDeps) {
  enqueueSweep(deps, deps.clock.now() + readSweepIntervalMs(deps.db));

  await pollDueBoards(deps);
}

export function ensureSweepQueued(deps: CatalogDeps) {
  const hasBoards = deps.db.select({ one: companyBoards.id }).from(companyBoards).limit(1).get();

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

  enqueueSweep(deps, deps.clock.now());

  return true;
}
