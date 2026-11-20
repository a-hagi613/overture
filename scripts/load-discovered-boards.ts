import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createClock } from "../src/server/platform/ports/clock.ts";
import { loadDiscoveredBoards } from "../src/server/catalog/discovered-boards.ts";
import { readCompaniesParquet, verifySeedFiles } from "../src/server/catalog/companies-parquet.ts";

const args = parseArgs({
  options: {
    db: { type: "string" },
    manifest: { type: "string" },
    companies: { type: "string" },
  },
  strict: true,
});

const databasePath = args.values.db;
const manifestPath = args.values.manifest;
const companiesPath = args.values.companies;

if (databasePath === undefined || manifestPath === undefined || companiesPath === undefined) {
  throw new Error(
    "usage: bun run scripts/load-discovered-boards.ts --db <overture.db> --manifest <manifest.json> --companies <companies.parquet>",
  );
}

const manifestBytes = new Uint8Array(readFileSync(manifestPath));
const parquetBytes = new Uint8Array(readFileSync(companiesPath));

const { companiesRows } = verifySeedFiles(manifestBytes, parquetBytes);

const file = new ArrayBuffer(parquetBytes.byteLength);

new Uint8Array(file).set(parquetBytes);

const { rows, columns } = await readCompaniesParquet(file);

if (rows.length !== companiesRows) {
  throw new Error(
    `companies.parquet has ${String(rows.length)} rows, manifest declares ${String(companiesRows)}`,
  );
}

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const clock = createClock();
const report = loadDiscoveredBoards(db, clock, rows);

process.stdout.write(`${JSON.stringify({ ...report, parquetColumns: columns }, null, 2)}\n`);
