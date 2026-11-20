import { parquetMetadata, parquetRead } from "hyparquet";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { DiscoveredScraperRow } from "./discovered-boards.ts";

export const SEED_MANIFEST_URL = "https://storage.stapply.ai/jobs/v1/manifest.json";

export const SEED_COMPANIES_PARQUET_URL = "https://storage.stapply.ai/jobs/v1/companies.parquet";

export const PINNED_MANIFEST_SHA256 =
  "cc6bc21396e64f6e93be77ffcdc37dba9b3a70892fcc53f8277559482f502b9b";

export const PINNED_COMPANIES_PARQUET_SHA256 =
  "dabf803a8849e4f07c9ddf38b027d7bdd7b68875d43121825415da08cedf736c";

const seedManifestSchema = z.object({
  companies: z.object({
    parquet_sha256: z.string(),
    rows: z.number().int().nonnegative(),
  }),
});

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifySeedFiles(manifestBytes: Uint8Array, parquetBytes: Uint8Array) {
  const manifestHash = sha256Hex(manifestBytes);

  if (manifestHash !== PINNED_MANIFEST_SHA256) {
    throw new Error(
      `manifest sha256 pin mismatch: pinned ${PINNED_MANIFEST_SHA256}, actual ${manifestHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
    );
  }

  const parquetHash = sha256Hex(parquetBytes);

  if (parquetHash !== PINNED_COMPANIES_PARQUET_SHA256) {
    throw new Error(
      `companies.parquet sha256 pin mismatch: pinned ${PINNED_COMPANIES_PARQUET_SHA256}, actual ${parquetHash}. Verify the upstream change is legitimate, then re-pin both hashes and rerun.`,
    );
  }

  const manifest = seedManifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));

  if (manifest.companies.parquet_sha256 !== PINNED_COMPANIES_PARQUET_SHA256) {
    throw new Error(
      `manifest companies.parquet_sha256 ${manifest.companies.parquet_sha256} does not match the pin ${PINNED_COMPANIES_PARQUET_SHA256}`,
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
