import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { validJson, validQuery } from "./validators.ts";
import { readSession, readSessionUser } from "../auth/session.ts";
import { calendarItemsOf, sortCalendarItems } from "../calendar/items.ts";
import {
  createCalendarCustomEvent,
  deleteCalendarCustomEvent,
  listCalendarCustomEvents,
} from "../calendar/custom-events.ts";
import { demoLocked } from "../demo/guard.ts";
import { localDateAt } from "../platform/local-time.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";
import {
  calendarEventInputSchema,
  calendarEventsQuerySchema,
} from "../../shared/calendar-events.ts";

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
    const session = await readSession(auth, context.req.raw.headers);

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

    const items = sortCalendarItems(calendarItemsOf(db, userId, start, end));

    return context.json({ items, timeZone });
  });

  routes.get("/calendar/events", validQuery(calendarEventsQuerySchema), async (context) => {
    context.header("Cache-Control", "private, no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const { from, to } = context.req.valid("query");

    const events = listCalendarCustomEvents(
      db,
      user.id,
      from === undefined || to === undefined ? null : { from, to },
    );

    return context.json({ events });
  });

  routes.post("/calendar/events", validJson(calendarEventInputSchema), async (context) => {
    context.header("Cache-Control", "private, no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(user.role);

    if (locked !== null) {
      return locked;
    }

    const input = context.req.valid("json");

    const event = createCalendarCustomEvent(db, deps.clock, user.id, {
      company: input.company,
      dayKey: input.dayKey,
      kind: input.kind,
      time: input.time,
      title: input.title,
    });

    return context.json({ event }, 201);
  });

  routes.delete("/calendar/events/:id", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const user = await readSessionUser(auth, context.req.raw.headers);

    if (user === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    const locked = demoLocked(user.role);

    if (locked !== null) {
      return locked;
    }

    const deleted = deleteCalendarCustomEvent(db, user.id, context.req.param("id"));

    if (!deleted) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json({ ok: true });
  });

  return routes;
}
