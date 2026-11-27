import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { JobHandlers } from "../platform/jobs/queue.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import type { MatchScoringService } from "./match-scoring.ts";

export const MATCH_SCORE_POOL_JOB_KIND = "matching.score.pool";
export const MATCH_SCORE_NEW_JOB_KIND = "matching.score.new";
export const MATCH_RESCORE_JOB_KIND = "matching.rescore";

const payloadSchema = z.object({ userId: z.string().min(1), jobId: z.string().min(1).optional() });

interface MatchJobPayload {
  userId: string;
  jobId?: string;
}

function enqueue(
  db: AppDatabase,
  clock: Clock,
  kind: string,
  payload: MatchJobPayload,
  key: string,
) {
  if (Bun.env.ENABLE_TEST_ROUTES === "true") {
    return false;
  }

  return enqueueJob(db, clock, kind, JSON.stringify(payload), {
    dedupeKey: key,
    maxAttempts: 2,
  });
}

/**
 * Queues the full pool scoring a preference save asks for, so the person does not wait on the request.
 * @param db The application database.
 * @param clock The clock the job is queued at.
 * @param userId The account whose preferences changed.
 * @returns Whether a new job was queued.
 */
export function enqueueMatchScorePool(db: AppDatabase, clock: Clock, userId: string) {
  return enqueue(
    db,
    clock,
    MATCH_SCORE_POOL_JOB_KIND,
    { userId },
    `${MATCH_SCORE_POOL_JOB_KIND}:${userId}`,
  );
}

/**
 * Queues the Batch scoring for jobs a paid user's fresh pull brought in.
 * @param db The application database.
 * @param clock The clock the job is queued at.
 * @param userId The paid account.
 * @returns Whether a new job was queued.
 */
export function enqueueMatchScoreNew(db: AppDatabase, clock: Clock, userId: string) {
  return enqueue(
    db,
    clock,
    MATCH_SCORE_NEW_JOB_KIND,
    { userId },
    `${MATCH_SCORE_NEW_JOB_KIND}:${userId}`,
  );
}

/**
 * Queues a rescore after a resume or scorer-version change.
 * @param db The application database.
 * @param clock The clock the job is queued at.
 * @param userId The account.
 * @returns Whether a new job was queued.
 */
export function enqueueMatchRescore(db: AppDatabase, clock: Clock, userId: string) {
  return enqueue(
    db,
    clock,
    MATCH_RESCORE_JOB_KIND,
    { userId },
    `${MATCH_RESCORE_JOB_KIND}:${userId}`,
  );
}

/**
 * Queues one job's rescore after its description changed.
 * @param db The application database.
 * @param clock The clock the job is queued at.
 * @param userId The account.
 * @param jobId The freehire public slug.
 * @returns Whether a new job was queued.
 */
export function enqueueMatchRescoreJob(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  jobId: string,
) {
  return enqueue(
    db,
    clock,
    MATCH_RESCORE_JOB_KIND,
    { jobId, userId },
    `${MATCH_RESCORE_JOB_KIND}:${userId}:${jobId}`,
  );
}

/**
 * The background handlers the worker merges in. Every scoring trigger goes through here.
 * @param service The scoring service.
 * @returns The handlers keyed by job kind.
 */
export function createMatchScoringJobHandlers(service: MatchScoringService) {
  return {
    [MATCH_SCORE_POOL_JOB_KIND]: async (payload) => {
      const { userId } = payloadSchema.parse(JSON.parse(payload));

      await service.pruneRemoved(userId);
      await service.scorePool(userId);
    },
    [MATCH_SCORE_NEW_JOB_KIND]: async (payload) => {
      const { userId } = payloadSchema.parse(JSON.parse(payload));

      await service.scoreNewJobs(userId);
    },
    [MATCH_RESCORE_JOB_KIND]: async (payload) => {
      const { jobId, userId } = payloadSchema.parse(JSON.parse(payload));

      if (jobId === undefined) {
        await service.rescore(userId);
      } else {
        await service.rescoreJob(userId, jobId);
      }
    },
  } satisfies JobHandlers;
}
