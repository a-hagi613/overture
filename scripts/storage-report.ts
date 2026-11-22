import { parseArgs } from "node:util";

import type { ObjectStore } from "../src/server/platform/ports/object-store.ts";

import {
  catalogPathFor,
  openReadOnlyCatalogDatabase,
  openReadOnlyDatabase,
} from "../src/server/platform/db/client.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { createDiskObjectStore } from "../src/server/platform/ports/object-store.ts";
import { buildStorageReport } from "../src/server/storage/report.ts";

const args = parseArgs({
  options: {
    catalog: { type: "string" },
    db: { type: "string" },
    "objects-root": { type: "string" },
    tables: { type: "boolean", default: false },
  },
  strict: true,
});

const databasePath = args.values.db;

if (databasePath === undefined) {
  throw new Error(
    "usage: bun run scripts/storage-report.ts --db <overture.db> [--catalog <catalog.sqlite>] [--objects-root <dir>] [--tables]",
  );
}

const objectsRoot = args.values["objects-root"];

let objects: ObjectStore;
let backups: ObjectStore | null = null;

if (objectsRoot === undefined) {
  const configured = await import("../src/server/platform/object-store.ts");

  objects = configured.createConfiguredObjectStore();
  backups = configured.createConfiguredBackupStore();
} else {
  objects = createDiskObjectStore(objectsRoot);
}

const catalogPath = args.values.catalog ?? catalogPathFor(databasePath);
const { db, sqlite } = openReadOnlyDatabase(databasePath);
const { db: catalogDb, sqlite: catalogSqlite } = openReadOnlyCatalogDatabase(catalogPath);

try {
  const report = await buildStorageReport({
    backups,
    catalogDb,
    catalogPath,
    clock: createClock(),
    databasePath,
    db,
    includeTables: args.values.tables,
    objects,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  sqlite.close();
  catalogSqlite.close();
}
