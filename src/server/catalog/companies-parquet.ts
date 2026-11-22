import { parquetMetadata, parquetRead } from "hyparquet";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { DiscoveredScraperRow } from "./discovered-boards.ts";

export const SEED_MANIFEST_URL = "https://storage.stapply.ai/jobs/v1/manifest.json";

export const SEED_COMPANIES_PARQUET_URL = "https://storage.stapply.ai/jobs/v1/companies.parquet";

export const PINNED_MANIFEST_SHA256 =
  "07d04361d9edef28803be1cb3b389bea4f364e328dae82340b9e08020c752104";

export const PINNED_COMPANIES_PARQUET_SHA256 =
  "8936af47841d95c1f8ae55cd527302c64fa592d79f1fe2ee347c7d997635b2fb";

export interface SeedPins {
  manifestSha256: string;
  companiesParquetSha256: string;
}

export const DEFAULT_SEED_PINS: SeedPins = {
  manifestSha256: PINNED_MANIFEST_SHA256,
  companiesParquetSha256: PINNED_COMPANIES_PARQUET_SHA256,
};

const seedManifestSchema = z.object({
  companies: z.object({
    parquet_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u, "expected a 64-character lowercase hex sha256"),
    rows: z.number().int().nonnegative(),
  }),
});

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifySeedFiles(
  manifestBytes: Uint8Array,
  parquetBytes: Uint8Array,
  pins: SeedPins = DEFAULT_SEED_PINS,
) {
  const manifestHash = sha256Hex(manifestBytes);

  if (manifestHash !== pins.manifestSha256) {
    throw new Error(
      `manifest sha256 pin mismatch: pinned ${pins.manifestSha256}, actual ${manifestHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
    );
  }

  const parquetHash = sha256Hex(parquetBytes);

  if (parquetHash !== pins.companiesParquetSha256) {
    throw new Error(
      `companies.parquet sha256 pin mismatch: pinned ${pins.companiesParquetSha256}, actual ${parquetHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
    );
  }

  const manifest = seedManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));

  if (manifest.companies.parquet_sha256 !== pins.companiesParquetSha256) {
    throw new Error(
      `manifest companies.parquet_sha256 ${manifest.companies.parquet_sha256} does not match the pin ${pins.companiesParquetSha256}`,
    );
  }

  return { companiesRows: manifest.companies.rows };
}

const PARQUET_COLUMNS = ["ats", "name", "slug", "url"] as const;

const parquetRowSchema = z.tuple([z.string(), z.string(), z.string(), z.string()]);

interface CompaniesParquetMetadata {
  columns: string[];
  numRows: number;
}

function readMetadata(file: ArrayBuffer) {
  const metadata = parquetMetadata(file);
  const columns = metadata.schema.map((field) => field.name).filter((name) => name !== "schema");

  if (columns.join(",") !== PARQUET_COLUMNS.join(",")) {
    throw new Error(
      `companies.parquet schema changed: columns are [${columns.join(", ")}], expected [${PARQUET_COLUMNS.join(", ")}]. Verify the upstream change is deliberate, then re-read the pins and mapping.`,
    );
  }

  const summary: CompaniesParquetMetadata = { columns, numRows: Number(metadata.num_rows) };

  return summary;
}

export async function readCompaniesParquet(file: ArrayBuffer) {
  const { columns, numRows } = readMetadata(file);
  const rows: DiscoveredScraperRow[] = [];

  await parquetRead({
    file,
    onComplete(records) {
      for (const record of records) {
        if (!Array.isArray(record) || record.length !== PARQUET_COLUMNS.length) {
          throw new Error(
            `companies.parquet row ${String(rows.length)} is not a ${String(PARQUET_COLUMNS.length)}-column record`,
          );
        }

        const parsed = parquetRowSchema.safeParse(record);

        if (!parsed.success) {
          throw new TypeError(
            `companies.parquet row ${String(rows.length)} does not match (ats, name, slug, url) as strings`,
          );
        }

        const [ats, name, slug, url] = parsed.data;

        rows.push({ ats, name, slug, url });
      }
    },
  });

  if (rows.length !== numRows) {
    throw new Error(
      `companies.parquet read ${String(rows.length)} rows, the file metadata declares ${String(numRows)}`,
    );
  }

  return { rows, columns };
}
