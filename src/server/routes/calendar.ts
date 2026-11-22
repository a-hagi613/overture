import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { calendarItemsOf } from "../calendar/items.ts";
import { localDateAt } from "../platform/local-time.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";

const CALENDAR_MAX_DAYS = 42;

const DAY_MS = 24 * 60 * 60_000;

function isTimeZone(zone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0).length > 0;
  } catch {
    return false;
  }
}

function localDaysIn(from: number, to: number, zone: string) {
  const first = localDateAt(from, zone);
  const last = localDateAt(to - 1, zone);

  return (
    Math.round(
      (Date.UTC(last.year, last.month - 1, last.day) -
        Date.UTC(first.year, first.month - 1, first.day)) /
        DAY_MS,
    ) + 1
  );
}

const rangeQuery = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});

/**
 * Every Sent Application, Stage move and Check-in that falls inside a window, for the signed-in user only.
 * The Calendar reads facts the user already sees on Home and the Board: no mail body, no answers.
 * @param deps The database, clock and auth the route reads through.
 * @returns The `GET /api/calendar` routes.
 */
export function createCalendarRoutes(deps: { auth: Auth; clock: Clock; db: AppDatabase }) {
  const { auth, db } = deps;

  const routes = new Hono();
  const zones = createTimeZoneService({ db, clock: deps.clock });

  routes.get("/calendar", async (context) => {
    const session = await auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    if (session === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    context.header("Cache-Control", "no-store");

    const range = rangeQuery.safeParse({
      from: context.req.query("from"),
      to: context.req.query("to"),
    });

    if (!range.success) {
      return context.json({ error: "range_invalid" }, 400);
    }

    const { from, to } = range.data;
    const start = Date.parse(from);
    const end = Date.parse(to);
    const userId = session.user.id;
    const { timezone } = await zones.current(userId);
    const timeZone = timezone ?? "UTC";
    const gridZone = context.req.query("timezone") ?? timeZone;

    if (!isTimeZone(gridZone)) {
      return context.json({ error: "range_invalid" }, 400);
    }

    if (end <= start) {
      return context.json({ error: "range_invalid" }, 400);
    }

    if (localDaysIn(start, end, gridZone) > CALENDAR_MAX_DAYS) {
      return context.json({ error: "range_too_wide" }, 400);
    }

    const items = calendarItemsOf(db, userId, start, end);

    items.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));

    return context.json({ items, timeZone });
  });

  return routes;
}
