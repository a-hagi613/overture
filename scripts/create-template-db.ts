import { rmSync } from "node:fs";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";

export function createTemplateDatabase(path: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }

  const { db, sqlite } = openDatabase(path);

  migrateDatabase(db, "drizzle");
  sqlite.close();
}

if (import.meta.main) {
  const path = process.argv[2] ?? "test/e2e/.tmp/template.db";

  createTemplateDatabase(path);
  process.stdout.write(`template database ready at ${path}\n`);
}
