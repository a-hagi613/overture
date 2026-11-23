import { and, asc, eq, gte, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { CalendarCustomEventKind } from "../../shared/calendar-events.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { calendarCustomEvents } from "../platform/db/schema.ts";

export interface CalendarCustomEventView {
  id: string;
  dayKey: string;
  kind: CalendarCustomEventKind;
  title: string;
  company: string;
  time: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CalendarCustomEventRange {
  from: string;
  to: string;
}

type CalendarCustomEventRow = typeof calendarCustomEvents.$inferSelect;

function viewOf(row: CalendarCustomEventRow) {
  return {
    company: row.company,
    createdAt: row.createdAt.getTime(),
    dayKey: row.dayKey,
    id: row.id,
    kind: row.kind,
    time: row.time,
    title: row.title,
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * The custom Calendar entries one person added, newest day last so the grid draws them in reading order.
 * `dayKey` is a local `YYYY-MM-DD`, so a string range is the same window the month grid shows.
 * @param db The application database.
 * @param userId The signed-in person whose entries these are.
 * @param range An inclusive `from`/`to` day window, or null for every entry.
 * @returns The entries in day and time order.
 */
export function listCalendarCustomEvents(
  db: AppDatabase,
  userId: string,
  range: CalendarCustomEventRange | null,
) {
  const rows = db
    .select()
    .from(calendarCustomEvents)
    .where(
      range === null
        ? eq(calendarCustomEvents.userId, userId)
        : and(
            eq(calendarCustomEvents.userId, userId),
            gte(calendarCustomEvents.dayKey, range.from),
            lte(calendarCustomEvents.dayKey, range.to),
          ),
    )
    .orderBy(
      asc(calendarCustomEvents.dayKey),
      asc(calendarCustomEvents.time),
      asc(calendarCustomEvents.id),
    )
    .all();

  return rows.map((row) => viewOf(row));
}

export interface NewCalendarCustomEvent {
  dayKey: string;
  kind: CalendarCustomEventKind;
  title: string;
  company: string;
  time: string | null;
}

/**
 * Adds one interview, follow-up or reminder to the person's own Calendar.
 * @param db The application database.
 * @param clock The clock the created and updated stamps come from.
 * @param userId The signed-in person the entry belongs to.
 * @param input The day, kind, title and optional time.
 * @returns The stored entry.
 */
export function createCalendarCustomEvent(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  input: NewCalendarCustomEvent,
) {
  const now = new Date(clock.now());

  const row = db
    .insert(calendarCustomEvents)
    .values({
      company: input.company,
      createdAt: now,
      dayKey: input.dayKey,
      id: randomUUID(),
      kind: input.kind,
      time: input.time,
      title: input.title,
      updatedAt: now,
      userId,
    })
    .returning()
    .all()
    .at(0);

  if (row === undefined) {
    throw new Error("The calendar event was not stored.");
  }

  return viewOf(row);
}

/**
 * Deletes one of the person's entries. The `userId` is part of the predicate, so an id that belongs to another
 * account is indistinguishable from a missing one.
 * @param db The application database.
 * @param userId The signed-in person.
 * @param id The entry id from the URL.
 * @returns True when this person's row was deleted, false when it did not exist for them.
 */
export function deleteCalendarCustomEvent(db: AppDatabase, userId: string, id: string) {
  const deleted = db
    .delete(calendarCustomEvents)
    .where(and(eq(calendarCustomEvents.id, id), eq(calendarCustomEvents.userId, userId)))
    .returning({ id: calendarCustomEvents.id })
    .all();

  return deleted.length > 0;
}
