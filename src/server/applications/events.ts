import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applicationEvents } from "../platform/db/schema.ts";

const detailSchema = z.record(z.string(), z.unknown());

export type ApplicationEventKind = "status" | "stage" | "email" | "checkin" | "note";

export type ApplicationEventSource = "system" | "user" | "email" | "checkin" | "admin";

export interface ApplicationEventInput {
  applicationId: string;
  userId: string;
  kind: ApplicationEventKind;
  fromValue: string | null;
  toValue: string | null;
  source: ApplicationEventSource;
  /** Why the move happened. Stored in the event detail beside any structured extra fields. */
  reason?: string | null;
  /** The send attempt this event belongs to, when one was running. */
  attemptId?: string | null;
  /** Extra structured fields, merged with `reason` and `attemptId`. */
  detail?: Record<string, unknown> | null;
}

export interface ApplicationTimelineEntry {
  id: string;
  at: number;
  kind: ApplicationEventKind;
  fromValue: string | null;
  toValue: string | null;
  source: ApplicationEventSource;
  reason: string | null;
  attemptId: string | null;
  detail: Record<string, unknown> | null;
}

export function applicationEventDetail(input: {
  reason?: string | null | undefined;
  attemptId?: string | null | undefined;
  detail?: Record<string, unknown> | null | undefined;
}) {
  const fields: Record<string, unknown> = { ...(input.detail ?? {}) };

  if (input.reason !== undefined && input.reason !== null) {
    fields.reason = input.reason;
  }

  if (input.attemptId !== undefined && input.attemptId !== null) {
    fields.attemptId = input.attemptId;
  }

  return Object.keys(fields).length === 0 ? null : JSON.stringify(fields);
}

export function parseApplicationEventDetail(raw: string | null): Record<string, unknown> | null {
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

function reasonOf(detail: Record<string, unknown> | null) {
  const value = detail?.reason;

  return typeof value === "string" ? value : null;
}

function attemptIdOf(detail: Record<string, unknown> | null) {
  const value = detail?.attemptId;

  return typeof value === "string" ? value : null;
}

/**
 * Writes one structured Application event. Every stage change and every wait or
 * deferral goes through this one writer, so the timeline always carries the
 * reason and (when a send was running) the attempt id in `detail`.
 */
export function recordApplicationEvent(
  db: Pick<DatabaseWriter, "insert">,
  clock: Clock,
  input: ApplicationEventInput,
) {
  db.insert(applicationEvents)
    .values({
      applicationId: input.applicationId,
      at: clock.now(),
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
        at: row.at,
        attemptId: attemptIdOf(detail),
        detail,
        fromValue: row.fromValue,
        id: row.id,
        kind: row.kind,
        reason: reasonOf(detail),
        source: row.source,
        toValue: row.toValue,
      } satisfies ApplicationTimelineEntry;
    });
}
