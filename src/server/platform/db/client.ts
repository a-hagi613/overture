import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AppDatabase = ReturnType<typeof openDatabase>["db"];

export type DatabaseWriter = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

export interface QueryLogger {
  logQuery: (query: string, params: readonly unknown[]) => void;
}

export function openDatabase(path: string, options: { logger?: QueryLogger } = {}) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const sqlite = new Database(path, { create: true });

  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA synchronous = FULL;");
  sqlite.run("PRAGMA foreign_keys = ON;");
  sqlite.run("PRAGMA busy_timeout = 5000;");

  const db = drizzle(sqlite, options.logger === undefined ? {} : { logger: options.logger });

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
