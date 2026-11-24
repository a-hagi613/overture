import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { SpendGate } from "../billing/spend.ts";
import type { PreparationService } from "./prepare.ts";

import { addLocalDays, localDateAt, localPartsAt, localTimeOn } from "../platform/local-time.ts";
import { applications, bgJobs, profiles, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { getStoredSetting } from "../platform/settings/index.ts";
import { effectiveTimeZone } from "../profile/time-zone.ts";
import { enqueueReadyNotify } from "../notify/ready-recap.ts";

export const PREP_DAILY_JOB_KIND = "prep.daily";
export const DEFAULT_PREP_RUN_MINUTES = 7 * 60;
export const PREP_STAGGER_START_MINUTES = 5 * 60;
export const PREP_STAGGER_WINDOW_MINUTES = 150;

const TIME_PATTERN = /^(?<hours>\d{1,2}):(?<minutes>\d{2})$/u;

const payloadSchema = z.object({
  since: z.number().int().nonnegative().optional(),
  userId: z.string().min(1),
});

export interface PrepDailyDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  llm: LlmPort;
  personal: PersonalCrypto;
  preparation: PreparationService;
  spendGate?: SpendGate | undefined;
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
 * @returns Minutes after local midnight; 07:00 when the stored value is invalid or missing.
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

/**
 * A stable rolling hash over the user id: a cheap 32-bit-style value with no
 * database column, no randomness and no clock input, so a user's morning slot
 * survives restarts.
 * @param text The user id.
 * @returns A deterministic non-negative integer.
 */
export function stableSlotHash(text: string) {
  const prime = 2_147_483_647;
  let hash = 0;

  for (const char of text) {
    hash = (hash * 33 + (char.codePointAt(0) ?? 0)) % prime;
  }

  return hash;
}

/**
 * The local minute a user's daily preparation starts. Without an explicit
 * `prep.run_local_time` it is `05:00 + stableSlotHash(userId) % 150`, spreading
 * the morning window over 05:00-07:30; a stored admin value overrides it.
 * @param userId The user whose slot is wanted.
 * @param storedRunLocalTime The raw setting, or null when it was never saved.
 * @returns Minutes after local midnight.
 */
export function prepRunMinutesFor(userId: string, storedRunLocalTime: string | null) {
  if (storedRunLocalTime !== null) {
    return parsePrepRunMinutes(storedRunLocalTime);
  }

  return PREP_STAGGER_START_MINUTES + (stableSlotHash(userId) % PREP_STAGGER_WINDOW_MINUTES);
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
  db: DatabaseWriter,
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
 * has passed and it has not run yet) and tomorrow's at the user's staggered
 * morning slot (`prep.run_local_time` when an admin set it).
 * @param db The application database.
 * @param clock The clock the schedule is read from.
 * @param userId The user to schedule.
 */
export function ensurePrepDailyQueued(db: DatabaseWriter, clock: Clock, userId: string) {
  const now = clock.now();
  const timeZone = effectiveTimeZone(db, userId, now);
  const runMinutes = prepRunMinutesFor(userId, getStoredSetting(db, "prep.run_local_time"));
  const today = localDateAt(now, timeZone);
  const todayAt = localTimeOn(today, Math.trunc(runMinutes / 60), runMinutes % 60, timeZone);

  if (now < todayAt) {
    enqueueRun(db, clock, userId, todayAt, dedupeKeyFor(userId, todayAt, timeZone), todayAt);

    return;
  }

  const onboarded = db
    .select({ onboardedAt: profiles.onboardedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get()?.onboardedAt;

  const startedAfterTodaysRun =
    onboarded !== null && onboarded !== undefined && onboarded.getTime() >= todayAt;

  const todayKey = dedupeKeyFor(userId, todayAt, timeZone);

  const todayQueued = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(eq(bgJobs.dedupeKey, todayKey))
    .get();

  if (todayQueued === undefined && !startedAfterTodaysRun) {
    enqueueRun(db, clock, userId, now, todayKey, now);
  }

  const tomorrowAt = nextPrepRunAt(now, timeZone, runMinutes);

  enqueueRun(db, clock, userId, tomorrowAt, dedupeKeyFor(userId, tomorrowAt, timeZone), tomorrowAt);
}

/**
 * Schedule only the next run at the user's staggered morning slot, never a
 * catch-up for today. Onboarding's Start uses it: pressing Start must not launch
 * a run.
 * @param db The application database.
 * @param clock The clock the schedule is read from.
 * @param userId The user to schedule.
 * @returns When the run is due.
 */
export function ensurePrepNextQueued(db: AppDatabase, clock: Clock, userId: string) {
  const now = clock.now();
  const timeZone = effectiveTimeZone(db, userId, now);
  const runMinutes = prepRunMinutesFor(userId, getStoredSetting(db, "prep.run_local_time"));
  const runAt = nextPrepRunAt(now, timeZone, runMinutes);

  enqueueRun(db, clock, userId, runAt, dedupeKeyFor(userId, runAt, timeZone), runAt);

  return runAt;
}

export function ensurePrepQueuedForRunningUsers(db: AppDatabase, clock: Clock) {
  const running = db
    .select({ userId: profiles.userId })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(eq(profiles.running, true), eq(users.emailVerified, true), sql`${users.role} <> 'demo'`),
    )
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
    .select({ emailVerified: users.emailVerified, role: users.role, running: profiles.running })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .get();

  if (
    profile === undefined ||
    !profile.running ||
    !profile.emailVerified ||
    profile.role === "demo"
  ) {
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
    catalogDb: deps.catalogDb,
    clock: deps.clock,
    db: deps.db,
    llm: deps.llm,
    personal: deps.personal,
    spendGate: deps.spendGate,
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
