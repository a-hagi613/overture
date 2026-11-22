import { parseArgs } from "node:util";

import {
  catalogPathFor,
  openCatalogDatabase,
  openDatabase,
} from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { ensureBackfillQueued } from "../src/server/catalog/discovery.ts";
import { estimateBackfill } from "../src/server/catalog/backfill-estimate.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error("usage: bun run scripts/enqueue-backfill.ts --db <overture.db>");
}

const { db } = openDatabase(databasePath);
const { db: catalogDb } = openCatalogDatabase(catalogPathFor(databasePath));

migrateDatabase(db, "drizzle");

migrateCatalogDatabase(catalogDb, "drizzle-catalog");

const estimate = estimateBackfill(catalogDb);

const { jobId, enqueued } = ensureBackfillQueued(db, createClock());

process.stdout.write(
  `${JSON.stringify({ jobId, enqueued, backfillKind: "catalog.backfill", estimate }, null, 2)}\n`,
);
