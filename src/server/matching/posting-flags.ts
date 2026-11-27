import { eq, sql } from "drizzle-orm";

import { isPostingFlagged } from "../../shared/posting-flags.ts";
import type { PostingFlagReason } from "../../shared/posting-flags.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { catalogPostingFlags } from "../platform/db/schema.ts";

const FLAG_COLUMNS = {
  failCount: catalogPostingFlags.failCount,
  flagReason: catalogPostingFlags.flagReason,
};

function flagRow(db: AppDatabase, postingId: string) {
  return db
    .select(FLAG_COLUMNS)
    .from(catalogPostingFlags)
    .where(eq(catalogPostingFlags.postingId, postingId))
    .get();
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

  const row = flagRow(db, input.postingId);
  const failCount = row?.failCount ?? 1;

  return {
    failCount,
    flagged: isPostingFlagged(row?.flagReason ?? input.reason, failCount),
  };
}

/**
 * The Postings candidate matching must skip because they are flagged at or over their reason's threshold.
 * @param db the application database
 * @returns the flagged Posting ids
 */
export function flaggedPostingIds(db: AppDatabase) {
  const rows = db
    .select({ postingId: catalogPostingFlags.postingId, ...FLAG_COLUMNS })
    .from(catalogPostingFlags)
    .all();

  return new Set(
    rows
      .filter((row) => isPostingFlagged(row.flagReason, row.failCount))
      .map((row) => row.postingId),
  );
}

/**
 * Clear a Posting's runtime flags, e.g. after an operator confirms the form works again.
 * @param db the application database
 * @param postingId the catalog Posting id
 */
export function clearPostingFlag(db: AppDatabase, postingId: string) {
  db.delete(catalogPostingFlags).where(eq(catalogPostingFlags.postingId, postingId)).run();
}
