import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Random } from "../platform/ports/random.ts";

import { applications, profiles, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { getSetting } from "../platform/settings/index.ts";
import { dailyUsageSince } from "../billing/ledger.ts";
import { localDayStart, nextLocalDayStart } from "../platform/local-time.ts";
import { parseSendWindow, planSlots, planningWindow } from "./planning.ts";

export const PLANNER_DAY_JOB_KIND = "planner.day";

const DEFAULT_DAILY_CAP = 10;
const DEFAULT_SPACING_MINUTES = 20;
const MINUTE_MS = 60_000;
const MAX_PLANNED_DAYS = 366;

const payloadSchema = z.object({ userId: z.string().min(1) });

export interface PlannerRun {
  planned: number;
  remaining: number;
}

export interface PlannerDeps {
  db: AppDatabase;
  clock: Clock;
  random: Random;
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
  const { db, clock, random } = deps;

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
    const window = parseSendWindow(getSetting(db, "limits.send_window"));
    const dailyCap = settingNumber(db, "limits.daily_cap", DEFAULT_DAILY_CAP);

    const spacingMs =
      settingNumber(db, "limits.send_spacing_minutes", DEFAULT_SPACING_MINUTES) * MINUTE_MS;

    const target = planningWindow(now, timeZone, window);
    const todayStart = localDayStart(now, timeZone);
    const usage = target.dayStart === todayStart ? dailyUsageSince(db, userId, target.dayStart) : 0;

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

    const firstNeedsSlot = approved.findIndex(
      (application) =>
        application.scheduledFor === null || application.scheduledFor < target.dayStart,
    );

    const kept = firstNeedsSlot === -1 ? approved : approved.slice(0, firstNeedsSlot);

    const replan = firstNeedsSlot === -1 ? [] : approved.slice(firstNeedsSlot);

    const keptInTarget = kept.filter(
      (application) =>
        application.scheduledFor !== null &&
        application.scheduledFor >= target.dayStart &&
        application.scheduledFor < target.nextDayStart,
    );

    const keptSlots = kept.flatMap((application) =>
      application.scheduledFor === null ? [] : [application.scheduledFor],
    );

    const latestKept = keptSlots.length === 0 ? 0 : Math.max(...keptSlots);

    const remaining = Math.max(0, dailyCap - usage - keptInTarget.length);

    const staleSlots = replan.filter((application) => application.scheduledFor !== null);

    if (staleSlots.length > 0) {
      db.update(applications)
        .set({ scheduledFor: null, updatedAt: now })
        .where(
          inArray(
            applications.id,
            staleSlots.map((application) => application.id),
          ),
        )
        .run();
    }

    const slots = planSlots({
      blocked: keptSlots,
      count: Math.min(remaining, replan.length),
      now: Math.max(now, latestKept),
      random: random.next,
      spacingMs,
      timeZone,
      window,
    });

    let windowEnd = planningWindow(Math.max(now, latestKept), timeZone, window).end;

    for (let day = 0; day < MAX_PLANNED_DAYS && slots.length < replan.length; day += 1) {
      const next = planningWindow(windowEnd, timeZone, window);

      const later = planSlots({
        blocked: slots,
        count: Math.min(dailyCap, replan.length - slots.length),
        now: next.start,
        random: random.next,
        spacingMs,
        timeZone,
        window,
      });

      if (later.length === 0) {
        break;
      }

      slots.push(...later);
      windowEnd = next.end + 1;
    }

    for (const [index, application] of replan.slice(0, slots.length).entries()) {
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

    if (slots.length > 0) {
      publishEvent(db, clock, "home.updated", JSON.stringify({ planned: slots.length }), userId);
    }

    return { planned: slots.length, remaining };
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
