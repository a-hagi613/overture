import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SEED_PINS,
  PINNED_COMPANIES_PARQUET_SHA256,
  PINNED_MANIFEST_SHA256,
  readCompaniesParquet,
  sha256Hex,
  verifySeedFiles,
} from "./companies-parquet.ts";

const FIXTURE_DIR = new URL("../../../test/e2e/fixtures/ats-scrapers/", import.meta.url);

function fixtureBytes(name: string) {
  return new Uint8Array(readFileSync(new URL(name, FIXTURE_DIR)));
}

function arrayBufferOf(bytes: Uint8Array) {
  const file = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(file).set(bytes);

  return file;
}

function manifestBytes(parquetSha256: string, rows = 192_012) {
  return new TextEncoder().encode(
    JSON.stringify({ companies: { parquet_sha256: parquetSha256, rows } }),
  );
}

function pinsFor(manifest: Uint8Array, parquet: Uint8Array) {
  return { manifestSha256: sha256Hex(manifest), companiesParquetSha256: sha256Hex(parquet) };
}

const parquetBytes = new TextEncoder().encode("verified companies parquet bytes");
const validManifest = manifestBytes(sha256Hex(parquetBytes));
const validPins = pinsFor(validManifest, parquetBytes);

describe("verifySeedFiles", () => {
  test("accepts files that match the supplied pins and returns the manifest row count", () => {
    expect(verifySeedFiles(validManifest, parquetBytes, validPins)).toEqual({
      companiesRows: 192_012,
    });
  });

  test("rejects a manifest whose sha256 differs from the pin", () => {
    expect(() =>
      verifySeedFiles(validManifest, parquetBytes, {
        ...validPins,
        manifestSha256: "0".repeat(64),
      }),
    ).toThrow(/manifest sha256 pin mismatch/u);
  });

  test("rejects a companies.parquet whose sha256 differs from the pin", () => {
    expect(() =>
      verifySeedFiles(validManifest, parquetBytes, {
        ...validPins,
        companiesParquetSha256: "1".repeat(64),
      }),
    ).toThrow(/companies\.parquet sha256 pin mismatch/u);
  });

  test("rejects a manifest that declares a different companies parquet sha256", () => {
    const mismatchedManifest = manifestBytes("2".repeat(64));

    expect(() =>
      verifySeedFiles(mismatchedManifest, parquetBytes, pinsFor(mismatchedManifest, parquetBytes)),
    ).toThrow(/manifest companies\.parquet_sha256 .* does not match the pin/u);
  });

  test("rejects a manifest whose parquet_sha256 is not 64-character lowercase hex", () => {
    const nonHexManifest = manifestBytes("not-a-sha256");

    expect(() =>
      verifySeedFiles(nonHexManifest, parquetBytes, pinsFor(nonHexManifest, parquetBytes)),
    ).toThrow();
  });

  test("rejects a manifest that is not valid JSON", () => {
    const invalidJson = new TextEncoder().encode("{not json");

    expect(() =>
      verifySeedFiles(invalidJson, parquetBytes, pinsFor(invalidJson, parquetBytes)),
    ).toThrow();
  });
});

describe("readCompaniesParquet", () => {
  test("reads the recorded fixture with the (ats, name, slug, url) columns and every row", async () => {
    const { rows, columns } = await readCompaniesParquet(
      arrayBufferOf(fixtureBytes("companies.parquet")),
    );

    expect(columns).toEqual(["ats", "name", "slug", "url"]);
    expect(rows).toHaveLength(11);

    for (const row of rows) {
      expect(Object.keys(row).toSorted()).toEqual(["ats", "name", "slug", "url"]);
      expect(row.ats.length).toBeGreaterThan(0);
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.slug.length).toBeGreaterThan(0);
      expect(row.url.length).toBeGreaterThan(0);
    }
  });
});

describe("pins", () => {
  test("are 64-character lowercase hex digests", () => {
    expect(PINNED_MANIFEST_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(PINNED_COMPANIES_PARQUET_SHA256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("match the Stapply snapshot verified by stapply-seed run 45080850235", () => {
    expect(PINNED_MANIFEST_SHA256).toBe(
      "07d04361d9edef28803be1cb3b389bea4f364e328dae82340b9e08020c752104",
    );
    expect(PINNED_COMPANIES_PARQUET_SHA256).toBe(
      "8936af47841d95c1f8ae55cd527302c64fa592d79f1fe2ee347c7d997635b2fb",
    );
  });

  test("are exposed as the default verification pins", () => {
    expect(DEFAULT_SEED_PINS).toEqual({
      manifestSha256: PINNED_MANIFEST_SHA256,
      companiesParquetSha256: PINNED_COMPANIES_PARQUET_SHA256,
    });
  });
});
