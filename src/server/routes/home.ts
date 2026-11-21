import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { MatchingService } from "../matching/score.ts";

import { applicationsLeft, committedSince, planApplications } from "../billing/ledger.ts";
import { profiles } from "../platform/db/schema.ts";
import { eq } from "drizzle-orm";
import { getSetting } from "../platform/settings/index.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";
import { localDayStart } from "../platform/local-time.ts";
import { enqueuePlannerDay } from "../dispatch/planner.ts";

const UP_NEXT_LIMIT = 6;

const runningBody = z.object({ running: z.boolean() });

function dailyCapOf(db: AppDatabase) {
  const stored = getSetting(db, "limits.daily_cap");
  const parsed = stored === null ? Number.NaN : Number(stored);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export function createHomeRoutes(
  db: AppDatabase,
  clock: Clock,
  auth: Auth,
  matching: MatchingService,
) {
  const routes = new Hono();
  const zones = createTimeZoneService({ db, clock });

  async function sessionUser(headers: Headers) {
    const result = await auth.api.getSession({ headers }).catch(() => null);

    return result?.user ?? null;
  }

  routes.get("/home", async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const at = clock.now();
    const userId = user.id;
    const { timezone } = await zones.current(userId);

    const profile = db
      .select({ running: profiles.running })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get();

    const dayStart = localDayStart(at, timezone ?? "UTC");
    const sentToday = committedSince(db, userId, dayStart);
    const dailyCap = dailyCapOf(db);
    const left = applicationsLeft(db, userId, at);

    return context.json({
      applicationsLeft: left,
      planApplications: planApplications(db, userId, at),
      running: profile?.running ?? false,
      sentToday,
      dailyCap,
      remainingToday: Math.max(0, Math.min(dailyCap, left) - sentToday),
      upNext: await matching.upNext(userId, UP_NEXT_LIMIT),
    });
  });

  routes.post("/running", zValidator("json", runningBody), async (context) => {
    const user = await sessionUser(context.req.raw.headers);

    if (user === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { running } = context.req.valid("json");
    const now = clock.now();
    const pauseReason = running ? null : "user";

    db.insert(profiles)
      .values({
        createdAt: new Date(now),
        languages: "[]",
        pauseReason,
        running,
        updatedAt: new Date(now),
        userId: user.id,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { pauseReason, running, updatedAt: new Date(now) },
      })
      .run();

    if (running) {
      enqueuePlannerDay(db, clock, user.id);
    }

    return context.json({ pauseReason, running });
  });

  return routes;
}
