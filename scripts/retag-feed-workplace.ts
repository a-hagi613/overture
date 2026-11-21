import { parseArgs } from "node:util";

import { resetFeedContentHashes } from "../src/server/catalog/feed-retag.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";

const args = parseArgs({ options: { db: { type: "string" } }, strict: true });

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error(
    "usage: bun run scripts/retag-feed-workplace.ts --db <overture.db> (clears Lever and Ashby content hashes in batches of 500; safe to re-run, the next sweep re-tags every open Lever and Ashby posting with its feed workplace)",
  );
}

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const report = await resetFeedContentHashes(db);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
