import { sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { WRITE_BATCH_ROWS, yieldToEventLoop } from "../db/batches.ts";
import { retryWhenBusy } from "../db/busy.ts";

const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export const RETENTION_INTERVAL_MS = HOUR_MS;
export const EVENT_RETENTION_MS = DAY_MS;
export const DONE_JOB_RETENTION_MS = 7 * DAY_MS;
export const DEAD_JOB_RETENTION_MS = 30 * DAY_MS;

/**
 * Deletes in chunks so one pass never holds the write lock for long: the catalog sweep and user
 * requests share this SQLite file.
 */
async function deleteInChunks(
  db: AppDatabase,
  table: "events" | "bg_jobs",
  where: ReturnType<typeof sql>,
) {
  const key = table === "events" ? sql.raw("seq") : sql.raw("id");
  const name = sql.raw(table);
  let total = 0;

  for (;;) {
    const removed = await retryWhenBusy(
      () =>
        db.all<{ n: number }>(
          sql`DELETE FROM ${name} WHERE ${key} IN (
            SELECT ${key} FROM ${name} WHERE ${where} LIMIT ${WRITE_BATCH_ROWS}
          ) RETURNING 1 AS n`,
        ).length,
      `retention.${table}`,
    );

    total += removed;

    if (removed < WRITE_BATCH_ROWS) {
      return total;
    }

    await yieldToEventLoop();
  }
}

/** Drops delivered events and finished jobs past their retention window. */
export async function runRetention(db: AppDatabase, clock: Clock) {
  const now = clock.now();

  const events = await deleteInChunks(db, "events", sql`created_at < ${now - EVENT_RETENTION_MS}`);

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

  return { events, doneJobs, deadJobs };
}
