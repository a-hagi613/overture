import { and, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import { postings } from "../platform/db/schema.ts";

export function resetFeedContentHashes(db: AppDatabase) {
  const rows = db
    .update(postings)
    .set({ feedContentHash: null })
    .where(and(inArray(postings.ats, ["lever", "ashby"]), isNull(postings.closedAt)))
    .returning({ id: postings.id })
    .all();

  return { postingsReset: rows.length };
}
