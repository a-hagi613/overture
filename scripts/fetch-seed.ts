import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  PINNED_COMPANIES_PARQUET_SHA256,
  SEED_COMPANIES_PARQUET_URL,
  SEED_MANIFEST_URL,
  sha256Hex,
  verifySeedFiles,
} from "../src/server/catalog/companies-parquet.ts";

const args = parseArgs({
  options: {
    dir: { type: "string" },
    "manifest-url": { type: "string" },
    "companies-url": { type: "string" },
  },
  strict: true,
});

const directory = args.values.dir;
const manifestUrl = args.values["manifest-url"] ?? SEED_MANIFEST_URL;
const companiesUrl = args.values["companies-url"] ?? SEED_COMPANIES_PARQUET_URL;

if (directory === undefined) {
  throw new Error("usage: bun run scripts/fetch-seed.ts --dir <seed-dir>");
}

async function download(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`downloading ${url} failed: HTTP ${String(response.status)}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

const manifestBytes = await download(manifestUrl);
const parquetBytes = await download(companiesUrl);

const { companiesRows } = verifySeedFiles(manifestBytes, parquetBytes);

mkdirSync(directory, { recursive: true });

writeFileSync(join(directory, "manifest.json"), manifestBytes);

writeFileSync(join(directory, "companies.parquet"), parquetBytes);

process.stdout.write(
  `${JSON.stringify(
    {
      directory,
      manifestSha256: sha256Hex(manifestBytes),
      companiesSha256: sha256Hex(parquetBytes),
      pinnedCompaniesSha256: PINNED_COMPANIES_PARQUET_SHA256,
      companiesRows,
    },
    null,
    2,
  )}\n`,
);
