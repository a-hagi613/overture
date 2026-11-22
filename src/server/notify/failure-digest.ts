import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { copy } from "../../shared/copy.ts";
import { applicationEvents, bgJobs, notifications } from "../platform/db/schema.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { logInfo } from "../platform/log.ts";
import { localPartsAt } from "../platform/local-time.ts";
import { effectiveTimeZone } from "../profile/time-zone.ts";
import { createNotification } from "./notifications.ts";

export const APPLY_FAILURES_JOB_KIND = "notify.apply_failures";

const HOUR_MS = 60 * 60_000;

/**
 * How far past the hour boundary the pass runs. A pass that ran in the last
 * seconds of an hour would read the hour before it and, one poll later, the
 * pass that lands the next hour could read two hours ahead of that, skipping
 * the hour in between. Running just after the boundary keeps every pass on the
 * hour that just ended.
 */
export const APPLY_FAILURES_BOUNDARY_MARGIN_MS = 5000;

export interface ApplyFailureDeps {
  db: AppDatabase;
  clock: Clock;
}

/**
 * The next hour boundary a pass runs at, a few seconds past it.
 * @param now The current time.
 * @returns The epoch a pass is due at.
 */
export function nextApplyFailuresRunAt(now: number) {
  return (Math.floor(now / HOUR_MS) + 1) * HOUR_MS + APPLY_FAILURES_BOUNDARY_MARGIN_MS;
}

function pinnedToBoundary(runAt: number) {
  return (runAt - APPLY_FAILURES_BOUNDARY_MARGIN_MS) % HOUR_MS === 0;
}

/**
 * Keep one hourly pass queued: it collapses a user's failures into one notice
 * per hour instead of a push per failure (SPEC §15.1). It is pinned to the hour
 * boundary so every pass reads the hour that just ended and no hour is skipped.
 *
 * A queued pass that is already on the boundary grid and no later than the next
 * one is left where it is. A boot during the boundary margin, or after downtime
 * across a boundary, must not push a pending pass an hour forward: that would
 * skip the hour it was about to read. Only an off-grid time, or one further
 * ahead than the next boundary (a queue written under a different clock), is
 * moved.
 * @param db The application database.
 * @param clock The clock the pass is scheduled from.
 * @returns Whether a new job was queued.
 */
export function ensureApplyFailuresQueued(db: AppDatabase, clock: Clock) {
  const now = clock.now();
  const runAt = nextApplyFailuresRunAt(now);

  const queued = db
    .select({ id: bgJobs.id, runAt: bgJobs.runAt })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, APPLY_FAILURES_JOB_KIND), eq(bgJobs.status, "queued")))
    .get();

  if (queued !== undefined) {
    if (!pinnedToBoundary(queued.runAt) || queued.runAt > runAt) {
      db.update(bgJobs).set({ runAt, updatedAt: now }).where(eq(bgJobs.id, queued.id)).run();
    }

    return false;
  }

  const job = enqueueJob(db, clock, APPLY_FAILURES_JOB_KIND, "{}", {
    dedupeKey: APPLY_FAILURES_JOB_KIND,
    maxAttempts: 2,
    runAt,
  });

  return job.inserted;
}

function hourLabel(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);

  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function runPass(deps: ApplyFailureDeps) {
  const now = deps.clock.now();
  const windowEnd = now - (now % HOUR_MS);
  const windowStart = windowEnd - HOUR_MS;

  const failures = deps.db
    .select({
      applicationId: applicationEvents.applicationId,
      userId: applicationEvents.userId,
    })
    .from(applicationEvents)
    .where(
      and(
        eq(applicationEvents.kind, "status"),
        eq(applicationEvents.toValue, "failed"),
        gte(applicationEvents.at, windowStart),
        lt(applicationEvents.at, windowEnd),
      ),
    )
    .orderBy(asc(applicationEvents.at))
    .all();

  const byUser = new Map<string, Set<string>>();

  for (const failure of failures) {
    const seen = byUser.get(failure.userId) ?? new Set<string>();

    seen.add(failure.applicationId);
    byUser.set(failure.userId, seen);
  }

  let told = 0;

  for (const [userId, applicationIds] of byUser) {
    const alreadyTold = deps.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.kind, copy.notifications.failedSummary.kind),
          gte(notifications.createdAt, windowEnd),
        ),
      )
      .get();

    if (alreadyTold !== undefined) {
      continue;
    }

    const timeZone = effectiveTimeZone(deps.db, userId, now);
    const label = `${hourLabel(windowStart, timeZone)} and ${hourLabel(windowEnd, timeZone)}`;

    const created = createNotification(deps.db, deps.clock, {
      body: copy.notifications.failedSummary.body(label),
      kind: copy.notifications.failedSummary.kind,
      title: copy.notifications.failedSummary.title(applicationIds.size),
      url: copy.notifications.failedSummary.url,
      userId,
    });

    if (created !== null) {
      told += 1;
    }
  }

  if (told > 0) {
    logInfo(
      "notify.apply_failures",
      `${String(told)} users told for the hour ending ${String(windowEnd)}`,
    );
  }

  return { told };
}

/**
 * One summary per user for the failures of the hour that just ended. It reads
 * the status events the dispatcher already writes, so a crash between the write
 * and this pass still tells the user, and several failures in the hour arrive
 * as one row and one push instead of one each. A row already written for the
 * hour makes a retried pass a no-op, so a busy database can be retried safely.
 * @param deps The database and clock.
 * @returns How many users were told.
 */
export async function runApplyFailures(deps: ApplyFailureDeps) {
  return retryWhenBusy(() => runPass(deps), "notify.apply_failures");
}
