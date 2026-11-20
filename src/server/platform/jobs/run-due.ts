import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { claimAndRunDueJobs } from "./queue.ts";
import { getSetting } from "../settings/index.ts";

export type { JobHandlers } from "./queue.ts";

const DEFAULT_BATCH_SIZE = 10;

export async function runDueJobs(
  db: AppDatabase,
  clock: Clock,
  handlers: Readonly<Record<string, (payload: string) => Promise<void>>>,
) {
  const controller = new AbortController();
  const raw = getSetting(db, "jobs.batch_size");
  const parsed = raw === null ? Number.NaN : Number(raw);

  const batchSize =
    Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : DEFAULT_BATCH_SIZE;

  return claimAndRunDueJobs(db, clock, handlers, controller.signal, batchSize);
}
