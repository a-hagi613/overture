import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applicationEvents } from "../platform/db/schema.ts";

const detailSchema = z.record(z.string(), z.json());
const textSchema = z.string();

export type ApplicationEventDetail = z.infer<typeof detailSchema>;

export type ApplicationEventKind = "status" | "stage" | "email" | "checkin" | "note";

export type ApplicationEventSource = "system" | "user" | "email" | "checkin" | "admin";

export interface ApplicationEventInput {
  applicationId: string;
  userId: string;
  kind: ApplicationEventKind;
  fromValue: string | null;
  toValue: string | null;
  source: ApplicationEventSource;
  /**
   * The moment to stamp. One action that writes two events (a Stage move and the
   * Check-in answer that caused it) passes the same read so both share a time.
   * Defaults to a fresh clock read.
   */
  at?: number;
  /** Why the move happened. Stored in the event detail beside any structured extra fields. */
  reason?: string | null;
  /** The send attempt this event belongs to, when one was running. */
  attemptId?: string | null;
  /** Extra structured fields, merged with `reason` and `attemptId`. */
  detail?: ApplicationEventDetail | null;
}

export interface ApplicationTimelineEntry {
  id: string;
  applicationId: string;
  userId: string;
  at: number;
  kind: ApplicationEventKind;
  fromValue: string | null;
  toValue: string | null;
  source: ApplicationEventSource;
  reason: string | null;
  attemptId: string | null;
  detail: ApplicationEventDetail | null;
}

export function applicationEventDetail(input: {
  reason?: string | null | undefined;
  attemptId?: string | null | undefined;
  detail?: ApplicationEventDetail | null | undefined;
}) {
  const fields = { ...input.detail };

  if (input.reason !== undefined && input.reason !== null) {
    fields.reason = input.reason;
  }

  if (input.attemptId !== undefined && input.attemptId !== null) {
    fields.attemptId = input.attemptId;
  }

  return Object.keys(fields).length === 0 ? null : JSON.stringify(fields);
}

export function parseApplicationEventDetail(raw: string | null) {
  if (raw === null) {
    return null;
  }

  try {
    const parsed = detailSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : { text: raw };
  } catch {
    return { text: raw };
  }
}

function reasonOf(detail: ApplicationEventDetail | null) {
  const parsed = textSchema.safeParse(detail?.reason);

  return parsed.success ? parsed.data : null;
}

function attemptIdOf(detail: ApplicationEventDetail | null) {
  const parsed = textSchema.safeParse(detail?.attemptId);

  return parsed.success ? parsed.data : null;
}

/**
 * The human sentence to show for an event's detail. Structured details keep their
 * message; an old free-text detail is returned as it was written; a detail that
 * only carries a machine reason has no sentence of its own.
 * @param detail The parsed detail of one event, or null.
 * @returns The text to render, or null when the event has nothing to say.
 */
export function applicationEventText(detail: ApplicationEventDetail | null) {
  for (const field of ["message", "text"] as const) {
    const parsed = textSchema.safeParse(detail?.[field]);

    if (parsed.success) {
      return parsed.data;
    }
  }

  return null;
}

/**
 * Writes one structured Application event. Every stage change and every wait or
 * deferral goes through this one writer, so the timeline always carries the
 * reason and (when a send was running) the attempt id in `detail`.
 * @param db The application database or an open transaction.
 * @param clock The clock that stamps the event.
 * @param input The event's move, reason, attempt and structured detail.
 */
export function recordApplicationEvent(
  db: Pick<DatabaseWriter, "insert">,
  clock: Clock,
  input: ApplicationEventInput,
) {
  db.insert(applicationEvents)
    .values({
      applicationId: input.applicationId,
      at: input.at ?? clock.now(),
      detail: applicationEventDetail(input),
      fromValue: input.fromValue,
      id: crypto.randomUUID(),
      kind: input.kind,
      source: input.source,
      toValue: input.toValue,
      userId: input.userId,
    })
    .run();
}

export function readApplicationTimeline(db: AppDatabase, applicationId: string) {
  return db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(asc(applicationEvents.at), asc(applicationEvents.id))
    .all()
    .map((row) => {
      const detail = parseApplicationEventDetail(row.detail);

      return {
        applicationId: row.applicationId,
        at: row.at,
        attemptId: attemptIdOf(detail),
        detail,
        fromValue: row.fromValue,
        id: row.id,
        kind: row.kind,
        reason: reasonOf(detail),
        source: row.source,
        toValue: row.toValue,
        userId: row.userId,
      } satisfies ApplicationTimelineEntry;
    });
}

/** One timeline entry as the Application API returns it: a sentence, never raw JSON. */
export interface ApplicationTimelineRow {
  applicationId: string;
  at: number;
  attemptId: string | null;
  detail: string | null;
  fromValue: string | null;
  id: string;
  kind: ApplicationEventKind;
  reason: string | null;
  source: ApplicationEventSource;
  toValue: string | null;
  userId: string;
}

/**
 * The Application timeline in the shape the API and the Board render: the
 * machine reason and attempt id come out beside a plain sentence, so a
 * structured event never reaches a screen as a JSON blob.
 * @param db The application database.
 * @param applicationId The Application whose timeline is read.
 * @returns The timeline in time order, oldest first.
 */
export function readApplicationTimelineRows(db: AppDatabase, applicationId: string) {
  return readApplicationTimeline(db, applicationId).map(
    (entry) =>
      ({
        applicationId,
        at: entry.at,
        attemptId: entry.attemptId,
        detail: applicationEventText(entry.detail),
        fromValue: entry.fromValue,
        id: entry.id,
        kind: entry.kind,
        reason: entry.reason,
        source: entry.source,
        toValue: entry.toValue,
        userId: entry.userId,
      }) satisfies ApplicationTimelineRow,
  );
}
