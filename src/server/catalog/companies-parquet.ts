import { parquetMetadata, parquetRead } from "hyparquet";
import { z } from "zod";

import type { DiscoveredScraperRow } from "./discovered-boards.ts";

export const PINNED_MANIFEST_SHA256 =
  "cc6bc21396e64f6e93be77ffcdc37dba9b3a70892fcc53f8277559482f502b9b";

export const PINNED_COMPANIES_PARQUET_SHA256 =
  "dabf803a8849e4f07c9ddf38b027d7bdd7b68875d43121825415da08cedf736c";

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
