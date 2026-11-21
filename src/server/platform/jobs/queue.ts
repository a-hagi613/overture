import { and, eq, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { retryWhenBusy } from "../db/busy.ts";
import { logError } from "../log.ts";
import { bgJobs } from "../db/schema.ts";
import { publishEvent } from "../sse/stream.ts";
import { RETRY_LATER_DELAY_MS, RetryLaterError } from "./retry.ts";

export type JobHandlers = Readonly<Record<string, (payload: string) => Promise<void>>>;

const LOCK_DURATION_MS = 5 * 60_000;

export type ClaimedJob = typeof bgJobs.$inferSelect;

async function runJob(
  db: AppDatabase,
  clock: Clock,
  job: ClaimedJob,
  handler: (payload: string) => Promise<void>,
) {
  try {
    await retryWhenBusy(
      () => publishEvent(db, clock, "job.started", JSON.stringify({ id: job.id })),
      "jobs.started",
    );

    await handler(job.payload);

    await retryWhenBusy(
      () =>
        db
          .update(bgJobs)
          .set({ status: "done", lockedUntil: null, updatedAt: clock.now() })
          .where(eq(bgJobs.id, job.id))
          .run(),
      "jobs.done",
    );

    await retryWhenBusy(
      () => publishEvent(db, clock, "job.done", JSON.stringify({ id: job.id })),
      "jobs.done",
    );

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof RetryLaterError) {
      try {
        await retryWhenBusy(
          () =>
            queueAgain(db, clock, job.id, {
              attempts: Math.max(0, job.attempts - 1),
              lastError: errorMessage,
              runAt: clock.now() + (error.delayMs ?? RETRY_LATER_DELAY_MS),
            }),
          "jobs.retry",
        );
      } catch (bookkeepingError) {
        logError("jobs.retry", bookkeepingError);
      }

      return false;
    }

    const nextAttempts = job.attempts;
    const isDead = nextAttempts >= job.maxAttempts;
    const backoffMs = isDead ? 0 : Math.min(60_000 * 2 ** (nextAttempts - 1), 3_600_000);

    try {
      await retryWhenBusy(() => {
        if (isDead) {
          db.update(bgJobs)
            .set({
              status: "dead",
              lastError: errorMessage,
              lockedUntil: null,
              runAt: job.runAt,
              updatedAt: clock.now(),
            })
            .where(eq(bgJobs.id, job.id))
            .run();

          return;
        }

        queueAgain(db, clock, job.id, {
          lastError: errorMessage,
          runAt: clock.now() + backoffMs,
        });
      }, "jobs.failed");
    } catch (bookkeepingError) {
      logError("jobs.failed", bookkeepingError);
    }

    return false;
  }
}

export function requeueWithoutConsumingAttempt(
  db: AppDatabase,
  clock: Clock,
  jobId: string,
  originalAttempts: number,
) {
  queueAgain(db, clock, jobId, { attempts: originalAttempts });
}

export function claimDueJobs(
  db: AppDatabase,
  clock: Clock,
  batchSize: number,
  singletonKinds: readonly string[] = [],
  busyKinds: readonly string[] = [],
) {
  const now = clock.now();

  const reclaimable = singletonKinds.flatMap((kind) =>
    busyKinds.includes(kind) ? [] : [sql`${kind}`],
  );

  const claimable =
    reclaimable.length === 0
      ? sql`${bgJobs.status} = 'queued'`
      : sql`(${bgJobs.status} = 'queued'
          OR (${bgJobs.status} = 'running'
            AND (${bgJobs.lockedUntil} IS NULL OR ${bgJobs.lockedUntil} < ${now})
            AND ${bgJobs.kind} IN (${sql.join(reclaimable, sql`, `)})))`;

  const claimableNow = and(
    claimable,
    lte(bgJobs.runAt, now),
    or(isNull(bgJobs.lockedUntil), lt(bgJobs.lockedUntil, now)),
  );

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
        claimableNow,
        sql`${bgJobs.id} IN (
          SELECT id FROM bg_jobs
          WHERE ${claimable}
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
  singletonKinds: readonly string[] = [],
) {
  const claimed = await retryWhenBusy(
    () => claimJobsToRun(db, clock, batchSize, singletonKinds, []),
    "jobs.claim",
  );

  const tasks = claimed.map(async (job) => runClaimedJob(db, clock, job, handlers, signal));

  const results = await Promise.all(tasks);

  return results.filter(Boolean).length;
}

export function claimJobsToRun(
  db: AppDatabase,
  clock: Clock,
  batchSize: number,
  singletonKinds: readonly string[],
  busyKinds: readonly string[],
) {
  const exclusive = new Set(singletonKinds);
  const busy = new Set(busyKinds);
  const startable: ClaimedJob[] = [];

  for (const job of claimDueJobs(db, clock, batchSize, singletonKinds, busyKinds)) {
    if (!exclusive.has(job.kind)) {
      startable.push(job);

      continue;
    }

    if (busy.has(job.kind)) {
      requeueWithoutConsumingAttempt(db, clock, job.id, job.attempts - 1);

      continue;
    }

    busy.add(job.kind);
    startable.push(job);
  }

  return startable;
}

export function recoverStaleLocks(
  db: AppDatabase,
  clock: Clock,
  singletonKinds: readonly string[] = [],
) {
  const now = clock.now();
  const conditions = [eq(bgJobs.status, "running"), lt(bgJobs.lockedUntil, now)];

  if (singletonKinds.length > 0) {
    conditions.push(notInArray(bgJobs.kind, [...singletonKinds]));
  }

  const stale = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(and(...conditions))
    .all();

  for (const job of stale) {
    queueAgain(db, clock, job.id, {});
  }
}

let enqueueNotify: (() => void) | null = null;

export function registerEnqueueNotify(notify: () => void) {
  enqueueNotify = notify;
}

function queuedDuplicateOf(db: AppDatabase, id: string, dedupeKey: string) {
  return db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.dedupeKey, dedupeKey), eq(bgJobs.status, "queued"), ne(bgJobs.id, id)))
    .get();
}

interface QueueAgain {
  attempts?: number;
  lastError?: string;
  runAt?: number;
}

function queueAgain(db: AppDatabase, clock: Clock, jobId: string, input: QueueAgain) {
  const row = db
    .select({ dedupeKey: bgJobs.dedupeKey })
    .from(bgJobs)
    .where(eq(bgJobs.id, jobId))
    .get();

  const duplicate =
    row?.dedupeKey === null || row?.dedupeKey === undefined
      ? undefined
      : queuedDuplicateOf(db, jobId, row.dedupeKey);

  if (duplicate !== undefined && input.runAt !== undefined) {
    const queued = db
      .select({ runAt: bgJobs.runAt })
      .from(bgJobs)
      .where(eq(bgJobs.id, duplicate.id))
      .get();

    if (queued !== undefined && queued.runAt < input.runAt) {
      db.update(bgJobs)
        .set({ runAt: input.runAt, updatedAt: clock.now() })
        .where(eq(bgJobs.id, duplicate.id))
        .run();
    }
  }

  if (duplicate !== undefined) {
    db.delete(bgJobs).where(eq(bgJobs.id, jobId)).run();

    return;
  }

  db.update(bgJobs)
    .set({
      status: "queued",
      lockedUntil: null,
      updatedAt: clock.now(),
      ...(input.attempts !== undefined && { attempts: input.attempts }),
      ...(input.runAt !== undefined && { runAt: input.runAt }),
      ...(input.lastError !== undefined && { lastError: input.lastError }),
    })
    .where(eq(bgJobs.id, jobId))
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
  const dedupeKey = options?.dedupeKey;

  const [created] = db
    .insert(bgJobs)
    .values({
      id,
      kind,
      payload,
      runAt: options?.runAt ?? now,
      priority: options?.priority ?? 0,
      maxAttempts: options?.maxAttempts ?? 2,
      dedupeKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: bgJobs.id })
    .all();

  if (enqueueNotify !== null) {
    enqueueNotify();
  }

  if (created !== undefined) {
    return { id: created.id, inserted: true };
  }

  const existing =
    dedupeKey === undefined
      ? undefined
      : db
          .select({ id: bgJobs.id })
          .from(bgJobs)
          .where(and(eq(bgJobs.dedupeKey, dedupeKey), eq(bgJobs.status, "queued")))
          .limit(1)
          .get();

  return { id: existing?.id ?? id, inserted: false };
}
