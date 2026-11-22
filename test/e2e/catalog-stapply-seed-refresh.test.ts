import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

const FIXTURE_DIR = join(import.meta.dir, "fixtures", "ats-scrapers");
const MANIFEST_PATH = join(FIXTURE_DIR, "manifest.json");
const COMPANIES_PATH = join(FIXTURE_DIR, "companies.parquet");

const ROW_DROP_SHARE = 0.2;

const refreshSummarySchema = z.object({
  allowedRowDrop: z.boolean(),
  companiesParquetSha256: z.string().nullable(),
  manifestSha256: z.string().nullable(),
  message: z.string().nullable(),
  outDir: z.string(),
  outcome: z.enum(["aborted", "unchanged", "written"]),
  previousRows: z.number().nullable(),
  reason: z
    .enum(["row_drop", "schema", "sha256_mismatch", "upstream_unavailable", "write_failed"])
    .nullable(),
  rowDropShare: z.number(),
  rows: z.number().nullable(),
});

const fixtureManifestSchema = z.object({
  version: z.string(),
  generated_at: z.string(),
  updated_at: z.string(),
  companies: z.object({
    csv: z.string(),
    parquet: z.string(),
    parquet_sha256: z.string(),
    parquet_size_bytes: z.number(),
    rows: z.number(),
  }),
});

const fixtureManifest = fixtureManifestSchema.parse(
  JSON.parse(readFileSync(MANIFEST_PATH, "utf8")),
);

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function outDirForRun() {
  return mkdtempSync(join(tmpdir(), "overture-stapply-seed-"));
}

function manifestWith(
  rowCount: number | string,
  parquetSha256 = fixtureManifest.companies.parquet_sha256,
) {
  return {
    ...fixtureManifest,
    companies: {
      ...fixtureManifest.companies,
      parquet_sha256: parquetSha256,
      rows: rowCount,
    },
  };
}

function stagePriorSnapshot(outDir: string, rows: number) {
  copyFileSync(MANIFEST_PATH, join(outDir, "manifest.json"));
  copyFileSync(COMPANIES_PATH, join(outDir, "companies.parquet"));
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifestWith(rows))}\n`);
}

async function runRefresh(args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "scripts/refresh-stapply-seed.ts", ...args],
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  const summary = refreshSummarySchema.safeParse(JSON.parse(stdout));

  if (!summary.success) {
    throw new Error(`the refresh printed no summary: ${stdout} ${stderr}`);
  }

  return { code, summary: summary.data };
}

test("a healthy upstream refresh stages both files and reports the verified checksums", async () => {
  const outDir = outDirForRun();

  const run = await runRefresh([
    "--manifest",
    MANIFEST_PATH,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(0);
  expect(run.summary).toMatchObject({
    allowedRowDrop: false,
    outcome: "written",
    previousRows: null,
    reason: null,
    rowDropShare: ROW_DROP_SHARE,
    rows: 11,
  });

  const manifest = readFileSync(join(outDir, "manifest.json"));
  const companies = readFileSync(join(outDir, "companies.parquet"));

  expect(manifest.equals(readFileSync(MANIFEST_PATH))).toBe(true);
  expect(companies.equals(readFileSync(COMPANIES_PATH))).toBe(true);
  expect(run.summary.manifestSha256).toBe(sha256(manifest));
  expect(run.summary.companiesParquetSha256).toBe(sha256(companies));
});

test("an unchanged upstream refresh leaves the staged snapshot exactly as it was", async () => {
  const outDir = outDirForRun();

  await runRefresh([
    "--manifest",
    MANIFEST_PATH,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  const before = readFileSync(join(outDir, "manifest.json"));

  const run = await runRefresh([
    "--manifest",
    MANIFEST_PATH,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(0);
  expect(run.summary).toMatchObject({ outcome: "unchanged", previousRows: 11, rows: 11 });
  expect(readFileSync(join(outDir, "manifest.json")).equals(before)).toBe(true);
});

test("a manifest that fails schema validation aborts and keeps the prior snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 11);

  const brokenManifestPath = join(outDir, "upstream-manifest.json");

  writeFileSync(brokenManifestPath, `${JSON.stringify(manifestWith("eleven"))}\n`);

  const priorManifest = readFileSync(join(outDir, "manifest.json"));
  const priorCompanies = readFileSync(join(outDir, "companies.parquet"));

  const run = await runRefresh([
    "--manifest",
    brokenManifestPath,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(1);
  expect(run.summary).toMatchObject({ outcome: "aborted", reason: "schema" });
  expect(run.summary.message).toContain("companies.rows");
  expect(readFileSync(join(outDir, "manifest.json")).equals(priorManifest)).toBe(true);
  expect(readFileSync(join(outDir, "companies.parquet")).equals(priorCompanies)).toBe(true);
});

test("a manifest whose row declaration disagrees with the parquet aborts and keeps the prior snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 11);

  const mismatchedManifestPath = join(outDir, "upstream-manifest.json");

  writeFileSync(mismatchedManifestPath, `${JSON.stringify(manifestWith(12))}\n`);

  const priorManifest = readFileSync(join(outDir, "manifest.json"));

  const run = await runRefresh([
    "--manifest",
    mismatchedManifestPath,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(1);
  expect(run.summary).toMatchObject({ outcome: "aborted", reason: "schema", rows: 11 });
  expect(run.summary.message).toContain("holds 11");
  expect(readFileSync(join(outDir, "manifest.json")).equals(priorManifest)).toBe(true);
});

test("a declared parquet checksum that does not match the bytes aborts and keeps the prior snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 11);

  const tamperedManifestPath = join(outDir, "upstream-manifest.json");

  writeFileSync(tamperedManifestPath, `${JSON.stringify(manifestWith(11, "0".repeat(64)))}\n`);

  const priorCompanies = readFileSync(join(outDir, "companies.parquet"));

  const run = await runRefresh([
    "--manifest",
    tamperedManifestPath,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(1);
  expect(run.summary).toMatchObject({ outcome: "aborted", reason: "sha256_mismatch" });
  expect(run.summary.message).toContain("companies.parquet sha256");
  expect(run.summary.companiesParquetSha256).toBe(sha256(priorCompanies));
  expect(readFileSync(join(outDir, "companies.parquet")).equals(priorCompanies)).toBe(true);
});

test("an upstream row count that dropped more than 20 percent aborts and keeps the prior snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 14);

  const priorManifest = readFileSync(join(outDir, "manifest.json"));
  const priorCompanies = readFileSync(join(outDir, "companies.parquet"));

  const run = await runRefresh([
    "--manifest",
    MANIFEST_PATH,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(1);
  expect(run.summary).toMatchObject({
    outcome: "aborted",
    previousRows: 14,
    reason: "row_drop",
    rows: 11,
  });
  expect(run.summary.message).toContain("row drop guard");
  expect(readFileSync(join(outDir, "manifest.json")).equals(priorManifest)).toBe(true);
  expect(readFileSync(join(outDir, "companies.parquet")).equals(priorCompanies)).toBe(true);
});

test("the deliberate row-drop override publishes the shrunken snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 14);

  const run = await runRefresh([
    "--manifest",
    MANIFEST_PATH,
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
    "--allow-row-drop",
  ]);

  expect(run.code).toBe(0);
  expect(run.summary).toMatchObject({
    allowedRowDrop: true,
    outcome: "written",
    previousRows: 14,
    rows: 11,
  });
  expect(readFileSync(join(outDir, "companies.parquet")).equals(readFileSync(COMPANIES_PATH))).toBe(
    true,
  );
});

test("an upstream outage aborts without touching the prior snapshot", async () => {
  const outDir = outDirForRun();

  stagePriorSnapshot(outDir, 11);

  const priorManifest = readFileSync(join(outDir, "manifest.json"));
  const priorCompanies = readFileSync(join(outDir, "companies.parquet"));

  const run = await runRefresh([
    "--manifest",
    join(outDir, "manifest-that-is-not-there.json"),
    "--companies",
    COMPANIES_PATH,
    "--out-dir",
    outDir,
  ]);

  expect(run.code).toBe(1);
  expect(run.summary).toMatchObject({ outcome: "aborted", reason: "upstream_unavailable" });
  expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
  expect(readFileSync(join(outDir, "manifest.json")).equals(priorManifest)).toBe(true);
  expect(readFileSync(join(outDir, "companies.parquet")).equals(priorCompanies)).toBe(true);
});
