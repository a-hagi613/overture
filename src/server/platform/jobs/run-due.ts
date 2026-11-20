import { and, eq, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { jobs } from "../db/schema.ts";

export type JobHandlers = Readonly<Record<string, (payload: string) => Promise<void>>>;

export async function runDueJobs(db: AppDatabase, clock: Clock, handlers: JobHandlers) {
  const now = clock.now();

  const due = await db
    .select()
    .from(jobs)
    .where(and(isNull(jobs.claimedAt), lte(jobs.dueAt, now)));

  const claims = await Promise.all(
    due.map(async (job) => {
      const handler = handlers[job.kind];

      if (handler === undefined) {
        return false;
      }

      await db.update(jobs).set({ claimedAt: now }).where(eq(jobs.id, job.id));
      await handler(job.payload);
      await db.update(jobs).set({ finishedAt: clock.now() }).where(eq(jobs.id, job.id));

      return true;
    }),
  );

  return claims.filter(Boolean).length;
}
