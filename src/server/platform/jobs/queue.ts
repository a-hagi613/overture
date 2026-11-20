import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { bgJobs } from "../db/schema.ts";

export type JobHandlers = Readonly<Record<string, (payload: string) => Promise<void>>>;

const LOCK_DURATION_MS = 5 * 60_000;

async function runJob(
  db: AppDatabase,
  clock: Clock,
  job: typeof bgJobs.$inferSelect,
  handler: (payload: string) => Promise<void>,
) {
  try {
    await handler(job.payload);

    db.update(bgJobs)
      .set({ status: "done", lockedUntil: null, updatedAt: clock.now() })
      .where(eq(bgJobs.id, job.id))
      .run();

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

export async function claimAndRunDueJobs(
  db: AppDatabase,
  clock: Clock,
  handlers: JobHandlers,
  signal: AbortSignal,
) {
  const now = clock.now();

  const claimed = db
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
      ),
    )
    .returning()
    .all();

  const tasks = claimed.map(async (job) => {
    if (signal.aborted) {
      db.update(bgJobs)
        .set({ status: "queued", lockedUntil: null, updatedAt: clock.now() })
        .where(eq(bgJobs.id, job.id))
        .run();

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
  });

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

  return id;
}
