import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseWriter } from "../platform/db/client.ts";

import { applicationEvents, applications } from "../platform/db/schema.ts";
import { failedReasonText } from "../../shared/copy.ts";

export const POSTING_CLOSED_REASON = "posting_closed";

const POSTING_CHUNK = 200;

export interface SkippedApplication {
  applicationId: string;
  userId: string;
}

export function skipClosedPostingApplications(
  db: DatabaseWriter,
  at: number,
  postingIds: readonly string[],
) {
  const detail = failedReasonText(POSTING_CLOSED_REASON) ?? null;
  const skipped: SkippedApplication[] = [];

  for (let offset = 0; offset < postingIds.length; offset += POSTING_CHUNK) {
    const chunk = postingIds.slice(offset, offset + POSTING_CHUNK);

    const rows = db
      .select({
        id: applications.id,
        status: applications.status,
        userId: applications.userId,
      })
      .from(applications)
      .where(
        and(
          inArray(applications.postingId, chunk),
          inArray(applications.status, ["ready", "approved"]),
        ),
      )
      .all();

    for (const row of rows) {
      const updated = db
        .update(applications)
        .set({
          status: "skipped",
          statusReason: POSTING_CLOSED_REASON,
          stage: null,
          updatedAt: at,
        })
        .where(and(eq(applications.id, row.id), eq(applications.status, row.status)))
        .returning({ id: applications.id })
        .all();

      if (updated.length === 0) {
        continue;
      }

      db.insert(applicationEvents)
        .values({
          applicationId: row.id,
          at,
          detail,
          fromValue: row.status,
          id: crypto.randomUUID(),
          kind: "status",
          source: "system",
          toValue: "skipped",
          userId: row.userId,
        })
        .run();

      skipped.push({ applicationId: row.id, userId: row.userId });
    }
  }

  return skipped;
}
