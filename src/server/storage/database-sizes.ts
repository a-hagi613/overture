import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";

import { z } from "zod";

const checkpointSchema = z.object({
  busy: z.number().int(),
  checkpointed: z.number().int(),
  log: z.number().int(),
});

const pragmaRowSchema = z.record(z.string(), z.number().int().nonnegative());

/**
 * What one SQLite database file takes on disk and inside. `freeBytes` is the space a `VACUUM` gives back: pages
 * on the freelist multiplied by the page size.
 */
export interface DatabaseSizes {
  fileBytes: number;
  freeBytes: number;
  freelistCount: number;
  pageCount: number;
  pageSize: number;
  walBytes: number;
}

/** The result of truncating a database's write-ahead log. */
export interface CheckpointReport {
  afterWalBytes: number;
  beforeWalBytes: number;
  busy: number;
  checkpointed: number;
}

/** A refusal the operator can fix (missing `--confirm`, a held write lock, another connection in the way). */
export class VacuumRefusedError extends Error {
  override readonly name: string = "VacuumRefusedError";
}

/**
 * A live `wal_checkpoint(TRUNCATE)` on `app.sqlite` would race Litestream's replicator and can truncate the WAL out
 * from under it. Litestream checkpoints that file itself; compaction happens offline (`scripts/vacuum-app-db.ts`).
 */
export class LitestreamCheckpointRefusedError extends VacuumRefusedError {
  override readonly name: string = "LitestreamCheckpointRefusedError";
}

export interface CheckpointOptions {
  /** True for a file Litestream replicates; a live TRUNCATE is then refused. */
  readonly replicated?: boolean;
}

function statBytes(path: string) {
  return existsSync(path) ? statSync(path).size : 0;
}

function pragmaNumber(sqlite: Database, pragma: string) {
  const [value] = Object.values(pragmaRowSchema.parse(sqlite.query(`PRAGMA ${pragma}`).get()));

  if (value === undefined) {
    throw new VacuumRefusedError(`PRAGMA ${pragma} returned no row`);
  }

  return value;
}

/**
 * Reads the sizes of a database file without writing to it. The file and its `-wal` are measured on disk; the page
 * counts come from SQLite itself.
 * @param path The database file to inspect.
 * @param sqlite An open handle to that file.
 * @returns The file, WAL, page and freelist sizes.
 */
export function databaseSizesOf(path: string, sqlite: Database) {
  const pageSize = pragmaNumber(sqlite, "page_size");
  const pageCount = pragmaNumber(sqlite, "page_count");
  const freelistCount = pragmaNumber(sqlite, "freelist_count");

  const sizes: DatabaseSizes = {
    fileBytes: statBytes(path),
    freeBytes: freelistCount * pageSize,
    freelistCount,
    pageCount,
    pageSize,
    walBytes: statBytes(`${path}-wal`),
  };

  return sizes;
}

/**
 * Reads a database's sizes on a read-only handle that waits for a writer instead of failing at once. A missing file
 * is ordinary (the catalog is created on first use), so it reads as `null`.
 * @param path The database file to inspect.
 * @returns The sizes, or `null` when there is no file there.
 */
export function readDatabaseSizes(path: string) {
  if (!existsSync(path)) {
    return null;
  }

  const sqlite = new Database(path, { readonly: true, strict: true });

  try {
    sqlite.run("PRAGMA busy_timeout = 5000;");

    return databaseSizesOf(path, sqlite);
  } finally {
    sqlite.close();
  }
}

/**
 * Truncates a database's write-ahead log. It takes the ordinary write path, so a reader that keeps a transaction
 * open answers `busy: 1` and the log is left intact rather than the request failing.
 * @param path The database file whose WAL should be checkpointed.
 * @param options `replicated` refuses a live truncate on `app.sqlite`, which Litestream owns.
 * @returns The WAL bytes before and after, and SQLite's busy and checkpointed page counts.
 */
export function checkpointDatabase(path: string, options: CheckpointOptions = {}) {
  if (options.replicated === true) {
    throw new LitestreamCheckpointRefusedError(
      "app.sqlite is replicated by Litestream, which owns its WAL checkpointing; a live TRUNCATE checkpoint is refused. Compact the file offline with scripts/vacuum-app-db.ts.",
    );
  }

  const beforeWalBytes = statBytes(`${path}-wal`);
  const sqlite = new Database(path);

  try {
    sqlite.run("PRAGMA busy_timeout = 5000;");

    const result = checkpointSchema.parse(sqlite.query("PRAGMA wal_checkpoint(TRUNCATE);").get());

    const report: CheckpointReport = {
      afterWalBytes: statBytes(`${path}-wal`),
      beforeWalBytes,
      busy: result.busy,
      checkpointed: result.checkpointed,
    };

    return report;
  } finally {
    sqlite.close();
  }
}
