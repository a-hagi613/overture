import { and, eq, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";

import type { AppDatabase, DatabaseWriter } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { retryWhenBusy } from "../db/busy.ts";
import { logError } from "../log.ts";
import { bgJobs } from "../db/schema.ts";
import { publishEvent } from "../sse/stream.ts";
import type { JobClass } from "./classes.ts";
import {
  DEFAULT_JOB_CLASS_LIMITS,
  DEFAULT_MAX_IN_FLIGHT_JOBS,
  exceedsJobClassLimit,
  jobClassCounts,
  jobClassOf,
  NO_JOB_CLASS_LIMITS,
  saturatedJobKinds,
} from "./classes.ts";
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

export interface ClaimDueOptions {
  /** The most rows to claim in this pass. */
  batchSize: number;
  /** Kinds that may run only one at a time. */
  singletonKinds?: readonly string[];
  /** Singleton kinds already running, which must not be claimed again. */
  busyKinds?: readonly string[];
  /** Kinds left out of this claim because their class is at its in-flight limit. */
  excludedKinds?: readonly string[];
}

/**
 * The claim query itself, so its plan can be proved against the shipped schema.
 * `status IN ('queued', 'running')` is written with literal values rather than bound
 * parameters: SQLite only matches the partial `bg_jobs_claim_due` index when it can
 * prove the query implies the index's `WHERE`. The OR terms are shaped so that
 * conjunct stays visible to the planner; a queued row is always claimable and a
 * running row only when its lock is stale and its kind is an idle singleton.
 * @param db The application database.
 * @param clock The clock the claim's dates come from.
 * @param options The batch, the singleton kinds and any excluded kinds.
 * @returns The unexecuted update query.
 */
export function claimDueJobsQuery(db: AppDatabase, clock: Clock, options: ClaimDueOptions) {
  const now = clock.now();
  const singletonKinds = options.singletonKinds ?? [];
  const busyKinds = options.busyKinds ?? [];
  const excludedKinds = options.excludedKinds ?? [];

  const reclaimable = singletonKinds.filter((kind) => !busyKinds.includes(kind));

  const claimable =
    reclaimable.length === 0
      ? sql`${bgJobs.status} = 'queued'`
      : and(
          sql`${bgJobs.status} IN ('queued', 'running')`,
          sql`(${bgJobs.status} = 'queued' OR ${bgJobs.lockedUntil} IS NULL OR ${bgJobs.lockedUntil} < ${now})`,
          sql`(${bgJobs.status} = 'queued' OR ${bgJobs.kind} IN (${sql.join(
            reclaimable.map((kind) => sql`${kind}`),
            sql`, `,
          )}))`,
        );

  const due = and(
    claimable,
    lte(bgJobs.runAt, now),
    or(isNull(bgJobs.lockedUntil), lt(bgJobs.lockedUntil, now)),
    excludedKinds.length === 0 ? undefined : notInArray(bgJobs.kind, [...excludedKinds]),
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
        due,
        sql`${bgJobs.id} IN (
          SELECT id FROM bg_jobs
          WHERE ${due}
          ORDER BY priority DESC, run_at ASC
          LIMIT ${options.batchSize}
        )`,
      ),
    )
    .returning();
}

export function claimDueJobs(db: AppDatabase, clock: Clock, options: ClaimDueOptions) {
  return claimDueJobsQuery(db, clock, options).all();
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
    () =>
      claimJobsToRun(db, clock, {
        batchSize,
        classLimits: NO_JOB_CLASS_LIMITS,
        maxInFlight: Number.POSITIVE_INFINITY,
        singletonKinds,
      }),
    "jobs.claim",
  );

  const tasks = claimed.map(async (job) => runClaimedJob(db, clock, job, handlers, signal));

  const results = await Promise.all(tasks);

  return results.filter(Boolean).length;
}

export interface ClaimJobsOptions {
  /** The most rows to claim in this pass. */
  batchSize: number;
  /** Kinds that may run only one at a time. */
  singletonKinds?: readonly string[];
  /** Singleton kinds already running, which must not be claimed again. */
  busyKinds?: readonly string[];
  /** The kinds the worker is running right now. */
  inFlightKinds?: readonly string[];
  /** The most jobs the worker may hold at once, across every class. */
  maxInFlight?: number;
  /** The per-class in-flight limits. */
  classLimits?: Readonly<Record<JobClass, number>>;
}

export function claimJobsToRun(db: AppDatabase, clock: Clock, options: ClaimJobsOptions) {
  const singletonKinds = options.singletonKinds ?? [];
  const busyKinds = options.busyKinds ?? [];
  const inFlightKinds = options.inFlightKinds ?? [];
  const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT_JOBS;
  const classLimits = options.classLimits ?? DEFAULT_JOB_CLASS_LIMITS;
  const room = Math.max(0, maxInFlight - inFlightKinds.length);

  if (room === 0) {
    return [];
  }

  const exclusive = new Set(singletonKinds);
  const busy = new Set(busyKinds);
  const classCounts = jobClassCounts(inFlightKinds);
  const startable: ClaimedJob[] = [];

  for (const job of claimDueJobs(db, clock, {
    batchSize: Math.min(options.batchSize, room),
    singletonKinds,
    busyKinds,
    excludedKinds: saturatedJobKinds(classCounts, classLimits),
  })) {
    if (exceedsJobClassLimit(job.kind, classCounts, classLimits)) {
      requeueWithoutConsumingAttempt(db, clock, job.id, job.attempts - 1);

      continue;
    }

    if (!exclusive.has(job.kind)) {
      classCounts[jobClassOf(job.kind)] += 1;
      startable.push(job);

      continue;
    }

    if (busy.has(job.kind)) {
      requeueWithoutConsumingAttempt(db, clock, job.id, job.attempts - 1);

      continue;
    }

    busy.add(job.kind);
    classCounts[jobClassOf(job.kind)] += 1;
    startable.push(job);
  }

  return startable;
}

export function recoverStaleLocks(
  db: AppDatabase,
  clock: Clock,
  singletonKinds: readonly string[] = [],
  skipIds: readonly string[] = [],
) {
  const now = clock.now();
  const conditions = [eq(bgJobs.status, "running"), lt(bgJobs.lockedUntil, now)];

  if (singletonKinds.length > 0) {
    conditions.push(notInArray(bgJobs.kind, [...singletonKinds]));
  }

  if (skipIds.length > 0) {
    conditions.push(notInArray(bgJobs.id, [...skipIds]));
  }

  const stale = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(and(...conditions))
    .all();

  for (const job of stale) {
    queueAgain(db, clock, job.id, {});
  }

  return stale.length;
}

/**
 * Queues every job the previous process left in `running`, whatever its lease
 * says. A single-machine boot knows no other process holds a lock, so a crash
 * in the first five minutes of a job's lease (OOM, SIGKILL) does not wedge that
 * kind until the lease expires or forever when no worker ever reclaims it.
 * @param db The application database.
 * @param clock The clock the requeued rows are stamped with.
 * @returns How many rows were found running at boot.
 */
export function recoverBootRunningJobs(db: AppDatabase, clock: Clock) {
  const running = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(eq(bgJobs.status, "running"))
    .all();

  for (const job of running) {
    queueAgain(db, clock, job.id, {});
  }

  return running.length;
}

let enqueueNotify: (() => void) | null = null;

export function registerEnqueueNotify(notify: () => void) {
  enqueueNotify = notify;
}

/**
 * Wakes the job worker after a job is made runnable outside `enqueueJob`, such as an
 * owner's retry of a dead job.
 */
export function notifyQueueWake() {
  if (enqueueNotify !== null) {
    enqueueNotify();
  }
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
  db: DatabaseWriter,
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
