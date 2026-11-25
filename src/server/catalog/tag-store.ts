import { and, eq } from "drizzle-orm";

import type { DatabaseWriter } from "../platform/db/client.ts";
import { postings, postingTags } from "../platform/db/catalog-schema.ts";

import type { PostingTags, SalaryPeriod, TagSource } from "../../shared/tag-taxonomy.ts";

import { TAG_SOURCE_PRECEDENCE } from "../../shared/tag-taxonomy.ts";
import { committedRoleLabels, retagPosting } from "./taxonomy-tags.ts";

interface StoredTagRow {
  dimension: "role" | "subrole" | "seniority";
  value: string;
}

interface TagWrite extends StoredTagRow {
  source: TagSource;
}

export function salaryPeriodForColumn(period: SalaryPeriod | null) {
  if (period === "week" || period === "day") {
    return null;
  }

  return period;
}

/**
 * Writes a Posting's tags, keeping a stronger source's tag over a weaker one, then retags the Posting in the role
 * taxonomy (issue #660): a writer that still speaks the retired labels (the board poll's title rules) never leaves an
 * old label for matching to miss, and a title the rules could not place still gets its AI label, so it never waits on
 * the paid fallback.
 * @param db The catalog database or an open transaction on it.
 * @param postingId The Posting.
 * @param writes The tags to write.
 * @param now The clock reading stored as `taggedAt`.
 */
export function writePostingTags(
  db: DatabaseWriter,
  postingId: string,
  writes: readonly TagWrite[],
  now: number,
) {
  for (const write of writes) {
    const existing = db
      .select()
      .from(postingTags)
      .where(and(eq(postingTags.postingId, postingId), eq(postingTags.dimension, write.dimension)))
      .all();

    const strongerExists = existing.some(
      (row) => TAG_SOURCE_PRECEDENCE[row.source] > TAG_SOURCE_PRECEDENCE[write.source],
    );

    if (strongerExists) {
      continue;
    }

    db.delete(postingTags)
      .where(and(eq(postingTags.postingId, postingId), eq(postingTags.dimension, write.dimension)))
      .run();

    db.insert(postingTags)
      .values({ postingId, dimension: write.dimension, value: write.value, source: write.source })
      .onConflictDoNothing()
      .run();
  }

  retagPosting(db, postingId, committedRoleLabels());

  const rows = db.select().from(postingTags).where(eq(postingTags.postingId, postingId)).all();

  if (rows.length === 0) {
    return;
  }

  let tagSource: TagSource = "llm";

  for (const row of rows) {
    if (TAG_SOURCE_PRECEDENCE[row.source] > TAG_SOURCE_PRECEDENCE[tagSource]) {
      tagSource = row.source;
    }
  }

  db.update(postings).set({ tagSource, taggedAt: now }).where(eq(postings.id, postingId)).run();
}

export function rowsForTags(tags: PostingTags) {
  const rows: StoredTagRow[] = [];

  if (tags.role !== null) {
    rows.push({ dimension: "role", value: tags.role });
  }

  if (tags.subrole !== null) {
    rows.push({ dimension: "subrole", value: tags.subrole });
  }

  if (tags.seniority !== null) {
    rows.push({ dimension: "seniority", value: tags.seniority });
  }

  return rows;
}

export function storePostingTags(
  db: DatabaseWriter,
  postingId: string,
  tags: PostingTags,
  now: number,
) {
  const source: TagSource = tags.roleSource === "model" ? "model" : "rules";

  const writes: TagWrite[] = [];

  for (const row of rowsForTags(tags)) {
    writes.push({ dimension: row.dimension, value: row.value, source });
  }

  writePostingTags(db, postingId, writes, now);
}
