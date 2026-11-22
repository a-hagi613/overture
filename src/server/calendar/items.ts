import { and, eq, gte, inArray, lt } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import type { CheckinAnswer } from "../../shared/checkins.ts";

import { CHECKIN_ANSWERS } from "../../shared/checkins.ts";
import {
  applications,
  applicationEvents,
  applicationSnapshots,
  checkins,
  interviewEvents,
} from "../platform/db/schema.ts";

const CALENDAR_STAGES = ["applied", "screening", "interviewing", "offer", "closed"] as const;

export type CalendarStage = (typeof CALENDAR_STAGES)[number];

export type CalendarKind = "sent" | "stage" | "checkin" | "interview";

export type CalendarSource = "system" | "user" | "email" | "checkin" | "admin";

export interface CalendarItemView {
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

/**
 * Every Sent Application, Stage move, Check-in and interview date that falls inside a window, for one user.
 * Carries only job, employer and Stage: no mail body and no answers. Shared by the Calendar API and the .ics feed.
 * @param db The database the rows are read from.
 * @param userId The user whose rows are read.
 * @param start Window start, epoch milliseconds (inclusive).
 * @param end Window end, epoch milliseconds (exclusive).
 * @returns The items in no particular order.
 */
export function calendarItemsOf(db: AppDatabase, userId: string, start: number, end: number) {
  function sentItemsOf() {
    const rows = db
      .select({
        applicationId: applications.id,
        at: applications.sentAt,
        company: applications.companyName,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: applications.postingTitle,
      })
      .from(applications)
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

  function stageItemsOf() {
    const rows = db
      .select({
        applicationId: applications.id,
        at: applicationEvents.at,
        closedReason: applications.closedReason,
        company: applications.companyName,
        eventId: applicationEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        source: applicationEvents.source,
        title: applications.postingTitle,
        toValue: applicationEvents.toValue,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
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

  function openCheckinItemsOf() {
    const rows = db
      .select({
        applicationId: applications.id,
        at: checkins.dueAt,
        company: applications.companyName,
        id: checkins.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: applications.postingTitle,
      })
      .from(checkins)
      .innerJoin(applications, eq(applications.id, checkins.applicationId))
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

  function answeredCheckinItemsOf() {
    const rows = db
      .select({
        applicationId: applications.id,
        answer: applicationEvents.toValue,
        at: applicationEvents.at,
        company: applications.companyName,
        eventId: applicationEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        source: applicationEvents.source,
        title: applications.postingTitle,
      })
      .from(applicationEvents)
      .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
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

  function interviewItemsOf() {
    const rows = db
      .select({
        applicationId: applications.id,
        at: interviewEvents.startsAt,
        company: applications.companyName,
        eventId: interviewEvents.id,
        snapshotTitle: applicationSnapshots.postingTitle,
        title: applications.postingTitle,
      })
      .from(interviewEvents)
      .innerJoin(applications, eq(applications.id, interviewEvents.applicationId))
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

  return [
    ...sentItemsOf(),
    ...stageItemsOf(),
    ...openCheckinItemsOf(),
    ...answeredCheckinItemsOf(),
    ...interviewItemsOf(),
  ];
}
