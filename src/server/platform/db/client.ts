import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type AppDatabase = ReturnType<typeof openDatabase>["db"];

export type DatabaseWriter = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

export interface QueryLogger {
  logQuery: (query: string, params: readonly unknown[]) => void;
}

/**
 * The two SQLite files one Overture process owns (ADR 0036). `db` is `app.sqlite`: every user, auth, billing,
 * application, inbox and job-queue row, `synchronous=FULL`, replicated by Litestream. `catalogDb` is
 * `catalog.sqlite`: the public job catalog, `synchronous=NORMAL`, rebuilt from feeds and never replicated.
 */
export interface Databases {
  readonly db: AppDatabase;
  readonly catalogDb: CatalogDatabase;
}

const catalogDatabaseBrand: unique symbol = Symbol("overture.catalog");

/**
 * A Drizzle handle on `catalog.sqlite`. It is branded so the compiler refuses an application handle where the catalog
 * belongs: the two files share no rows, and passing the wrong one is a runtime "no such table" otherwise.
 */
interface CatalogBrand {
  readonly [catalogDatabaseBrand]: "catalog";
}

export type CatalogDatabase = AppDatabase & CatalogBrand;

/**
 * The catalog file that belongs beside an application database (ADR 0036). A script that opens either path uses this
 * so it can never surprise a database by reading the catalog from somewhere else.
 * @param databasePath The application database path.
 * @returns `catalog.sqlite` beside it, or `:memory:` for an in-memory database.
 */
export function catalogPathFor(databasePath: string) {
  return databasePath === ":memory:" ? ":memory:" : join(dirname(databasePath), "catalog.sqlite");
}

function tuneWorkingMemory(sqlite: Database) {
  sqlite.run("PRAGMA temp_store = MEMORY;");
  sqlite.run("PRAGMA cache_size = -16384;");
  sqlite.run("PRAGMA journal_size_limit = 67108864;");
}

export function openDatabase(
  path: string,
  options: { logger?: QueryLogger; checkpointOwner?: "litestream" | "sqlite" } = {},
) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });

  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA synchronous = FULL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run("PRAGMA busy_timeout = 5000;");

  if (options.checkpointOwner === "litestream") {
    sqlite.run("PRAGMA wal_autocheckpoint = 0;");
  }

  tuneWorkingMemory(sqlite);

  const db = drizzle(sqlite, options.logger === undefined ? {} : { logger: options.logger });

  return { db, sqlite };
}

/**
 * Opens the catalog database (ADR 0036). It deliberately uses `synchronous=NORMAL`: a catalog row lost in a power
 * cut is rebuilt by the next feed sweep, while the full fsync on every write would turn the sweep's thousands of rows
 * into the slowest write lock on the volume. The file is excluded from `litestream.yml`.
 * @param path The catalog SQLite file, or `:memory:` in tests.
 * @param options An optional Drizzle query logger.
 * @returns The Drizzle handle and its SQLite connection.
 */
export function openCatalogDatabase(path: string, options: { logger?: QueryLogger } = {}) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });

  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA synchronous = NORMAL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run("PRAGMA busy_timeout = 5000;");
  tuneWorkingMemory(sqlite);

  const brand = { [catalogDatabaseBrand]: "catalog" } satisfies CatalogBrand;
  const raw = drizzle(sqlite, options.logger === undefined ? {} : { logger: options.logger });
  const db: CatalogDatabase = Object.assign(raw, brand);

  return { db, sqlite };
}

/**
 * Opens an existing database for reporting only. It never migrates, never
 * creates the file and never writes, so a report cannot change what it measures.
 * @param path an existing SQLite database file
 * @returns the Drizzle handle and its SQLite connection
 */
export function openReadOnlyDatabase(path: string) {
  const sqlite = new Database(path, { readonly: true });

  sqlite.run("PRAGMA busy_timeout = 5000;");

  const db = drizzle(sqlite);

  return { db, sqlite };
}

/**
 * Opens an existing catalog database for reporting only, with the catalog brand so a report cannot read it as the
 * application file.
 * @param path an existing catalog SQLite file
 * @returns the branded Drizzle handle and its SQLite connection
 */
export function openReadOnlyCatalogDatabase(path: string) {
  const { db, sqlite } = openReadOnlyDatabase(path);

  const brand = { [catalogDatabaseBrand]: "catalog" } satisfies CatalogBrand;

  return { db: Object.assign(db, brand), sqlite };
}
