import { defaultMetrics, recordMetricSafely } from "./metrics.ts";

export type SqliteDatabaseLabel = "app" | "catalog";

export type SqliteOperation = "delete" | "insert" | "pragma" | "select" | "update";

/**
 * Times one synchronous SQLite operation and records
 * `overture_sqlite_query_duration_ms{db,op}`. Callers name the bounded operation and database, so
 * no SQL text, parameter or identifier can become a label.
 * @param db Which file the operation reads or writes.
 * @param op The bounded operation name.
 * @param operation The synchronous work to time; its result is returned unchanged.
 * @param record Where to send the sample; defaults to the process metric set.
 * @returns Whatever the operation returned.
 */
export function measureSqliteQuery<Result>(
  db: SqliteDatabaseLabel,
  op: SqliteOperation,
  operation: () => Result,
  record: (input: { db: SqliteDatabaseLabel; durationMs: number; op: string }) => void = (
    input,
  ) => {
    recordMetricSafely(() => {
      defaultMetrics().recordSqliteQuery(input);
    });
  },
) {
  const startedAt = performance.now();

  try {
    return operation();
  } finally {
    record({ db, durationMs: performance.now() - startedAt, op });
  }
}
