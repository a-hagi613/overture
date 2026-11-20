import { rmSync } from "node:fs";

import { z } from "zod";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";

const journalSchema = z.object({ journal_mode: z.string() });
const synchronousSchema = z.object({ synchronous: z.number() });
const foreignKeysSchema = z.object({ foreign_keys: z.number() });
const tablesSchema = z.array(z.object({ name: z.string(), structure: z.string() }));

const path = "data/verify.db";

for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${path}${suffix}`, { force: true });
}

const { db, sqlite } = openDatabase(path);

migrateDatabase(db, "drizzle");

const journal = journalSchema.parse(sqlite.query("PRAGMA journal_mode").get());
const synchronous = synchronousSchema.parse(sqlite.query("PRAGMA synchronous").get());
const foreignKeys = foreignKeysSchema.parse(sqlite.query("PRAGMA foreign_keys").get());

const tables = tablesSchema.parse(
  sqlite
    .query(
      "select name, sql as structure from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%' and sql not like 'CREATE VIRTUAL TABLE%' and name not like 'postings_fts_%'",
    )
    .all(),
);

const failures: string[] = [];

if (journal.journal_mode !== "wal") {
  failures.push(`journal_mode is ${journal.journal_mode}, expected wal`);
}

if (synchronous.synchronous !== 2) {
  failures.push(`synchronous is ${String(synchronous.synchronous)}, expected 2 (FULL)`);
}

if (foreignKeys.foreign_keys !== 1) {
  failures.push(`foreign_keys is ${String(foreignKeys.foreign_keys)}, expected 1`);
}

for (const table of tables) {
  if (!table.structure.includes("STRICT")) {
    failures.push(`table ${table.name} is not STRICT`);
  }
}

sqlite.close();

if (failures.length > 0) {
  throw new Error(`database verification failed: ${failures.join("; ")}`);
}

process.stdout.write(
  `database verified: wal, synchronous=FULL, foreign_keys=ON, ${String(tables.length)} STRICT tables\n`,
);
