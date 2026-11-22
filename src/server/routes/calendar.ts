import { Hono } from "hono";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { Auth } from "../auth/index.ts";

import type { CheckinAnswer } from "../../shared/checkins.ts";

import { CHECKIN_ANSWERS } from "../../shared/checkins.ts";
import {
  applications,
  applicationEvents,
  applicationSnapshots,
  checkins,
  companies,
  interviewEvents,
  postings,
} from "../platform/db/schema.ts";
import { localDateAt } from "../platform/local-time.ts";
import { createTimeZoneService } from "../profile/time-zone.ts";

const CALENDAR_MAX_DAYS = 42;

const CALENDAR_STAGES = ["applied", "screening", "interviewing", "offer", "closed"] as const;

type CalendarStage = (typeof CALENDAR_STAGES)[number];

type CalendarKind = "sent" | "stage" | "checkin" | "interview";

type CalendarSource = "system" | "user" | "email" | "checkin" | "admin";

interface CalendarItemView {
  id: string;
  kind: CalendarKind;
  at: number;
  applicationId: string;
  title: string;
  company: string;
  stage: CalendarStage | null;
  closedReason: string | null;
  source: CalendarSource | null;
}

const DAY_MS = 24 * 60 * 60_000;

const STAGE_FOR_ANSWER: Readonly<Record<CheckinAnswer, CalendarStage>> = {
  interviewing: "interviewing",
  rejected: "closed",
  still_waiting: "applied",
};

function calendarStageOf(value: string | null) {
  switch (value) {
    case "applied":
    case "screening":
    case "interviewing":
    case "offer":
    case "closed": {
      return value;
    }

    default: {
      return null;
    }
  }
}

function checkinAnswerOf(value: string | null) {
  switch (value) {
    case "interviewing":
    case "rejected":
    case "still_waiting": {
      return value;
    }

    default: {
      return null;
    }
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

  function sentItemsOf(userId: string, start: number, end: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        at: applications.sentAt,
        company: companies.name,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: postings.title,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(applications.userId, userId),
          gte(applications.sentAt, start),
          lt(applications.sentAt, end),
        ),
      )
      .all();

    const items: CalendarItemView[] = [];

    for (const row of rows) {
      if (row.at === null) {
        continue;
      }

      items.push({
        applicationId: row.applicationId,
        at: row.at,
        closedReason: null,
        company: row.company,
        id: `sent:${row.applicationId}`,
        kind: "sent",
        source: null,
        stage: "applied",
        title: row.snapshotTitle ?? row.title,
      });
    }

    return items;
  }

  function stageItemsOf(userId: string, start: number, end: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        at: applicationEvents.at,
        closedReason: applications.closedReason,
        company: companies.name,
        eventId: applicationEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        source: applicationEvents.source,
        title: postings.title,
        toValue: applicationEvents.toValue,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(applicationEvents.userId, userId),
          eq(applicationEvents.kind, "stage"),
          inArray(applicationEvents.toValue, [...CALENDAR_STAGES]),
          gte(applicationEvents.at, start),
          lt(applicationEvents.at, end),
        ),
      )
      .all();

    const items: CalendarItemView[] = [];

    for (const row of rows) {
      const stage = calendarStageOf(row.toValue);

      if (stage === null) {
        continue;
      }

      items.push({
        applicationId: row.applicationId,
        at: row.at,
        closedReason: stage === "closed" ? row.closedReason : null,
        company: row.company,
        id: `stage:${row.eventId}`,
        kind: "stage",
        source: row.source,
        stage,
        title: row.snapshotTitle ?? row.title,
      });
    }

    return items;
  }

  function openCheckinItemsOf(userId: string, start: number, end: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        at: checkins.dueAt,
        company: companies.name,
        id: checkins.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: postings.title,
      })
      .from(checkins)
      .innerJoin(applications, eq(applications.id, checkins.applicationId))
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(checkins.userId, userId),
          eq(checkins.status, "open"),
          eq(applications.stage, "applied"),
          gte(checkins.dueAt, start),
          lt(checkins.dueAt, end),
        ),
      )
      .all();

    return rows.map(
      (row) =>
        ({
          applicationId: row.applicationId,
          at: row.at,
          closedReason: null,
          company: row.company,
          id: `checkin:${row.id}`,
          kind: "checkin",
          source: null,
          stage: "applied",
          title: row.snapshotTitle ?? row.title,
        }) satisfies CalendarItemView,
    );
  }

  function answeredCheckinItemsOf(userId: string, start: number, end: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        answer: applicationEvents.toValue,
        at: applicationEvents.at,
        company: companies.name,
        eventId: applicationEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        source: applicationEvents.source,
        title: postings.title,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(applicationEvents.userId, userId),
          eq(applicationEvents.kind, "checkin"),
          inArray(applicationEvents.toValue, [...CHECKIN_ANSWERS]),
          gte(applicationEvents.at, start),
          lt(applicationEvents.at, end),
        ),
      )
      .all();

    const items: CalendarItemView[] = [];

    for (const row of rows) {
      const answer = checkinAnswerOf(row.answer);

      if (answer === null) {
        continue;
      }

      items.push({
        applicationId: row.applicationId,
        at: row.at,
        closedReason: answer === "rejected" ? "rejected" : null,
        company: row.company,
        id: `checkin:${row.eventId}`,
        kind: "checkin",
        source: row.source,
        stage: STAGE_FOR_ANSWER[answer],
        title: row.snapshotTitle ?? row.title,
      });
    }

    return items;
  }

  function interviewItemsOf(userId: string, start: number, end: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        at: interviewEvents.startsAt,
        company: companies.name,
        eventId: interviewEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: postings.title,
      })
      .from(interviewEvents)
      .innerJoin(applications, eq(applications.id, interviewEvents.applicationId))
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(interviewEvents.userId, userId),
          gte(interviewEvents.startsAt, start),
          lt(interviewEvents.startsAt, end),
        ),
      )
      .all();

    return rows.map(
      (row) =>
        ({
          applicationId: row.applicationId,
          at: row.at,
          closedReason: null,
          company: row.company,
          id: `interview:${row.eventId}`,
          kind: "interview",
          source: "email",
          stage: null,
          title: row.snapshotTitle ?? row.title,
        }) satisfies CalendarItemView,
    );
  }

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

    if (end <= start) {
      return context.json({ error: "range_invalid" }, 400);
    }

    if (localDaysIn(start, end, timeZone) > CALENDAR_MAX_DAYS) {
      return context.json({ error: "range_too_wide" }, 400);
    }

    const items = [
      ...sentItemsOf(userId, start, end),
      ...stageItemsOf(userId, start, end),
      ...openCheckinItemsOf(userId, start, end),
      ...answeredCheckinItemsOf(userId, start, end),
      ...interviewItemsOf(userId, start, end),
    ];

    items.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));

    return context.json({ items, timeZone });
  });

  return routes;
}
