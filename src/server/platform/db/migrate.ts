import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import type { AppDatabase } from "./client.ts";

import { openDatabase } from "./client.ts";

export function migrateDatabase(db: AppDatabase, migrationsFolder: string) {
  migrate(db, { migrationsFolder });
}

if (import.meta.main) {
  const { env } = await import("../../config/env.ts");
  const { db } = openDatabase(env.DATABASE_URL);

  migrateDatabase(db, "drizzle");
  process.stdout.write("migrations applied\n");
}
