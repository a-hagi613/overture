import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createClock } from "../src/server/platform/ports/clock.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { DEFAULT_IMPORT_SOURCE, importTags } from "../src/server/catalog/tag-import.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    file: { type: "string" },
    source: { type: "string", default: DEFAULT_IMPORT_SOURCE },
  },
  strict: true,
});

const databasePath = args.values.db;
const filePath = args.values.file;

if (databasePath === undefined || filePath === undefined) {
  throw new Error("usage: bun run scripts/import-tags.ts --db <overture.db> --file <tags.jsonl>");
}

const content = readFileSync(filePath, "utf8");

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const clock = createClock();

const report = importTags(db, clock, {
  content,
  source: args.values.source,
  uploadedBy: "owner",
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
