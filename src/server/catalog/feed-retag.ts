import { and, asc, gt, inArray, isNotNull, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { WRITE_BATCH_ROWS, yieldToEventLoop } from "../platform/db/batches.ts";
import { companyBoards, postings } from "../platform/db/schema.ts";

const FEED_ATS = ["lever", "ashby"] as const;

export async function resetFeedContentHashes(db: AppDatabase) {
  let boardsReset = 0;
  let postingsReset = 0;

  async function resetBoards(cursor: string | null) {
    const rows = db
      .select({ id: companyBoards.id })
      .from(companyBoards)
      .where(
        and(
          inArray(companyBoards.ats, [...FEED_ATS]),
          isNotNull(companyBoards.contentHash),
          cursor === null ? undefined : gt(companyBoards.id, cursor),
        ),
      )
      .orderBy(asc(companyBoards.id))
      .limit(WRITE_BATCH_ROWS)
      .all();

    if (rows.length === 0) {
      return;
    }

    const ids = rows.map((row) => row.id);

    db.update(companyBoards).set({ contentHash: null }).where(inArray(companyBoards.id, ids)).run();

    boardsReset += ids.length;

    await yieldToEventLoop();
    await resetBoards(ids.at(-1) ?? cursor);
  }

  async function resetOpenPostings(cursor: string | null) {
    const rows = db
      .select({ id: postings.id })
      .from(postings)
      .where(
        and(
          inArray(postings.ats, [...FEED_ATS]),
          isNull(postings.closedAt),
          isNotNull(postings.feedContentHash),
          cursor === null ? undefined : gt(postings.id, cursor),
        ),
      )
      .orderBy(asc(postings.id))
      .limit(WRITE_BATCH_ROWS)
      .all();

    if (rows.length === 0) {
      return;
    }

    const ids = rows.map((row) => row.id);

    db.update(postings).set({ feedContentHash: null }).where(inArray(postings.id, ids)).run();

    postingsReset += ids.length;

    await yieldToEventLoop();
    await resetOpenPostings(ids.at(-1) ?? cursor);
  }

  await resetBoards(null);
  await resetOpenPostings(null);

  return { boardsReset, postingsReset };
}
