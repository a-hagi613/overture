import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { applicationsLeft, committedSince, planApplications } from "../billing/ledger.ts";
import { getSetting } from "../platform/settings/index.ts";

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

export function createHomeRoutes(db: AppDatabase, clock: Clock, auth: Auth) {
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

    return context.json({
      applicationsLeft: applicationsLeft(db, userId, at),
      planApplications: planApplications(db, userId, at),
      sentToday: committedSince(db, userId, dayStartOf(at)),
      dailyCap: dailyCapOf(db),
    });
  });

  return routes;
}
