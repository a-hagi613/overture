import { and, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import { companyBoards, postings } from "../platform/db/schema.ts";

export function resetFeedContentHashes(db: AppDatabase) {
  const boards = db
    .update(companyBoards)
    .set({ contentHash: null })
    .where(inArray(companyBoards.ats, ["lever", "ashby"]))
    .returning({ id: companyBoards.id })
    .all();

  const rows = db
    .update(postings)
    .set({ feedContentHash: null })
    .where(and(inArray(postings.ats, ["lever", "ashby"]), isNull(postings.closedAt)))
    .returning({ id: postings.id })
    .all();

  return { boardsReset: boards.length, postingsReset: rows.length };
}
