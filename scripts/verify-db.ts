import { readFileSync, rmSync } from "node:fs";

import { z } from "zod";

import { openCatalogDatabase, openDatabase } from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../src/server/platform/db/migrate.ts";

const journalSchema = z.object({ journal_mode: z.string() });
const synchronousSchema = z.object({ synchronous: z.number() });
const foreignKeysSchema = z.object({ foreign_keys: z.number() });
const tablesSchema = z.array(z.object({ name: z.string(), structure: z.string() }));

const path = "data/verify.db";
const catalogPath = "data/verify-catalog.db";

for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${path}${suffix}`, { force: true });
  rmSync(`${catalogPath}${suffix}`, { force: true });
}

const { db, sqlite } = openDatabase(path);
const catalog = openCatalogDatabase(catalogPath);

migrateDatabase(db, "drizzle");

migrateCatalogDatabase(catalog.db, "drizzle-catalog");

const journal = journalSchema.parse(sqlite.query("PRAGMA journal_mode").get());
const synchronous = synchronousSchema.parse(sqlite.query("PRAGMA synchronous").get());
const foreignKeys = foreignKeysSchema.parse(sqlite.query("PRAGMA foreign_keys").get());

const catalogJournal = journalSchema.parse(catalog.sqlite.query("PRAGMA journal_mode").get());

const catalogSynchronous = synchronousSchema.parse(
  catalog.sqlite.query("PRAGMA synchronous").get(),
);

const catalogForeignKeys = foreignKeysSchema.parse(
  catalog.sqlite.query("PRAGMA foreign_keys").get(),
);

function applicationTables() {
  return tablesSchema.parse(
    sqlite
      .query(
        "select name, sql as structure from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%'",
      )
      .all(),
  );
}

function catalogTables() {
  return tablesSchema.parse(
    catalog.sqlite
      .query(
        "select name, sql as structure from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle_%' and sql not like 'CREATE VIRTUAL TABLE%' and name not like 'postings_fts_%' and name not like 'geo_places_rtree_%'",
      )
      .all(),
  );
}

const tables = applicationTables();
const catalogTableRows = catalogTables();

const CATALOG_TABLE_NAMES = [
  "companies",
  "company_boards",
  "postings",
  "posting_tags",
  "posting_questions",
] as const;

const USER_TABLES_WITHOUT_CATALOG_FOREIGN_KEYS = [
  "applications",
  "matches",
  "posting_user_state",
  "skip_companies",
] as const;

const CATALOG_TABLES = new Set(["postings", "companies"]);

const foreignKeyListSchema = z.array(z.object({ table: z.string() }));

const failures: string[] = [];

const migrationJournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number(), tag: z.string(), when: z.number() })),
});

function checkJournal(file: string, label: string) {
  const migrationJournal = migrationJournalSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  for (const [position, entry] of migrationJournal.entries.entries()) {
    const previous = migrationJournal.entries[position - 1];

    if (previous !== undefined && entry.when <= previous.when) {
      failures.push(
        `${label} migration ${entry.tag} has when ${String(entry.when)}, not after ${previous.tag} (${String(previous.when)}); an existing database would skip it`,
      );
    }
  }
}

checkJournal("drizzle/meta/_journal.json", "application");

checkJournal("drizzle-catalog/meta/_journal.json", "catalog");

if (journal.journal_mode !== "wal") {
  failures.push(`journal_mode is ${journal.journal_mode}, expected wal`);
}

if (synchronous.synchronous !== 2) {
  failures.push(`synchronous is ${String(synchronous.synchronous)}, expected 2 (FULL)`);
}

if (foreignKeys.foreign_keys !== 1) {
  failures.push(`foreign_keys is ${String(foreignKeys.foreign_keys)}, expected 1`);
}

if (catalogJournal.journal_mode !== "wal") {
  failures.push(`catalog journal_mode is ${catalogJournal.journal_mode}, expected wal`);
}

if (catalogSynchronous.synchronous !== 1) {
  failures.push(
    `catalog synchronous is ${String(catalogSynchronous.synchronous)}, expected 1 (NORMAL)`,
  );
}

if (catalogForeignKeys.foreign_keys !== 1) {
  failures.push(`catalog foreign_keys is ${String(catalogForeignKeys.foreign_keys)}, expected 1`);
}

for (const table of [...tables, ...catalogTableRows]) {
  if (!table.structure.includes("STRICT")) {
    failures.push(`table ${table.name} is not STRICT`);
  }
}

const applicationTableNames = new Set(applicationTables().map((table) => table.name));

for (const name of CATALOG_TABLE_NAMES) {
  if (applicationTableNames.has(name)) {
    failures.push(`catalog table ${name} is still in app.sqlite; it belongs to catalog.sqlite`);
  }
}

const catalogTableNames = new Set(
  tablesSchema
    .parse(
      catalog.sqlite
        .query("select name, sql as structure from sqlite_master where type = 'table'")
        .all(),
    )
    .map((row) => row.name),
);

for (const name of CATALOG_TABLE_NAMES) {
  if (!catalogTableNames.has(name)) {
    failures.push(`catalog table ${name} is missing from catalog.sqlite`);
  }
}

if (!catalogTableNames.has("postings_fts")) {
  failures.push("the postings_fts search index is missing from catalog.sqlite");
}

for (const table of USER_TABLES_WITHOUT_CATALOG_FOREIGN_KEYS) {
  const keys = foreignKeyListSchema.parse(sqlite.query(`PRAGMA foreign_key_list(${table})`).all());

  for (const key of keys) {
    if (CATALOG_TABLES.has(key.table)) {
      failures.push(
        `${table} has a foreign key to the catalog table ${key.table}; catalog ids stay plain logical ids`,
      );
    }
  }
}

sqlite.close();

catalog.sqlite.close();

if (failures.length > 0) {
  throw new Error(`database verification failed: ${failures.join("; ")}`);
}

process.stdout.write(
  `database verified: app.sqlite wal, synchronous=FULL, ${String(tables.length)} STRICT tables; catalog.sqlite wal, synchronous=NORMAL, ${String(catalogTableRows.length)} STRICT tables\n`,
);
