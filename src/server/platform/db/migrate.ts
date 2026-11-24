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
