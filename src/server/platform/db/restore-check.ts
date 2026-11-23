import { Database } from "bun:sqlite";
import { z } from "zod";

const jobQuery =
  "select id, kind, status, run_at, attempts, locked_until, updated_at from bg_jobs order by id";

const jobRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  run_at: z.number(),
  attempts: z.number(),
  locked_until: z.number().nullable(),
  updated_at: z.number(),
});

const jobRowsSchema = z.array(jobRowSchema);
const integrityRowsSchema = z.array(z.object({ integrity_check: z.string() }));
const countSchema = z.object({ n: z.number() });
const queryOnlySchema = z.object({ query_only: z.number() });
const tableNamesSchema = z.array(z.object({ name: z.string() }));

export type JobSnapshotRow = z.infer<typeof jobRowSchema>;

export type JobSnapshot = readonly JobSnapshotRow[];

export interface RestoreCheckOptions {
  /** Milliseconds since the Unix epoch, used only to report how many jobs were due to run. */
  readonly now: number;
  /** Migrations this build knows about; a restored database must hold every one of them. */
  readonly expectedMigrations?: number;
  /** Per-table row counts captured from the source database before replication. */
  readonly expectedRowCounts?: Readonly<Record<string, number>>;
}

export interface RestoreJobReport {
  readonly total: number;
  readonly due: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly unchanged: boolean;
}

export interface RestoreCheckReport {
  readonly path: string;
  readonly readOnly: boolean;
  readonly integrity: string;
  readonly migrations: number;
  readonly rowCount: Readonly<Record<string, number>>;
  readonly jobs: RestoreJobReport;
  readonly outboundCalls: readonly string[];
  readonly failures: readonly string[];
  readonly ok: boolean;
}

export class OutboundCallRefusedError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(
      `A restore drill must never reach the network; refused ${url}. Check the restored SQLite file only, with no schedulers, workers or senders running.`,
    );

    this.name = "OutboundCallRefusedError";
    this.url = url;
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof URL) {
    return input.href;
  }

  if (input instanceof Request) {
    return input.url;
  }

  return input;
}

export function createOutboundCallRefusal(original: typeof fetch) {
  const calls: string[] = [];

  const refuse = Object.assign(
    (input: RequestInfo | URL) => {
      const url = requestUrl(input);

      calls.push(url);

      throw new OutboundCallRefusedError(url);
    },
    { preconnect: original.preconnect.bind(original) },
  );

  return { calls, fetch: refuse };
}

function installOutboundCallGuard() {
  const original = globalThis.fetch;
  const created = createOutboundCallRefusal(original);

  globalThis.fetch = created.fetch;

  return {
    calls: created.calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function parseJobs(sqlite: Database) {
  return jobRowsSchema.parse(sqlite.query(jobQuery).all());
}

function parseJobsIfPresent(sqlite: Database) {
  const table = sqlite
    .query("select name from sqlite_master where type = 'table' and name = 'bg_jobs'")
    .get();

  return table === null ? [] : parseJobs(sqlite);
}

export function readJobSnapshot(path: string) {
  const sqlite = new Database(path, { readonly: true });

  sqlite.run("PRAGMA busy_timeout = 5000;");

  try {
    return parseJobsIfPresent(sqlite);
  } finally {
    sqlite.close();
  }
}

export function jobsUnchanged(before: JobSnapshot, after: JobSnapshot) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function integrityOf(sqlite: Database) {
  const rows = integrityRowsSchema.parse(sqlite.query("pragma integrity_check").all());

  return rows.map((row) => row.integrity_check).join("; ");
}

function migrationsOf(sqlite: Database) {
  try {
    return countSchema.parse(sqlite.query("select count(*) as n from __drizzle_migrations").get())
      .n;
  } catch {
    return null;
  }
}

export function countTableRows(sqlite: Database) {
  const tables = tableNamesSchema.parse(
    sqlite
      .query(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%'",
      )
      .all(),
  );

  const counts: Record<string, number> = {};

  for (const table of tables) {
    counts[table.name] = countSchema.parse(
      sqlite.query(`select count(*) as n from "${table.name.replaceAll('"', '""')}"`).get(),
    ).n;
  }

  return counts;
}

function jobReport(rows: JobSnapshot, unchanged: boolean, now: number) {
  const byStatus: Record<string, number> = {};
  let due = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

    if (row.status === "queued" && row.run_at <= now) {
      due += 1;
    }
  }

  return { total: rows.length, due, byStatus, unchanged };
}

function rowCountFailures(
  rowCount: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>> | undefined,
) {
  if (expected === undefined) {
    return [];
  }

  const failures: string[] = [];

  for (const [name, count] of Object.entries(expected)) {
    const actual = rowCount[name];

    if (actual === undefined) {
      failures.push(`table ${name} is missing from the restored database`);
    } else if (actual !== count) {
      failures.push(`table ${name} has ${String(actual)} restored rows, expected ${String(count)}`);
    }
  }

  return failures;
}

function inspect(
  sqlite: Database,
  path: string,
  options: RestoreCheckOptions,
  outboundCalls: readonly string[],
) {
  const failures: string[] = [];

  const readOnly = queryOnlySchema.parse(sqlite.query("pragma query_only").get()).query_only === 1;

  if (!readOnly) {
    failures.push("the restore check could write to the restored database");
  }

  let integrity: string;

  try {
    integrity = integrityOf(sqlite);
  } catch (error) {
    integrity = error instanceof Error ? error.message : String(error);
  }

  if (integrity !== "ok") {
    failures.push(`restored database integrity_check returned ${integrity}`);
  }

  const migrations = migrationsOf(sqlite);

  if (migrations === null || migrations === 0) {
    failures.push("restored database has no applied migrations");
  }

  if (options.expectedMigrations !== undefined && migrations !== options.expectedMigrations) {
    failures.push(
      `restored database has ${String(migrations ?? 0)} applied migrations, expected ${String(options.expectedMigrations)}`,
    );
  }

  const before = parseJobsIfPresent(sqlite);
  const rowCount = countTableRows(sqlite);
  const after = readJobSnapshot(path);
  const unchanged = jobsUnchanged(before, after);

  failures.push(...rowCountFailures(rowCount, options.expectedRowCounts));

  if (!unchanged) {
    failures.push(
      "bg_jobs changed during the restore check: a drill must not claim or mutate jobs",
    );
  }

  if (outboundCalls.length > 0) {
    failures.push(`the restore check reached the network: ${outboundCalls.join(", ")}`);
  }

  const report: RestoreCheckReport = {
    path,
    readOnly,
    integrity,
    migrations: migrations ?? 0,
    rowCount,
    jobs: jobReport(after, unchanged, options.now),
    outboundCalls: [...outboundCalls],
    failures,
    ok: failures.length === 0,
  };

  return report;
}

export function verifyRestoredDatabase(path: string, options: RestoreCheckOptions) {
  const guard = installOutboundCallGuard();

  try {
    const sqlite = new Database(path, { readonly: true });

    try {
      sqlite.run("pragma busy_timeout = 5000");
      sqlite.run("pragma query_only = on");

      return inspect(sqlite, path, options, guard.calls);
    } finally {
      sqlite.close();
    }
  } finally {
    guard.restore();
  }
}
