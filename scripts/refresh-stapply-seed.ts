import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  SEED_COMPANIES_PARQUET_URL,
  SEED_MANIFEST_URL,
} from "../src/server/catalog/companies-parquet.ts";
import {
  StapplySeedRefreshError,
  stapplySeedAbortSummary,
  refreshStapplySeed,
} from "../src/server/catalog/stapply-seed-refresh.ts";

const FETCH_TIMEOUT_MS = 120_000;
const MANIFEST_MAX_BYTES = 8 * 1024 * 1024;
const COMPANIES_MAX_BYTES = 512 * 1024 * 1024;

const args = parseArgs({
  options: {
    manifest: { type: "string" },
    companies: { type: "string" },
    "manifest-url": { type: "string" },
    "companies-url": { type: "string" },
    "out-dir": { type: "string" },
    "allow-row-drop": { type: "boolean" },
  },
  strict: true,
});

const outDir = args.values["out-dir"] ?? "";
const manifestPath = args.values.manifest;
const companiesPath = args.values.companies;
const manifestUrl = args.values["manifest-url"];
const companiesUrl = args.values["companies-url"];
const allowRowDrop = args.values["allow-row-drop"] === true;

if (outDir === "") {
  throw new Error(
    "usage: bun run scripts/refresh-stapply-seed.ts --out-dir <seed-dir> [--manifest <path> --companies <path>]",
  );
}

if ((manifestPath === undefined) !== (companiesPath === undefined)) {
  throw new Error("pass both --manifest and --companies for a local refresh");
}

if (manifestPath !== undefined && (manifestUrl !== undefined || companiesUrl !== undefined)) {
  throw new Error("pass either file inputs or the Stapply URLs, not both");
}

function readLocal(path: string, label: string) {
  try {
    return new Uint8Array(readFileSync(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      `reading the local ${label} ${path} failed: ${message}`,
    );
  }
}

async function download(url: string, label: string, maxBytes: number) {
  let response: Response;

  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      `downloading the Stapply ${label} ${url} failed: ${message}`,
    );
  }

  if (!response.ok) {
    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      `downloading the Stapply ${label} ${url} failed: HTTP ${String(response.status)}`,
    );
  }

  const declared = Number(response.headers.get("content-length") ?? "");

  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      `downloading the Stapply ${label} ${url} declared ${String(declared)} bytes, above the ${String(maxBytes)} byte ceiling; the prior snapshot stands`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (bytes.byteLength > maxBytes) {
    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      `downloading the Stapply ${label} ${url} returned ${String(bytes.byteLength)} bytes, above the ${String(maxBytes)} byte ceiling; the prior snapshot stands`,
    );
  }

  return bytes;
}

async function readInputs() {
  if (manifestPath !== undefined && companiesPath !== undefined) {
    return {
      companiesBytes: readLocal(companiesPath, "companies.parquet"),
      manifestBytes: readLocal(manifestPath, "manifest"),
    };
  }

  if (Bun.env.STAPPLY_LIVE_FETCH !== "1") {
    throw new StapplySeedRefreshError(
      "upstream_unavailable",
      "a live Stapply fetch needs STAPPLY_LIVE_FETCH=1 (the scheduled Action only)",
    );
  }

  const resolvedManifestUrl = manifestUrl ?? SEED_MANIFEST_URL;
  const resolvedCompaniesUrl = companiesUrl ?? SEED_COMPANIES_PARQUET_URL;

  return {
    companiesBytes: await download(resolvedCompaniesUrl, "companies.parquet", COMPANIES_MAX_BYTES),
    manifestBytes: await download(resolvedManifestUrl, "manifest", MANIFEST_MAX_BYTES),
  };
}

async function main() {
  try {
    const { manifestBytes, companiesBytes } = await readInputs();

    const summary = await refreshStapplySeed({
      allowRowDrop,
      companiesBytes,
      manifestBytes,
      outDir,
    });

    return { exitCode: 0, summary };
  } catch (error) {
    if (error instanceof StapplySeedRefreshError) {
      return {
        exitCode: 1,
        summary: stapplySeedAbortSummary({
          allowRowDrop,
          details: error.details,
          message: error.message,
          outDir,
          reason: error.reason,
        }),
      };
    }

    throw error;
  }
}

const { exitCode, summary } = await main();

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

process.exitCode = exitCode;
