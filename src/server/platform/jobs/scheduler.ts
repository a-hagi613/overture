import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { ClaimedJob, JobHandlers } from "./queue.ts";

import { claimDueJobs, requeueWithoutConsumingAttempt, runClaimedJob } from "./queue.ts";
import { getSetting } from "../settings/index.ts";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 10;
const MIN_POLL_INTERVAL_MS = 1000;

interface InFlightJob {
  id: string;
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

async function sleep(ms: number, signal: AbortSignal, onResolve: (resolve: () => void) => void) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );

    onResolve(resolve);
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
) {
  const inFlight = new Set<InFlightJob>();

  function runTracked(job: ClaimedJob) {
    const entry: InFlightJob = {
      id: job.id,
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

    entry.promise = tracked();

    inFlight.add(entry);
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

    const claimed = claimDueJobs(db, clock, readBatchSize(db));

    for (const job of claimed) {
      runTracked(job);
    }
  }

  async function step() {
    if (signal.aborted) {
      return;
    }

    const intervalMs = readPollIntervalMs(db);

    await sleep(intervalMs, signal, (resolve) => {
      wakeResolve = resolve;
    });

    wakeResolve = null;

    runOnce();

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
