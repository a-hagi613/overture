import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { bgJobs, companyBoards } from "../platform/db/schema.ts";
import { pollBoard } from "./poll-board.ts";
import { ASHBY_LIMITS } from "./ashby-feed.ts";
import { GREENHOUSE_LIMITS } from "./greenhouse-feed.ts";
import { LEVER_LIMITS } from "./lever-feed.ts";
import { M1_ATS_NAMES } from "./discovered-boards.ts";

import type { BoardFeeds } from "./board-feed.ts";

export const SWEEP_JOB_KIND = "catalog.sweep";
export const BACKFILL_JOB_KIND = "catalog.backfill";

export const SINGLETON_JOB_KINDS = [SWEEP_JOB_KIND];

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const MIN_SWEEP_INTERVAL_MS = 1000;
const SWEEP_CLAIM_MS = 15 * 60_000;
const SWEEP_MAX_ATTEMPTS = 1;
const SWEEP_DEDUPE_KEY = "catalog.sweep";
const BACKFILL_DEDUPE_KEY = "catalog.backfill";

const SWEEP_LIMITS = {
  greenhouse: GREENHOUSE_LIMITS,
  lever: LEVER_LIMITS,
  ashby: ASHBY_LIMITS,
} as const;

export interface CatalogDeps {
  db: AppDatabase;
  clock: Clock;
  feeds: BoardFeeds;
}

export function readSweepIntervalMs(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_interval_ms");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= MIN_SWEEP_INTERVAL_MS
    ? Math.trunc(parsed)
    : DEFAULT_SWEEP_INTERVAL_MS;
}

function readSweepBatchOverride(db: AppDatabase) {
  const raw = getSetting(db, "catalog.sweep_batch");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : null;
}

function requestRatePerSecond(ats: (typeof M1_ATS_NAMES)[number]) {
  return 1000 / SWEEP_LIMITS[ats].minIntervalMs;
}

export function sweepBatchPerAts(db: AppDatabase) {
  const intervalMs = readSweepIntervalMs(db);
  const overrideTotal = readSweepBatchOverride(db);
  const totalRate = M1_ATS_NAMES.reduce((sum, ats) => sum + requestRatePerSecond(ats), 0);

  const batchFor = (ats: (typeof M1_ATS_NAMES)[number]) => {
    if (overrideTotal === null) {
      return Math.max(1, Math.trunc(intervalMs / SWEEP_LIMITS[ats].minIntervalMs));
    }

    return Math.max(1, Math.trunc((overrideTotal * requestRatePerSecond(ats)) / totalRate));
  };

  return {
    greenhouse: batchFor("greenhouse"),
    lever: batchFor("lever"),
    ashby: batchFor("ashby"),
  } satisfies Record<(typeof M1_ATS_NAMES)[number], number>;
}

export function enqueueSweep(deps: CatalogDeps, runAt: number) {
  return enqueueJob(deps.db, deps.clock, SWEEP_JOB_KIND, "{}", {
    runAt,
    dedupeKey: SWEEP_DEDUPE_KEY,
    maxAttempts: SWEEP_MAX_ATTEMPTS,
  });
}

export function enqueueBackfill(deps: CatalogDeps) {
  return enqueueJob(deps.db, deps.clock, BACKFILL_JOB_KIND, "{}", {
    dedupeKey: BACKFILL_DEDUPE_KEY,
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

export async function pollDueBoards(deps: CatalogDeps) {
  const now = deps.clock.now();
  const batches = sweepBatchPerAts(deps.db);

  const claimed = M1_ATS_NAMES.flatMap((ats) =>
    deps.db
      .update(companyBoards)
      .set({ nextPollAt: now + SWEEP_CLAIM_MS })
      .where(
        sql`${companyBoards.id} IN (
          SELECT id FROM company_boards
          WHERE ats = ${ats}
            AND status IN ('active', 'empty')
            AND next_poll_at <= ${now}
          ORDER BY next_poll_at
          LIMIT ${batches[ats]}
        )`,
      )
      .returning()
      .all(),
  );

  await Promise.all(
    claimed.map(async (board) => pollBoard(deps.db, deps.clock, deps.feeds[board.ats], board)),
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
  try {
    await pollDueBoards(deps);
  } finally {
    enqueueSweep(deps, deps.clock.now() + readSweepIntervalMs(deps.db));
  }
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

  return enqueueSweep(deps, deps.clock.now()).inserted;
}
