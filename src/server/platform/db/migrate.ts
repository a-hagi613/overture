import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { z } from "zod";

import type { AppDatabase } from "./client.ts";

import { openDatabase } from "./client.ts";

const appliedCountSchema = z.object({ total: z.number() });

const appliedAtSchema = z.object({ at: z.number().nullable() });

const tableExistsSchema = z.object({ name: z.string() });

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/**
 * A table rebuild in a migration: Drizzle writes one as `CREATE __new_x`, `DROP TABLE x`, `RENAME TO x`. Those need
 * foreign keys off; everything else (add column, create index, backfill) is additive and safe with them on.
 */
const TABLE_REBUILD_SQL = /\b(?:drop\s+table|rename\s+to)\b/iu;

function hasMigrationsTable(client: AppDatabase["$client"]) {
  return tableExistsSchema.safeParse(
    client
      .query(
        "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get(),
  ).success;
}

function appliedMigrationCount(client: AppDatabase["$client"]) {
  if (!hasMigrationsTable(client)) {
    return 0;
  }

  return appliedCountSchema.parse(
    client.query("select count(*) as total from __drizzle_migrations").get(),
  ).total;
}

/**
 * The `when` of the last applied migration, which is what Drizzle compares a journal entry against to decide whether
 * it is pending.
 * @param client The SQLite client.
 * @returns The last applied journal millisecond, or 0 when nothing has been applied.
 */
function appliedMigrationAt(client: AppDatabase["$client"]) {
  if (!hasMigrationsTable(client)) {
    return 0;
  }

  return (
    appliedAtSchema.parse(
      client.query("select max(created_at) as at from __drizzle_migrations").get(),
    ).at ?? 0
  );
}

/**
 * Reads the SQL of every migration Drizzle would still apply. It returns `null` when the journal or a pending file
 * cannot be read, in which case the caller keeps the conservative path and lets `migrate()` report the real error.
 * @param migrationsFolder The Drizzle migrations folder.
 * @param appliedAt The last applied journal millisecond.
 * @returns The pending migration SQL, or `null` when it cannot be inspected.
 */
function pendingMigrationSql(migrationsFolder: string, appliedAt: number) {
  try {
    const journal = journalSchema.parse(
      JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")),
    );

    const pending: string[] = [];

    for (const entry of journal.entries) {
      if (entry.when > appliedAt) {
        pending.push(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8"));
      }
    }

    return pending;
  } catch {
    return null;
  }
}

/**
 * Whether the migrations still to apply rebuild a table, which is the only case that needs foreign keys off.
 * @param client The SQLite client.
 * @param migrationsFolder The Drizzle migrations folder.
 * @returns `true` when a pending migration drops or renames a table, or when the pending set cannot be inspected.
 */
function pendingMigrationsRebuildTables(client: AppDatabase["$client"], migrationsFolder: string) {
  const pending = pendingMigrationSql(migrationsFolder, appliedMigrationAt(client));

  if (pending === null) {
    return true;
  }

  return pending.some((sql) => TABLE_REBUILD_SQL.test(sql));
}

/**
 * Apply the Drizzle migrations.
 *
 * A migration that rebuilds a table runs `create, copy, drop, rename`, which only works with foreign keys off:
 * with them on, dropping a parent table runs the children's `ON DELETE cascade` actions and immutability triggers.
 * Only then does the batch turn them off and prove the rebuilt schema with `PRAGMA foreign_key_check` afterwards.
 * Purely additive migrations keep foreign keys on and skip the full-table check, so a large `catalog.sqlite` boot
 * no longer pays for a scan of every row in the file.
 * @param db The database to migrate.
 * @param migrationsFolder The Drizzle migrations folder.
 */
export function migrateDatabase(db: AppDatabase, migrationsFolder: string) {
  const client = db.$client;

  if (!pendingMigrationsRebuildTables(client, migrationsFolder)) {
    migrate(db, { migrationsFolder });

    return;
  }

  const applied = appliedMigrationCount(client);

  client.run("PRAGMA foreign_keys = OFF");

  try {
    migrate(db, { migrationsFolder });
  } finally {
    client.run("PRAGMA foreign_keys = ON");
  }

  if (appliedMigrationCount(client) === applied) {
    return;
  }

  const violations = client.query("PRAGMA foreign_key_check").all();

  if (violations.length > 0) {
    throw new Error(
      `migrations left ${String(violations.length)} foreign key violations; the rebuilt schema is inconsistent`,
    );
  }
}

/**
 * Apply the catalog's own migrations (ADR 0036). The catalog is a separate SQLite file with its own migration folder,
 * so a catalog reset can never touch the user data migrations.
 * @param db The catalog database to migrate.
 * @param migrationsFolder The Drizzle catalog migrations folder.
 */
export function migrateCatalogDatabase(db: AppDatabase, migrationsFolder: string) {
  migrateDatabase(db, migrationsFolder);
}

if (import.meta.main) {
  const { env } = await import("../../config/env.ts");
  const { db } = openDatabase(env.DATABASE_URL);

  migrateDatabase(db, "drizzle");
  process.stdout.write("migrations applied\n");
}
