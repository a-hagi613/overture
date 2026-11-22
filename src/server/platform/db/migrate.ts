import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { z } from "zod";

import type { AppDatabase } from "./client.ts";

import { openDatabase } from "./client.ts";

const appliedCountSchema = z.object({ total: z.number() });

const tableExistsSchema = z.object({ name: z.string() });

function appliedMigrationCount(client: AppDatabase["$client"]) {
  const exists = tableExistsSchema.safeParse(
    client
      .query(
        "select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'",
      )
      .get(),
  );

  if (!exists.success) {
    return 0;
  }

  return appliedCountSchema.parse(
    client.query("select count(*) as total from __drizzle_migrations").get(),
  ).total;
}

/**
 * Apply the Drizzle migrations. Foreign keys are off for the batch because SQLite only runs the table-rebuild
 * procedure the migrations use (create, copy, drop, rename) with them off: with foreign keys on, dropping a parent
 * table runs the children's `ON DELETE cascade` actions and immutability triggers. After a batch that applied
 * anything, `PRAGMA foreign_key_check` proves the rebuilt schema is consistent, and the connection turns foreign
 * keys back on.
 * @param db The database to migrate.
 * @param migrationsFolder The Drizzle migrations folder.
 */
export function migrateDatabase(db: AppDatabase, migrationsFolder: string) {
  const client = db.$client;
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

if (import.meta.main) {
  const { env } = await import("../../config/env.ts");
  const { db } = openDatabase(env.DATABASE_URL);

  migrateDatabase(db, "drizzle");
  process.stdout.write("migrations applied\n");
}
