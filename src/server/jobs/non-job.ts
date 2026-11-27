import { sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import { NON_JOB_TITLE_PHRASES } from "../../shared/non-job.ts";

/**
 * The SQL form of {@link isNonJobTitle}: every phrase is matched against a lower-cased title, and a row is a non-job
 * when any phrase appears. The freehire reader and the retired catalog counts share it so both hide the same rows.
 * @param titleColumn The job's normalized title column.
 * @returns A condition that is true for real jobs.
 */
export function nonJobTitleCondition(titleColumn: AnySQLiteColumn) {
  const patterns = NON_JOB_TITLE_PHRASES.map(
    (phrase) => sql`instr(lower(${titleColumn}), ${phrase}) > 0`,
  );

  return sql`not (${sql.join(patterns, sql` or `)})`;
}
