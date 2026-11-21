import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { PreparationService } from "./prepare.ts";

import { addLocalDays, localDateAt, localPartsAt, localTimeOn } from "../platform/local-time.ts";
import { applications, bgJobs, profiles } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getSetting } from "../platform/settings/index.ts";
import { effectiveTimeZone } from "../profile/time-zone.ts";
import { enqueueReadyNotify } from "../notify/ready-recap.ts";

export const PREP_DAILY_JOB_KIND = "prep.daily";
export const DEFAULT_PREP_RUN_MINUTES = 7 * 60;

const TIME_PATTERN = /^(?<hours>\d{1,2}):(?<minutes>\d{2})$/u;

const payloadSchema = z.object({
  since: z.number().int().nonnegative().optional(),
  userId: z.string().min(1),
});

export interface PrepDailyDeps {
  db: AppDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  preparation: PreparationService;
}

export interface PrepDailyRun {
  applicationsCreated: number;
  candidates: number;
  notifyQueued: boolean;
  scored: number;
  skipped: boolean;
}

export function prepDailyPayload(userId: string, since: number) {
  return JSON.stringify({ since, userId });
}

export function parsePrepDailyPayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

/**
 * Minutes after local midnight for `prep.run_local_time`.
 * @param raw The stored setting, or null when it is unset.
 * @returns Minutes after local midnight, 07:00 by default.
 */
export function parsePrepRunMinutes(raw: string | null) {
  if (raw === null) {
    return DEFAULT_PREP_RUN_MINUTES;
  }

  const match = TIME_PATTERN.exec(raw);

  if (match?.groups === undefined) {
    return DEFAULT_PREP_RUN_MINUTES;
  }

  const hours = Number(match.groups["hours"]);
  const minutes = Number(match.groups["minutes"]);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return DEFAULT_PREP_RUN_MINUTES;
  }

  return hours * 60 + minutes;
}

export function nextPrepRunAt(now: number, timeZone: string, runMinutes: number) {
  const today = localDateAt(now, timeZone);
  const todayAt = localTimeOn(today, Math.trunc(runMinutes / 60), runMinutes % 60, timeZone);

  if (now < todayAt) {
    return todayAt;
  }

  const tomorrow = addLocalDays(today, 1);

  return localTimeOn(tomorrow, Math.trunc(runMinutes / 60), runMinutes % 60, timeZone);
}

function dateKey(at: number, timeZone: string) {
  const parts = localPartsAt(at, timeZone);

  return `${String(parts.year)}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dedupeKeyFor(userId: string, at: number, timeZone: string) {
  return `${PREP_DAILY_JOB_KIND}:${userId}:${dateKey(at, timeZone)}`;
}

function enqueueRun(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  runAt: number,
  key: string,
  since: number,
) {
  return enqueueJob(db, clock, PREP_DAILY_JOB_KIND, prepDailyPayload(userId, since), {
    dedupeKey: key,
    maxAttempts: 2,
    runAt,
  });
}

/**
 * Keep one run scheduled per user per local day: today's run (now, if its time
 * has passed and it has not run yet) and tomorrow's at `prep.run_local_time`.
 * @param db The application database.
 * @param clock The clock the schedule is read from.
 * @param userId The user to schedule.
 */
export function ensurePrepDailyQueued(db: AppDatabase, clock: Clock, userId: string) {
  const now = clock.now();
  const timeZone = effectiveTimeZone(db, userId, now);
  const runMinutes = parsePrepRunMinutes(getSetting(db, "prep.run_local_time"));
  const today = localDateAt(now, timeZone);
  const todayAt = localTimeOn(today, Math.trunc(runMinutes / 60), runMinutes % 60, timeZone);

  if (now < todayAt) {
    enqueueRun(db, clock, userId, todayAt, dedupeKeyFor(userId, todayAt, timeZone), todayAt);

    return;
  }

  const todayKey = dedupeKeyFor(userId, todayAt, timeZone);

  const todayQueued = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(eq(bgJobs.dedupeKey, todayKey))
    .get();

  if (todayQueued === undefined) {
    enqueueRun(db, clock, userId, now, todayKey, now);
  }

  const tomorrowAt = nextPrepRunAt(now, timeZone, runMinutes);

  enqueueRun(db, clock, userId, tomorrowAt, dedupeKeyFor(userId, tomorrowAt, timeZone), tomorrowAt);
}

export function ensurePrepQueuedForRunningUsers(db: AppDatabase, clock: Clock) {
  const running = db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.running, true))
    .all();

  for (const row of running) {
    ensurePrepDailyQueued(db, clock, row.userId);
  }
}

/**
 * The daily run: match, prepare and stop at the free Ready slots. It never
 * schedules or sends anything; only an Approval does that (ADR 0029). It ends
 * by queuing the Recap email job, which sends at most one email a day.
 * @param deps The services the run needs.
 * @param userId The running user to prepare for.
 * @param since When this run's window opened; a retry keeps the same window.
 * @returns What the run created and whether its Recap is queued.
 */
export async function runPrepDailyJob(deps: PrepDailyDeps, userId: string, since: number) {
  const profile = deps.db
    .select({ running: profiles.running })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();

  if (profile === undefined || !profile.running) {
    return {
      applicationsCreated: 0,
      candidates: 0,
      notifyQueued: false,
      scored: 0,
      skipped: true,
    } satisfies PrepDailyRun;
  }

  const { createMatchingService } = await import("../matching/score.ts");

  const matching = createMatchingService({
    clock: deps.clock,
    db: deps.db,
    llm: deps.llm,
    personal: deps.personal,
  });

  const run = await matching.fill(userId);

  const preparing = deps.db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.status, "preparing")))
    .all();

  await deps.preparation.prepareMany([
    ...new Set([...preparing.map((application) => application.id), ...run.createdIds]),
  ]);

  const notify = enqueueReadyNotify(deps.db, deps.clock, userId, since);

  return {
    applicationsCreated: run.applicationsCreated,
    candidates: run.candidates,
    notifyQueued: notify.inserted,
    scored: run.scored,
    skipped: false,
  } satisfies PrepDailyRun;
}
