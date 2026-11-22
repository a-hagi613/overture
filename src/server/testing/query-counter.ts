import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";

const MIGRATIONS = "drizzle";

/**
 * A migrated in-memory database whose every query is recorded, so a test can
 * prove a request stays a fixed number of statements as its rows grow.
 * @returns The database, its handle and the recorded queries.
 */
export function openCountingDatabase() {
  const queries: string[] = [];

  const opened = openDatabase(":memory:", {
    logger: {
      logQuery: (query) => {
        queries.push(query);
      },
    },
  });

  migrateDatabase(opened.db, MIGRATIONS);

  return {
    ...opened,
    counter: {
      count() {
        return queries.length;
      },
      queries() {
        return [...queries];
      },
      reset() {
        queries.length = 0;
      },
    },
  };
}
