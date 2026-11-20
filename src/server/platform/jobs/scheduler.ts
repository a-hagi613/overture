import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { JobHandlers } from "./queue.ts";

import { claimAndRunDueJobs } from "./queue.ts";
import { getSetting } from "../settings/index.ts";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 10;
const MIN_POLL_INTERVAL_MS = 1000;

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

    onResolve(resolve);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

async function runOnce(db: AppDatabase, clock: Clock, handlers: JobHandlers, signal: AbortSignal) {
  if (signal.aborted) {
    return;
  }

  const batchSize = readBatchSize(db);

  await claimAndRunDueJobs(db, clock, handlers, signal, batchSize);
}

export function startJobWorker(
  db: AppDatabase,
  clock: Clock,
  handlers: JobHandlers,
  signal: AbortSignal,
  onEnqueue: (notify: () => void) => void,
) {
  let wakeResolve: (() => void) | null = null;

  onEnqueue(() => {
    if (wakeResolve !== null) {
      wakeResolve();
      wakeResolve = null;
    }
  });

  async function step() {
    await runOnce(db, clock, handlers, signal);

    if (signal.aborted) {
      return;
    }

    const intervalMs = readPollIntervalMs(db);

    await sleep(intervalMs, signal, (resolve) => {
      wakeResolve = resolve;
    });

    wakeResolve = null;

    return step();
  }

  void step();
}
