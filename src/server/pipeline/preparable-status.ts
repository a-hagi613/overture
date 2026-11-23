import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";

export const PREPARABLE_STATUSES = ["preparing", "needs_review", "ready"] as const;

/**
 * Writes a preparation outcome only while the Application is still preparable.
 * The check runs after awaited work, so the user may have approved, sent or
 * withdrawn it meanwhile; the update then matches no row instead of overwriting
 * that newer status.
 * @param db The application database.
 * @param applicationId The Application being prepared.
 * @param values The status fields to write.
 * @returns Whether the row was written.
 */
export function updatePreparableApplication(
  db: AppDatabase,
  applicationId: string,
  values: Partial<typeof applications.$inferInsert>,
) {
  return (
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
      .all().length > 0
  );
}
