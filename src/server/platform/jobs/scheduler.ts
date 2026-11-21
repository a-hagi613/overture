import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { ClaimedJob, JobHandlers } from "./queue.ts";

import { claimJobsToRun, requeueWithoutConsumingAttempt, runClaimedJob } from "./queue.ts";
import { logError } from "../log.ts";
import { getSetting } from "../settings/index.ts";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 10;
const MIN_POLL_INTERVAL_MS = 1000;
const ERROR_RETRY_DELAY_MS = 1000;

interface InFlightJob {
  id: string;
  kind: string;
  claimedAttempts: number;
  promise: Promise<boolean>;
}

export interface JobWorker {
  drain: (timeoutMs: number) => Promise<void>;
}

function readPollIntervalMs(db: AppDatabase) {
  const raw = getSetting(db, "jobs.poll_interval_ms");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= MIN_POLL_INTERVAL_MS
    ? Math.trunc(parsed)
    : DEFAULT_POLL_INTERVAL_MS;
}

function readBatchSize(db: AppDatabase) {
  const raw = getSetting(db, "jobs.batch_size");
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : DEFAULT_BATCH_SIZE;
}

/**
 * Waits for `ms`, or until the signal aborts, or until the caller wakes it
 * through the callback. The abort listener is removed as soon as the wait
 * ends, so a worker that polls for days does not grow the shutdown signal's
 * listener list.
 * @param ms How long to wait when neither the signal nor the caller wakes it.
 * @param signal The shutdown signal.
 * @param onWake Receives the function that ends the wait early.
 * @returns Nothing; the wait always resolves.
 */
export async function waitForWake(
  ms: number,
  signal: AbortSignal,
  onWake?: (wake: () => void) => void,
) {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      signal.removeEventListener("abort", finish);
      resolve();
    };

    timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    onWake?.(finish);
  });
}

interface TimeoutHandle {
  timer: ReturnType<typeof setTimeout> | null;
}

function expiring(ms: number) {
  const holder: TimeoutHandle = { timer: null };

  const promise = new Promise<void>((resolve) => {
    holder.timer = setTimeout(resolve, ms);
  });

  const cancel = () => {
    if (holder.timer !== null) {
      clearTimeout(holder.timer);
      holder.timer = null;
    }
  };

  return { promise, cancel };
}

export function startJobWorker(
  db: AppDatabase,
  clock: Clock,
  handlers: JobHandlers,
  signal: AbortSignal,
  onEnqueue: (notify: () => void) => void,
  singletonKinds: readonly string[] = [],
) {
  const inFlight = new Set<InFlightJob>();
  const exclusive = new Set(singletonKinds);

  function runTracked(job: ClaimedJob) {
    const entry: InFlightJob = {
      id: job.id,
      kind: job.kind,
      claimedAttempts: job.attempts,
      promise: Promise.resolve(false),
    };

    const tracked = async () => {
      try {
        return await runClaimedJob(db, clock, job, handlers, signal);
      } finally {
        inFlight.delete(entry);
      }
    };

    const settle = async () => {
      try {
        return await tracked();
      } catch (error) {
        logError(`jobs.run ${job.kind}`, error);

        return false;
      }
    };

    entry.promise = settle();

    inFlight.add(entry);
  }

  function busyKinds() {
    return [...inFlight].flatMap((entry) => (exclusive.has(entry.kind) ? [entry.kind] : []));
  }

  let wakeResolve: (() => void) | null = null;

  onEnqueue(() => {
    if (wakeResolve !== null) {
      wakeResolve();
      wakeResolve = null;
    }
  });

  function runOnce() {
    if (signal.aborted) {
      return;
    }

    const claimed = claimJobsToRun(db, clock, readBatchSize(db), singletonKinds, busyKinds());

    for (const job of claimed) {
      runTracked(job);
    }
  }

  async function step() {
    if (signal.aborted) {
      return;
    }

    try {
      const intervalMs = readPollIntervalMs(db);

      await waitForWake(intervalMs, signal, (wake) => {
        wakeResolve = wake;
      });

      wakeResolve = null;

      runOnce();
    } catch (error) {
      logError("jobs.loop", error);

      await waitForWake(ERROR_RETRY_DELAY_MS, signal);
    }

    return step();
  }

  void step();

  async function drain(timeoutMs: number) {
    const waiting = Promise.allSettled([...inFlight].map(async (entry) => entry.promise));
    const deadline = expiring(timeoutMs);

    await Promise.race([waiting, deadline.promise]);

    deadline.cancel();

    for (const entry of inFlight) {
      requeueWithoutConsumingAttempt(db, clock, entry.id, entry.claimedAttempts - 1);
    }
  }

  return { drain } satisfies JobWorker;
}
