import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";
import type { MatchingService } from "../matching/score.ts";

import { applicationsLeft, committedSince, planApplications } from "../billing/ledger.ts";
import { getSetting } from "../platform/settings/index.ts";

const UP_NEXT_LIMIT = 6;

function dayStartOf(at: number) {
  const day = new Date(at);

  day.setUTCHours(0, 0, 0, 0);

  return day.getTime();
}

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

  routes.get("/home", async (context) => {
    const result = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    const session = result ?? null;

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const at = clock.now();
    const userId = session.user.id;

    const sentToday = committedSince(db, userId, dayStartOf(at));
    const dailyCap = dailyCapOf(db);
    const left = applicationsLeft(db, userId, at);

    return context.json({
      applicationsLeft: left,
      planApplications: planApplications(db, userId, at),
      sentToday,
      dailyCap,
      remainingToday: Math.max(0, Math.min(dailyCap, left) - sentToday),
      upNext: await matching.upNext(userId, UP_NEXT_LIMIT),
    });
  });

  return routes;
}
