import { eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { detectLanguage } from "../catalog/language.ts";
import { jobs } from "../platform/db/schema.ts";

/**
 * Detects the language of every stored job that predates the `jobs.language` column. The pull fills it for every
 * new or refreshed row; this one boot pass closes the gap so a Japanese posting stored before the fix does not keep
 * reaching English-only people until it is pulled again. Rows whose description is too short to decide stay null.
 * @param db The application database.
 * @returns How many rows received a language.
 */
export function backfillJobLanguages(db: AppDatabase) {
  const rows = db
    .select({ description: jobs.description, id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.language))
    .limit(5_000)
    .all();

  let updated = 0;

  for (const row of rows) {
    const language = detectLanguage(row.description ?? "");

    if (language === null) {
      continue;
    }

    db.update(jobs).set({ language }).where(eq(jobs.id, row.id)).run();
    updated += 1;
  }

  return updated;
}
