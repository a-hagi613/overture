import { and, inArray, isNotNull } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { postings } from "../platform/db/catalog-schema.ts";
import { applications } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { skipClosedPostingApplications } from "./posting-close.ts";

/**
 * The closed Postings that still have an unsent Application. A worker that crashed after closing a Posting never
 * delivered its ids, so each sweep reconciles from the catalog instead of trusting the summary alone.
 * @param db The application database.
 * @param catalogDb The catalog database.
 * @returns The closed Posting ids that still need their Applications skipped.
 */
export function closedPostingsWithUnsentApplications(db: AppDatabase, catalogDb: CatalogDatabase) {
  const rows = db
    .selectDistinct({ postingId: applications.postingId })
    .from(applications)
    .where(inArray(applications.status, ["ready", "approved"]))
    .all();

  if (rows.length === 0) {
    return [];
  }

  return catalogDb
    .select({ id: postings.id })
    .from(postings)
    .where(
      and(
        inArray(
          postings.id,
          rows.map((row) => row.postingId),
        ),
        isNotNull(postings.closedAt),
      ),
    )
    .all()
    .map((row) => row.id);
}

/**
 * Skips the unsent Applications whose Posting the catalog sweep closed (ADR 0036). The sweep writes only
 * `catalog.sqlite`; the closed posting ids travel back with its summary and are applied to `app.sqlite` here, in the
 * application process, with no cross-database transaction.
 * @param db The application database.
 * @param clock The clock that stamps the skipped Applications.
 * @param postingIds The Postings the sweep closed.
 * @returns How many Applications moved to `skipped`.
 */
export function applyClosedPostings(db: AppDatabase, clock: Clock, postingIds: readonly string[]) {
  if (postingIds.length === 0) {
    return 0;
  }

  const skipped = db.transaction((tx) =>
    skipClosedPostingApplications(tx, clock.now(), postingIds),
  );

  for (const application of skipped) {
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: application.applicationId, status: "skipped" }),
      application.userId,
    );
    publishEvent(
      db,
      clock,
      "home.updated",
      JSON.stringify({ applicationId: application.applicationId }),
      application.userId,
    );
  }

  return skipped.length;
}

/**
 * Applies both the ids a sweep reported and, as a safety net, any closed Posting an earlier crashed run left with an
 * unsent Application.
 * @param deps The application database, catalog database and clock.
 * @param reportedPostingIds The closed Posting ids carried by the sweep summary.
 * @returns How many Applications moved to `skipped`.
 */
export function reconcileClosedPostings(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase; clock: Clock },
  reportedPostingIds: readonly string[],
) {
  const reported = applyClosedPostings(deps.db, deps.clock, reportedPostingIds);

  const missed = applyClosedPostings(
    deps.db,
    deps.clock,
    closedPostingsWithUnsentApplications(deps.db, deps.catalogDb),
  );

  return reported + missed;
}
