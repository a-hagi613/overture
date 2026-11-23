import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { z } from "zod";

import type { DatabaseSizes } from "../src/server/storage/database-sizes.ts";

import { databaseSizesOf, VacuumRefusedError } from "../src/server/storage/database-sizes.ts";

export type { DatabaseSizes } from "../src/server/storage/database-sizes.ts";

export { databaseSizesOf, VacuumRefusedError } from "../src/server/storage/database-sizes.ts";

const checkpointSchema = z.object({
  busy: z.number().int(),
  checkpointed: z.number().int(),
  log: z.number().int(),
});

const integrityRowSchema = z.object({ integrity_check: z.string() });

/** The result of a maintenance pass, whether it only inspected or also vacuumed the file. */
export interface VacuumReport {
  after: DatabaseSizes | null;
  before: DatabaseSizes;
  dryRun: boolean;
  integrityCheck: string | null;
}

/**
 * Opens the read-only handle a dry run reads the sizes through. A busy timeout lets the read wait behind a live
 * checkpoint or writer instead of failing at once with `SQLITE_BUSY`.
 * @param path The database file to open, never for writing.
 * @returns The open handle; the caller closes it.
 */
export function openReadOnlyDatabase(path: string) {
  const sqlite = new Database(path, { readonly: true });

  sqlite.run("PRAGMA busy_timeout = 5000;");

  return sqlite;
}

function assertNoWriter(sqlite: Database) {
  sqlite.run("PRAGMA busy_timeout = 0;");

  try {
    sqlite.run("BEGIN IMMEDIATE;");
    sqlite.run("ROLLBACK;");
  } catch {
    throw new VacuumRefusedError(
      "another process holds the write lock; stop the server (or wait for it to go idle) and run again",
    );
  }
}

function checkpoint(sqlite: Database) {
  const result = checkpointSchema.parse(sqlite.query("PRAGMA wal_checkpoint(TRUNCATE);").get());

  if (result.busy !== 0) {
    throw new VacuumRefusedError(
      "the WAL checkpoint stayed busy; another connection is reading the database, so nothing was vacuumed",
    );
  }
}

function integrityCheck(sqlite: Database) {
  const rows = sqlite
    .query("PRAGMA integrity_check;")
    .all()
    .map((row) => integrityRowSchema.parse(row).integrity_check);

  return rows.length === 1 && rows[0] === "ok" ? "ok" : rows.join("; ");
}

/**
 * Compacts the application database: checkpoint the WAL, `VACUUM` the file, checkpoint again and verify integrity.
 * It never runs on startup; an operator runs it against an offline `/data/app.sqlite` after a deploy that left the
 * catalog split's free pages behind (issue #506).
 * @param path The application database file, normally `/data/app.sqlite`.
 * @param options `confirm` must be true to write; `dryRun` only reports the sizes.
 * @returns The sizes before (and after, unless dry-run) and the integrity result.
 */
export function vacuumAppDatabase(path: string, options: { confirm: boolean; dryRun?: boolean }) {
  if (!existsSync(path)) {
    throw new VacuumRefusedError(`no database at ${path}`);
  }

  const dryRun = options.dryRun ?? false;

  if (!dryRun && !options.confirm) {
    throw new VacuumRefusedError(
      "refusing to VACUUM without --confirm; run with --dry-run first to see the sizes",
    );
  }

  if (dryRun) {
    const readonly = openReadOnlyDatabase(path);

    try {
      const report: VacuumReport = {
        after: null,
        before: databaseSizesOf(path, readonly),
        dryRun: true,
        integrityCheck: null,
      };

      return report;
    } finally {
      readonly.close();
    }
  }

  const sqlite = new Database(path);

  try {
    assertNoWriter(sqlite);

    const before = databaseSizesOf(path, sqlite);

    checkpoint(sqlite);
    sqlite.run("VACUUM;");
    checkpoint(sqlite);

    const integrity = integrityCheck(sqlite);
    const after = databaseSizesOf(path, sqlite);

    if (after.freelistCount !== 0) {
      throw new VacuumRefusedError(
        `VACUUM left ${String(after.freelistCount)} free pages; the file was not compacted`,
      );
    }

    if (integrity !== "ok") {
      throw new VacuumRefusedError(`integrity_check failed after VACUUM: ${integrity}`);
    }

    const report: VacuumReport = { after, before, dryRun: false, integrityCheck: integrity };

    return report;
  } finally {
    sqlite.close();
  }
}

function megabytes(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function describe(label: string, sizes: DatabaseSizes) {
  return (
    `${label}: file ${megabytes(sizes.fileBytes)}, WAL ${megabytes(sizes.walBytes)}, ` +
    `pages ${String(sizes.pageCount)} x ${String(sizes.pageSize)} B, ` +
    `freelist ${String(sizes.freelistCount)} pages (${megabytes(sizes.freeBytes)} free)`
  );
}

function usage() {
  return [
    "Usage: bun run scripts/vacuum-app-db.ts <database> [--confirm] [--dry-run]",
    "",
    "Compacts an offline Overture application database (normally /data/app.sqlite):",
    "wal_checkpoint(TRUNCATE), VACUUM, wal_checkpoint(TRUNCATE), integrity_check.",
    "The database must be the DATABASE_PATH the server uses, and the server must be stopped.",
    "",
    "  --dry-run   print the sizes before and change nothing",
    "  --confirm   required to vacuum; without it the script refuses",
  ].join("\n");
}

function printReport(report: VacuumReport) {
  process.stdout.write(`${describe("before", report.before)}\n`);

  if (report.after !== null) {
    process.stdout.write(`${describe("after ", report.after)}\n`);
  }

  if (report.dryRun) {
    process.stdout.write("dry run: nothing was written\n");

    return;
  }

  process.stdout.write(`integrity_check: ${report.integrityCheck ?? "not run"}\n`);
  process.stdout.write(
    `reclaimed ${megabytes(report.before.fileBytes - (report.after?.fileBytes ?? 0))}\n`,
  );
}

function main(args: readonly string[]) {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);

    return;
  }

  const path = args.find((arg) => !arg.startsWith("--"));

  if (path === undefined) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;

    return;
  }

  try {
    printReport(
      vacuumAppDatabase(path, {
        confirm: args.includes("--confirm"),
        dryRun: args.includes("--dry-run"),
      }),
    );
  } catch (error) {
    if (!(error instanceof VacuumRefusedError)) {
      throw error;
    }

    process.stderr.write(`vacuum-app-db refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
