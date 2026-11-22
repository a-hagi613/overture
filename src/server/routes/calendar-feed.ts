import { Hono } from "hono";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import { readSessionUser } from "../auth/session.ts";
import { calendarItemsOf } from "../calendar/items.ts";
import type { CalendarItemView } from "../calendar/items.ts";
import { renderIcsCalendar } from "../calendar/ics.ts";
import {
  feedStatusOf,
  issueFeedToken,
  revokeFeedToken,
  userIdForFeedToken,
} from "../calendar/feed.ts";
import { localDateAt } from "../platform/local-time.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";

const DAY_MS = 24 * 60 * 60_000;

const FEED_PAST_DAYS = 180;
const FEED_FUTURE_DAYS = 365;

const STAGE_LABEL = {
  applied: "Applied",
  closed: "Closed",
  interviewing: "Interviewing",
  offer: "Offer",
  screening: "Screening",
} as const;

const KIND_LABEL: Readonly<Record<CalendarItemView["kind"], string>> = {
  checkin: "Check-in",
  interview: "Interview",
  sent: "Sent",
  stage: "Stage",
};

function icsEventOf(item: CalendarItemView, timeZone: string, stampAt: number) {
  const label =
    item.kind === "stage" && item.stage !== null ? STAGE_LABEL[item.stage] : KIND_LABEL[item.kind];

  const start =
    item.kind === "interview"
      ? { at: item.at, kind: "datetime" as const }
      : { ...localDateAt(item.at, timeZone), kind: "date" as const };

  return {
    start,
    stampAt,
    summary: `${label}: ${item.title} at ${item.company}`,
    uid: `${item.id}@overture`,
  };
}

/**
 * The calendar feed (ADR 0034, M4): the signed-in Settings controls, and the public `.ics` URL that calendar apps
 * subscribe to with a revocable token in the path.
 * @param deps The database, clock and auth the routes read through.
 * @returns The feed routes, mounted at the root of the app.
 */
export function createCalendarFeedRoutes(deps: { auth: Auth; clock: Clock; db: AppDatabase }) {
  const { auth, clock, db } = deps;

  const routes = new Hono();
  const zones = createTimeZoneService({ db, clock });

  async function signedInUserId(headers: Headers) {
    const user = await readSessionUser(auth, headers);

    return user?.id ?? null;
  }

  routes.get("/api/calendar/feed", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const userId = await signedInUserId(context.req.raw.headers);

    if (userId === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    return context.json(feedStatusOf(db, userId));
  });

  routes.post("/api/calendar/feed/token", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const userId = await signedInUserId(context.req.raw.headers);

    if (userId === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    const { status, token } = issueFeedToken(db, clock, userId);

    return context.json({ path: `/calendar/${token}.ics`, status });
  });

  routes.delete("/api/calendar/feed", async (context) => {
    context.header("Cache-Control", "private, no-store");

    const userId = await signedInUserId(context.req.raw.headers);

    if (userId === null) {
      return context.json({ error: "sign_in_required" }, 401);
    }

    revokeFeedToken(db, userId);

    return context.json(feedStatusOf(db, userId));
  });

  routes.get("/calendar/:file", async (context) => {
    const headers = {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    };

    const file = context.req.param("file");
    const token = file.endsWith(".ics") ? file.slice(0, -".ics".length) : null;
    const userId = token === null ? null : userIdForFeedToken(db, token);

    if (userId === null) {
      return context.body(null, 404, headers);
    }

    const now = clock.now();
    const { timezone } = await zones.current(userId);
    const timeZone = timezone ?? "UTC";

    const items = calendarItemsOf(
      db,
      userId,
      now - FEED_PAST_DAYS * DAY_MS,
      now + FEED_FUTURE_DAYS * DAY_MS,
    );

    const body = renderIcsCalendar(items.map((item) => icsEventOf(item, timeZone, now)));

    return context.body(body, 200, {
      ...headers,
      "Content-Type": "text/calendar; charset=utf-8",
    });
  });

  return routes;
}
