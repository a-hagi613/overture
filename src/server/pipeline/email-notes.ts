import { and, asc, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applicationEvents } from "../platform/db/schema.ts";

/**
 * The latest email note for each of the given Applications. Only those
 * Applications are read, so a Board load does not load the person's whole email
 * history into memory.
 * @param db The database to read.
 * @param userId The person whose email events are read.
 * @param applicationIds The Applications on screen, whose notes are wanted.
 * @returns The newest note for each Application that has one.
 */
export function latestEmailNotesOf(
  db: AppDatabase,
  userId: string,
  applicationIds: readonly string[],
) {
  const notes = new Map<string, string>();

  if (applicationIds.length === 0) {
    return notes;
  }

  const rows = db
    .select({
      applicationId: applicationEvents.applicationId,
      detail: applicationEvents.detail,
      toValue: applicationEvents.toValue,
    })
    .from(applicationEvents)
    .where(
      and(
        eq(applicationEvents.userId, userId),
        eq(applicationEvents.kind, "email"),
        inArray(applicationEvents.applicationId, [...applicationIds]),
      ),
    )
    .orderBy(asc(applicationEvents.at))
    .all();

  for (const row of rows) {
    const note = row.toValue ?? row.detail;

    if (note !== null && note.trim() !== "") {
      notes.set(row.applicationId, note);
    }
  }

  return notes;
}
