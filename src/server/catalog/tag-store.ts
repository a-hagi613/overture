import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import { postingTags } from "../platform/db/schema.ts";

import type { PostingTags, SalaryPeriod } from "../../shared/tag-taxonomy.ts";

interface StoredTagRow {
  dimension: "role" | "subrole" | "seniority";
  value: string;
}

export function salaryPeriodForColumn(period: SalaryPeriod | null) {
  if (period === "week" || period === "day") {
    return null;
  }

  return period;
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

export function storePostingTags(db: AppDatabase, postingId: string, tags: PostingTags) {
  db.delete(postingTags).where(eq(postingTags.postingId, postingId)).run();

  const rows = rowsForTags(tags);

  if (rows.length === 0) {
    return;
  }

  const source = tags.roleSource === "model" ? ("model" as const) : ("rules" as const);

  db.insert(postingTags)
    .values(rows.map((row) => ({ postingId, dimension: row.dimension, value: row.value, source })))
    .onConflictDoNothing()
    .run();
}
