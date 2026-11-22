import { sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { WRITE_BATCH_ROWS, yieldToEventLoop } from "../db/batches.ts";
import { retryWhenBusy } from "../db/busy.ts";
import { enqueueJob } from "./queue.ts";

const HOUR_MS = 3_600_000;

const DAY_MS = 24 * HOUR_MS;
export const RETENTION_JOB_KIND = "maintenance.retention";
const RETENTION_INTERVAL_MS = HOUR_MS;
const EVENT_RETENTION_MS = DAY_MS;
const DONE_JOB_RETENTION_MS = 7 * DAY_MS;
const DEAD_JOB_RETENTION_MS = 30 * DAY_MS;

/** SPEC §5.7 keeps `attempts` 180 days, as the cost report wants its history. */
export const ATTEMPT_RETENTION_MS = 180 * DAY_MS;

const TABLE_KEYS = {
  attempts: "id",
  bg_jobs: "id",
  events: "seq",
} as const;

type Table = keyof typeof TABLE_KEYS;

async function deleteInChunks(db: AppDatabase, table: Table, where: ReturnType<typeof sql>) {
  const key = sql.raw(TABLE_KEYS[table]);
  const name = sql.raw(table);

  const removeChunk: (total: number) => Promise<number> = async (total) => {
    const removed = await retryWhenBusy(
      () =>
        db.all(
          sql`DELETE FROM ${name} WHERE ${key} IN (
            SELECT ${key} FROM ${name} WHERE ${where} LIMIT ${WRITE_BATCH_ROWS}
          ) RETURNING 1 AS removed`,
        ).length,
      `retention.${table}`,
    );

    if (removed < WRITE_BATCH_ROWS) {
      return total + removed;
    }

    await yieldToEventLoop();

    return removeChunk(total + removed);
  };

  return removeChunk(0);
}

export async function runRetention(db: AppDatabase, clock: Clock) {
  const now = clock.now();

  const events = await deleteInChunks(db, "events", sql`created_at < ${now - EVENT_RETENTION_MS}`);

  const attempts = await deleteInChunks(
    db,
    "attempts",
    sql`started_at < ${now - ATTEMPT_RETENTION_MS}`,
  );

  const doneJobs = await deleteInChunks(
    db,
    "bg_jobs",
    sql`status = 'done' AND updated_at < ${now - DONE_JOB_RETENTION_MS}`,
  );

  const deadJobs = await deleteInChunks(
    db,
    "bg_jobs",
    sql`status = 'dead' AND updated_at < ${now - DEAD_JOB_RETENTION_MS}`,
  );

  return { attempts, deadJobs, doneJobs, events };
}

export function ensureRetentionQueued(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, RETENTION_JOB_KIND, "{}", {
    dedupeKey: RETENTION_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + RETENTION_INTERVAL_MS,
  }).inserted;
}

export async function retentionJobHandler(db: AppDatabase, clock: Clock) {
  try {
    await runRetention(db, clock);
  } finally {
    ensureRetentionQueued(db, clock);
  }
}
