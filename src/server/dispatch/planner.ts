import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications, profiles, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { getSetting } from "../platform/settings/index.ts";
import { dailyUsageSince, isOnboardingTrial } from "../billing/ledger.ts";
import { localDayStart, nextLocalDayStart } from "../platform/local-time.ts";
import { planSendSlots } from "./planning.ts";

export const PLANNER_DAY_JOB_KIND = "planner.day";

const DEFAULT_DAILY_CAP = 10;
const DEFAULT_SPACING_MINUTES = 5;
const MINUTE_MS = 60_000;

const payloadSchema = z.object({ userId: z.string().min(1) });

export interface PlannerRun {
  planned: number;
  remaining: number;
}

export interface PlannerDeps {
  db: AppDatabase;
  clock: Clock;
}

export interface PlannerService {
  plan: (userId: string) => PlannerRun;
  ensureMidnightQueued: (userId: string) => void;
}

function settingNumber(db: AppDatabase, key: string, fallback: number) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function plannerDayPayload(userId: string) {
  return JSON.stringify({ userId });
}

export function parsePlannerDayPayload(payload: string) {
  return payloadSchema.parse(JSON.parse(payload));
}

export function createPlanner(deps: PlannerDeps) {
  const { db, clock } = deps;

  function timeZoneOf(userId: string) {
    const row = db
      .select({
        pendingTimezone: profiles.pendingTimezone,
        pendingTimezoneAt: profiles.pendingTimezoneAt,
        timezone: profiles.timezone,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    if (row === undefined) {
      return null;
    }

    const now = clock.now();

    if (
      row.pendingTimezone !== null &&
      row.pendingTimezoneAt !== null &&
      row.pendingTimezoneAt.getTime() <= now
    ) {
      return row.pendingTimezone;
    }

    return row.timezone ?? "UTC";
  }

  function ensureMidnightQueued(userId: string) {
    const timeZone = timeZoneOf(userId) ?? "UTC";
    const runAt = nextLocalDayStart(clock.now(), timeZone);

    enqueueJob(db, clock, PLANNER_DAY_JOB_KIND, plannerDayPayload(userId), {
      dedupeKey: `${PLANNER_DAY_JOB_KIND}:midnight:${userId}:${String(runAt)}`,
      maxAttempts: 2,
      runAt,
    });
  }

  function plan(userId: string) {
    const now = clock.now();

    const profile = db
      .select({ emailVerified: users.emailVerified, running: profiles.running })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId))
      .get();

    if (profile === undefined || !profile.running || !profile.emailVerified) {
      return { planned: 0, remaining: 0 };
    }

    const timeZone = timeZoneOf(userId) ?? "UTC";
    const dailyCap = settingNumber(db, "limits.daily_cap", DEFAULT_DAILY_CAP);
    const trial = isOnboardingTrial(db, userId, now);

    // The onboarding trial's three Applications go at once; paid sends are spaced
    // per user. One person's spacing is read from their own rows and never shared.
    const spacingMs = trial
      ? 0
      : settingNumber(db, "limits.send_spacing_minutes", DEFAULT_SPACING_MINUTES) * MINUTE_MS;

    const todayStart = localDayStart(now, timeZone);

    const approved = db
      .select({
        approvedAt: applications.approvedAt,
        createdAt: applications.createdAt,
        id: applications.id,
        scheduledFor: applications.scheduledFor,
      })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "approved")))
      .orderBy(asc(applications.approvedAt), asc(applications.createdAt))
      .all();

    const unplaced = approved.filter((application) => application.scheduledFor === null);

    const usage = dailyUsageSince(db, userId, todayStart);

    const slots = planSendSlots({
      count: unplaced.length,
      dailyCap,
      now,
      scheduled: approved.flatMap((application) =>
        application.scheduledFor === null ? [] : [application.scheduledFor],
      ),
      spacingMs,
      timeZone,
      usedToday: usage,
    });

    for (const [index, application] of unplaced.entries()) {
      const scheduledFor = slots[index];

      if (scheduledFor === undefined) {
        continue;
      }

      db.update(applications)
        .set({ scheduledFor, updatedAt: now })
        .where(eq(applications.id, application.id))
        .run();
    }

    ensureMidnightQueued(userId);

    const planned = Math.min(slots.length, unplaced.length);
    const alreadyScheduledToday = approved.filter(
      (application) =>
        application.scheduledFor !== null &&
        localDayStart(application.scheduledFor, timeZone) === todayStart,
    ).length;
    const placedToday = slots.filter((slot) => localDayStart(slot, timeZone) === todayStart).length;

    if (planned > 0) {
      publishEvent(db, clock, "home.updated", JSON.stringify({ planned }), userId);
    }

    return {
      planned,
      remaining: Math.max(0, dailyCap - usage - alreadyScheduledToday - placedToday),
    };
  }

  return { ensureMidnightQueued, plan } satisfies PlannerService;
}

export function enqueuePlannerDay(db: DatabaseWriter, clock: Clock, userId: string) {
  return enqueueJob(db, clock, PLANNER_DAY_JOB_KIND, plannerDayPayload(userId), {
    dedupeKey: `${PLANNER_DAY_JOB_KIND}:${userId}`,
    maxAttempts: 2,
  });
}

export function ensurePlannerQueuedForRunningUsers(db: AppDatabase, clock: Clock) {
  const running = db
    .select({ userId: profiles.userId })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(
      and(eq(profiles.running, true), eq(users.emailVerified, true), sql`${users.role} <> 'demo'`),
    )
    .all();

  for (const row of running) {
    enqueuePlannerDay(db, clock, row.userId);
  }
}
