import { eq, sql } from "drizzle-orm";

import { isPostingFlagged } from "../../shared/posting-flags.ts";
import type { PostingFlagReason } from "../../shared/posting-flags.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { catalogPostingFlags } from "../platform/db/schema.ts";

export interface PostingFlagRow {
  postingId: string;
  flagReason: PostingFlagReason;
  failCount: number;
}

/**
 * Record one runtime failure against a Posting (issue #576). A row is created on the first failure so `fail_count`
 * can reach the reason's threshold; the Posting is only excluded from candidate matching once it is at or over it.
 * @param db the application database, where runtime state lives
 * @param clock the clock the caller already reads
 * @param input the Posting that failed and why
 * @returns the accumulated failure count and whether the Posting is now flagged
 */
export function recordPostingFailure(
  db: AppDatabase,
  clock: Clock,
  input: { postingId: string; reason: PostingFlagReason },
) {
  const at = clock.now();

  db.insert(catalogPostingFlags)
    .values({
      postingId: input.postingId,
      flagReason: input.reason,
      failCount: 1,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: catalogPostingFlags.postingId,
      set: {
        flagReason: input.reason,
        failCount: sql`${catalogPostingFlags.failCount} + 1`,
        updatedAt: at,
      },
    })
    .run();

  const row = db
    .select({
      flagReason: catalogPostingFlags.flagReason,
      failCount: catalogPostingFlags.failCount,
    })
    .from(catalogPostingFlags)
    .where(eq(catalogPostingFlags.postingId, input.postingId))
    .get();

  const failCount = row?.failCount ?? 1;
  const flagged = isPostingFlagged(row?.flagReason ?? input.reason, failCount);

  return { failCount, flagged };
}

/**
 * The Postings candidate matching must skip because they are flagged at or over their reason's threshold.
 * @param db the application database
 * @returns the flagged Posting ids
 */
export function flaggedPostingIds(db: AppDatabase) {
  const rows = db
    .select({
      postingId: catalogPostingFlags.postingId,
      flagReason: catalogPostingFlags.flagReason,
      failCount: catalogPostingFlags.failCount,
    })
    .from(catalogPostingFlags)
    .all();

  return new Set(
    rows
      .filter((row) => isPostingFlagged(row.flagReason, row.failCount))
      .map((row) => row.postingId),
  );
}

/**
 * Whether one Posting is currently flagged out of candidate matching.
 * @param db the application database
 * @param postingId the catalog Posting id
 * @returns whether the Posting is flagged at or over its reason's threshold
 */
export function isPostingFlaggedForMatching(db: AppDatabase, postingId: string) {
  const row = db
    .select({
      flagReason: catalogPostingFlags.flagReason,
      failCount: catalogPostingFlags.failCount,
    })
    .from(catalogPostingFlags)
    .where(eq(catalogPostingFlags.postingId, postingId))
    .get();

  return row === undefined ? false : isPostingFlagged(row.flagReason, row.failCount);
}

/**
 * Clear a Posting's runtime flags, e.g. after an operator confirms the form works again.
 * @param db the application database
 * @param postingId the catalog Posting id
 */
export function clearPostingFlag(db: AppDatabase, postingId: string) {
  db.delete(catalogPostingFlags).where(eq(catalogPostingFlags.postingId, postingId)).run();
}
