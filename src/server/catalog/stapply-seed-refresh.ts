import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { readCompaniesParquet, sha256Hex } from "./companies-parquet.ts";

export const STAPPLY_SEED_ROW_DROP_SHARE = 0.2;

export const STAPPLY_SEED_MANIFEST_FILE = "manifest.json";

export const STAPPLY_SEED_COMPANIES_FILE = "companies.parquet";

const manifestSchema = z.object({
  version: z.string().min(1),
  generated_at: z.string().min(1),
  companies: z.object({
    parquet_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    parquet_size_bytes: z.number().int().nonnegative().optional(),
    rows: z.number().int().nonnegative(),
  }),
});

const previousManifestSchema = z.object({
  companies: z.object({ rows: z.number().int().nonnegative() }),
});

export type StapplySeedRefreshReason =
  | "row_drop"
  | "schema"
  | "sha256_mismatch"
  | "upstream_unavailable"
  | "write_failed";

export interface StapplySeedRefreshErrorDetails {
  manifestSha256?: string;
  companiesParquetSha256?: string;
  rows?: number;
  previousRows?: number | null;
}

export class StapplySeedRefreshError extends Error {
  readonly reason: StapplySeedRefreshReason;
  readonly details: StapplySeedRefreshErrorDetails;

  constructor(
    reason: StapplySeedRefreshReason,
    message: string,
    details: StapplySeedRefreshErrorDetails = {},
  ) {
    super(message);

    this.name = "StapplySeedRefreshError";
    this.reason = reason;
    this.details = details;
  }
}

export interface StapplySeedRefreshInput {
  manifestBytes: Uint8Array;
  companiesBytes: Uint8Array;
  outDir: string;
  allowRowDrop: boolean;
}

export interface StapplySeedRefreshSummary {
  outcome: "aborted" | "unchanged" | "written";
  reason: StapplySeedRefreshReason | null;
  message: string | null;
  outDir: string;
  manifestSha256: string | null;
  companiesParquetSha256: string | null;
  rows: number | null;
  previousRows: number | null;
  rowDropShare: number;
  allowedRowDrop: boolean;
}

export interface StapplySeedRefreshAbort {
  outDir: string;
  allowRowDrop: boolean;
  reason: StapplySeedRefreshReason;
  message: string;
  details?: StapplySeedRefreshErrorDetails;
}

const toArrayBuffer = (bytes: Uint8Array) => {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
};

function parseManifest(bytes: Uint8Array) {
  let raw: unknown;

  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new StapplySeedRefreshError(
      "schema",
      `the upstream manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = manifestSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ");

    throw new StapplySeedRefreshError(
      "schema",
      `the upstream manifest does not match the Stapply schema: ${issues}`,
    );
  }

  return parsed.data;
}

async function readParquet(bytes: Uint8Array) {
  try {
    return await readCompaniesParquet(toArrayBuffer(bytes));
  } catch (error) {
    throw new StapplySeedRefreshError(
      "schema",
      `companies.parquet does not match the (ats, name, slug, url) schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readPreviousRows(path: string) {
  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new StapplySeedRefreshError(
      "schema",
      `the prior snapshot manifest ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = previousManifestSchema.safeParse(raw);

  if (!parsed.success) {
    throw new StapplySeedRefreshError(
      "schema",
      `the prior snapshot manifest ${path} does not declare companies.rows`,
    );
  }

  return parsed.data.companies.rows;
}

function readPreviousFile(path: string) {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

const sameBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

function writeSnapshot(outDir: string, manifestBytes: Uint8Array, companiesBytes: Uint8Array) {
  const manifestPath = join(outDir, STAPPLY_SEED_MANIFEST_FILE);
  const companiesPath = join(outDir, STAPPLY_SEED_COMPANIES_FILE);
  const temporarySuffix = `.${String(process.pid)}.tmp`;
  const manifestTemporary = `${manifestPath}${temporarySuffix}`;
  const companiesTemporary = `${companiesPath}${temporarySuffix}`;

  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(companiesTemporary, companiesBytes);
    writeFileSync(manifestTemporary, manifestBytes);
    renameSync(companiesTemporary, companiesPath);
    renameSync(manifestTemporary, manifestPath);
  } catch (error) {
    rmSync(manifestTemporary, { force: true });
    rmSync(companiesTemporary, { force: true });

    throw new StapplySeedRefreshError(
      "write_failed",
      `staging the snapshot under ${outDir} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function stapplySeedAbortSummary(abort: StapplySeedRefreshAbort) {
  return {
    allowedRowDrop: abort.allowRowDrop,
    companiesParquetSha256: abort.details?.companiesParquetSha256 ?? null,
    manifestSha256: abort.details?.manifestSha256 ?? null,
    message: abort.message,
    outDir: abort.outDir,
    outcome: "aborted" as const,
    previousRows: abort.details?.previousRows ?? null,
    reason: abort.reason,
    rowDropShare: STAPPLY_SEED_ROW_DROP_SHARE,
    rows: abort.details?.rows ?? null,
  } satisfies StapplySeedRefreshSummary;
}

export async function refreshStapplySeed(input: StapplySeedRefreshInput) {
  const { allowRowDrop, companiesBytes, manifestBytes, outDir } = input;
  const manifest = parseManifest(manifestBytes);
  const manifestSha256 = sha256Hex(manifestBytes);
  const companiesParquetSha256 = sha256Hex(companiesBytes);

  if (manifest.companies.parquet_sha256 !== companiesParquetSha256) {
    throw new StapplySeedRefreshError(
      "sha256_mismatch",
      `the manifest declares companies.parquet sha256 ${manifest.companies.parquet_sha256}, the downloaded bytes hash to ${companiesParquetSha256}; the prior snapshot stands`,
      { companiesParquetSha256, manifestSha256 },
    );
  }

  if (
    manifest.companies.parquet_size_bytes !== undefined &&
    manifest.companies.parquet_size_bytes !== companiesBytes.byteLength
  ) {
    throw new StapplySeedRefreshError(
      "sha256_mismatch",
      `the manifest declares companies.parquet size ${String(manifest.companies.parquet_size_bytes)} bytes, the downloaded file is ${String(companiesBytes.byteLength)} bytes; the prior snapshot stands`,
      { companiesParquetSha256, manifestSha256 },
    );
  }

  const { rows } = await readParquet(companiesBytes);

  if (rows.length !== manifest.companies.rows) {
    throw new StapplySeedRefreshError(
      "schema",
      `companies.parquet companies.rows declares ${String(manifest.companies.rows)} rows, the file holds ${String(rows.length)}`,
      { companiesParquetSha256, manifestSha256, rows: rows.length },
    );
  }

  const previousManifestPath = join(outDir, STAPPLY_SEED_MANIFEST_FILE);

  const previousRows = existsSync(previousManifestPath)
    ? readPreviousRows(previousManifestPath)
    : null;

  const dropped =
    previousRows !== null &&
    previousRows > 0 &&
    rows.length < previousRows * (1 - STAPPLY_SEED_ROW_DROP_SHARE);

  if (dropped && !allowRowDrop) {
    throw new StapplySeedRefreshError(
      "row_drop",
      `row drop guard: the upstream snapshot holds ${String(rows.length)} rows against the prior ${String(previousRows)}, more than ${String(STAPPLY_SEED_ROW_DROP_SHARE * 100)} percent fewer; the prior snapshot stands (rerun with --allow-row-drop after checking upstream)`,
      { companiesParquetSha256, manifestSha256, previousRows, rows: rows.length },
    );
  }

  const summary = {
    allowedRowDrop: dropped,
    companiesParquetSha256,
    manifestSha256,
    message: null,
    outDir,
    previousRows,
    reason: null,
    rowDropShare: STAPPLY_SEED_ROW_DROP_SHARE,
    rows: rows.length,
  };

  const previousManifestBytes = readPreviousFile(previousManifestPath);
  const previousCompaniesBytes = readPreviousFile(join(outDir, STAPPLY_SEED_COMPANIES_FILE));

  const unchanged =
    previousManifestBytes !== null &&
    previousCompaniesBytes !== null &&
    sameBytes(previousManifestBytes, manifestBytes) &&
    sameBytes(previousCompaniesBytes, companiesBytes);

  if (unchanged) {
    return { ...summary, outcome: "unchanged" as const } satisfies StapplySeedRefreshSummary;
  }

  writeSnapshot(outDir, manifestBytes, companiesBytes);

  return { ...summary, outcome: "written" as const } satisfies StapplySeedRefreshSummary;
}
