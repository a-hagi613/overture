import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { z } from "zod";

import { createClock } from "../src/server/platform/ports/clock.ts";
import { openDatabase } from "../src/server/platform/db/client.ts";
import { migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { loadDiscoveredBoards } from "../src/server/catalog/discovered-boards.ts";
import {
  PINNED_COMPANIES_PARQUET_SHA256,
  PINNED_MANIFEST_SHA256,
  readCompaniesParquet,
} from "../src/server/catalog/companies-parquet.ts";

const manifestSchema = z.object({
  companies: z.object({
    parquet_sha256: z.string(),
    rows: z.number(),
  }),
});

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

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const manifestBytes = readFileSync(manifestPath);
const manifestHash = sha256(manifestBytes);

if (manifestHash !== PINNED_MANIFEST_SHA256) {
  throw new Error(
    `manifest sha256 pin mismatch: pinned ${PINNED_MANIFEST_SHA256}, actual ${manifestHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
  );
}

const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));

const parquetBytes = readFileSync(companiesPath);
const parquetHash = sha256(parquetBytes);

if (parquetHash !== PINNED_COMPANIES_PARQUET_SHA256) {
  throw new Error(
    `companies.parquet sha256 pin mismatch: pinned ${PINNED_COMPANIES_PARQUET_SHA256}, actual ${parquetHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
  );
}

if (manifest.companies.parquet_sha256 !== PINNED_COMPANIES_PARQUET_SHA256) {
  throw new Error(
    `manifest companies.parquet_sha256 ${manifest.companies.parquet_sha256} does not match the pin ${PINNED_COMPANIES_PARQUET_SHA256}`,
  );
}

const file = new ArrayBuffer(parquetBytes.byteLength);

new Uint8Array(file).set(parquetBytes);

const { rows, columns } = await readCompaniesParquet(file);

if (rows.length !== manifest.companies.rows) {
  throw new Error(
    `companies.parquet has ${String(rows.length)} rows, manifest declares ${String(manifest.companies.rows)}`,
  );
}

const { db } = openDatabase(databasePath);

migrateDatabase(db, "drizzle");

const clock = createClock();
const report = loadDiscoveredBoards(db, clock, rows);

process.stdout.write(`${JSON.stringify({ ...report, parquetColumns: columns }, null, 2)}\n`);
