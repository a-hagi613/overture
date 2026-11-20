import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { claimAndRunDueJobs } from "./queue.ts";

export type { JobHandlers } from "./queue.ts";

export async function runDueJobs(
  db: AppDatabase,
  clock: Clock,
  handlers: Readonly<Record<string, (payload: string) => Promise<void>>>,
) {
  const controller = new AbortController();

  return claimAndRunDueJobs(db, clock, handlers, controller.signal);
}
