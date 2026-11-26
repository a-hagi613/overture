import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applications } from "../platform/db/schema.ts";
import { recordApplicationEvent } from "../applications/events.ts";

export const PREPARABLE_STATUSES = ["preparing", "needs_review", "ready"] as const;

export interface PreparableEvent {
  clock: Clock;
  reason: string;
}

/**
 * Writes a preparation outcome only while the Application is still preparable.
 * The check runs after awaited work, so the user may have approved, sent or
 * withdrawn it meanwhile; the update then matches no row instead of overwriting
 * that newer status. A written outcome also records the status and stage move
 * with its reason, so preparation never changes the board silently.
 * @param db The application database.
 * @param applicationId The Application being prepared.
 * @param values The status fields to write.
 * @param event The clock and reason to record when the write succeeds.
 * @returns Whether the row was written.
 */
export function updatePreparableApplication(
  db: AppDatabase,
  applicationId: string,
  values: Partial<typeof applications.$inferInsert>,
  event?: PreparableEvent,
) {
  const before = db
    .select({
      stage: applications.stage,
      status: applications.status,
      userId: applications.userId,
    })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .get();

  const changed =
    db
      .update(applications)
      .set(values)
      .where(
        and(
          eq(applications.id, applicationId),
          inArray(applications.status, [...PREPARABLE_STATUSES]),
        ),
      )
      .returning({ id: applications.id })
      .all().length > 0;

  if (!changed || event === undefined || before === undefined) {
    return changed;
  }

  if (values.status !== undefined && values.status !== before.status) {
    recordApplicationEvent(db, event.clock, {
      applicationId,
      fromValue: before.status,
      kind: "status",
      reason: event.reason,
      source: "system",
      toValue: values.status,
      userId: before.userId,
    });
  }

  if ("stage" in values && values.stage !== before.stage) {
    recordApplicationEvent(db, event.clock, {
      applicationId,
      fromValue: before.stage,
      kind: "stage",
      reason: event.reason,
      source: "system",
      toValue: values.stage ?? null,
      userId: before.userId,
    });
  }

  return changed;
}
