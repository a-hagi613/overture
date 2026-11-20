import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { bgJobs } from "../db/schema.ts";
import { publishEvent } from "../sse/stream.ts";

export type JobHandlers = Readonly<Record<string, (payload: string) => Promise<void>>>;

const LOCK_DURATION_MS = 5 * 60_000;

export type ClaimedJob = typeof bgJobs.$inferSelect;

async function runJob(
  db: AppDatabase,
  clock: Clock,
  job: ClaimedJob,
  handler: (payload: string) => Promise<void>,
) {
  publishEvent(db, clock, "job.started", JSON.stringify({ id: job.id }));

  try {
    await handler(job.payload);

    db.update(bgJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: clock.now() })
      .where(eq(bgJobs.id, job.id))
      .run();

    publishEvent(db, clock, "job.done", JSON.stringify({ id: job.id }));

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const nextAttempts = job.attempts;
    const isDead = nextAttempts >= job.maxAttempts;
    const backoffMs = isDead ? 0 : Math.min(60_000 * 2 ** (nextAttempts - 1), 3_600_000);

    db.update(bgJobs)
      .set({
        status: isDead ? "dead" : "queued",
        lastError: errorMessage,
        lockedUntil: null,
        runAt: isDead ? job.runAt : clock.now() + backoffMs,
        updatedAt: clock.now(),
      })
      .where(eq(bgJobs.id, job.id))
      .run();

    return false;
  }
}

export function requeueWithoutConsumingAttempt(
  db: AppDatabase,
  clock: Clock,
  jobId: string,
  originalAttempts: number,
) {
  db.update(bgJobs)
    .set({
      status: "queued",
      attempts: originalAttempts,
      lockedUntil: null,
      updatedAt: clock.now(),
    })
    .where(eq(bgJobs.id, jobId))
    .run();
}

export function claimDueJobs(db: AppDatabase, clock: Clock, batchSize: number) {
  const now = clock.now();

  return db
    .update(bgJobs)
    .set({
      status: "running",
      lockedUntil: now + LOCK_DURATION_MS,
      attempts: sql`${bgJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(bgJobs.status, "queued"),
        lte(bgJobs.runAt, now),
        or(isNull(bgJobs.lockedUntil), lt(bgJobs.lockedUntil, now)),
        sql`${bgJobs.id} IN (
          SELECT id FROM bg_jobs
          WHERE status = 'queued'
            AND run_at <= ${now}
            AND (locked_until IS NULL OR locked_until < ${now})
          ORDER BY priority DESC, run_at ASC
          LIMIT ${batchSize}
        )`,
      ),
    )
    .returning()
    .all();
}

export async function runClaimedJob(
  db: AppDatabase,
  clock: Clock,
  job: ClaimedJob,
  handlers: JobHandlers,
  signal: AbortSignal,
) {
  if (signal.aborted) {
    requeueWithoutConsumingAttempt(db, clock, job.id, job.attempts - 1);

    return false;
  }

  const handler = handlers[job.kind];

  if (handler === undefined) {
    db.update(bgJobs)
      .set({
        status: "dead",
        lastError: `no handler for kind: ${job.kind}`,
        updatedAt: clock.now(),
      })
      .where(eq(bgJobs.id, job.id))
      .run();

    return false;
  }

  return runJob(db, clock, job, handler);
}

export async function claimAndRunDueJobs(
  db: AppDatabase,
  clock: Clock,
  handlers: JobHandlers,
  signal: AbortSignal,
  batchSize: number,
) {
  const claimed = claimDueJobs(db, clock, batchSize);

  const tasks = claimed.map(async (job) => runClaimedJob(db, clock, job, handlers, signal));

  const results = await Promise.all(tasks);

  return results.filter(Boolean).length;
}

export function recoverStaleLocks(db: AppDatabase, clock: Clock) {
  const now = clock.now();

  db.update(bgJobs)
    .set({ status: "queued", lockedUntil: null, updatedAt: now })
    .where(and(eq(bgJobs.status, "running"), lt(bgJobs.lockedUntil, now)))
    .run();
}

let enqueueNotify: (() => void) | null = null;

export function registerEnqueueNotify(notify: () => void) {
  enqueueNotify = notify;
}

export function enqueueJob(
  db: AppDatabase,
  clock: Clock,
  kind: string,
  payload: string,
  options?: {
    runAt?: number;
    priority?: number;
    maxAttempts?: number;
    dedupeKey?: string;
  },
) {
  const now = clock.now();
  const id = crypto.randomUUID();

  db.insert(bgJobs)
    .values({
      id,
      kind,
      payload,
      runAt: options?.runAt ?? now,
      priority: options?.priority ?? 0,
      maxAttempts: options?.maxAttempts ?? 2,
      dedupeKey: options?.dedupeKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  if (enqueueNotify !== null) {
    enqueueNotify();
  }

  return id;
}
