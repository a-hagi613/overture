import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";

export const APPLICATION_PREPARE_JOB_KIND = "application.prepare";

const payloadSchema = z.object({ applicationId: z.string().min(1) });

export function applicationPreparePayload(applicationId: string) {
  return JSON.stringify({ applicationId });
}

export function parseApplicationPreparePayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

export function enqueueApplicationPrepare(db: AppDatabase, clock: Clock, applicationId: string) {
  return enqueueJob(
    db,
    clock,
    APPLICATION_PREPARE_JOB_KIND,
    applicationPreparePayload(applicationId),
    { dedupeKey: `application.prepare:${applicationId}` },
  );
}
