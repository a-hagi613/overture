import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import type { CatalogFetch } from "./stapply-refresh.ts";

import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { buildCatalogManifest } from "./stapply-daily.ts";
import {
  CATALOG_LATEST_KEY,
  CATALOG_MANIFEST_KEY,
  CATALOG_SIGNATURE_HEADER,
  CATALOG_TIMESTAMP_HEADER,
  catalogRefreshSignature,
  catalogSha256,
  catalogSnapshotKey,
  compressCatalogSnapshot,
  createCatalogRefreshVerifier,
  decompressCatalogSnapshot,
  downloadPreviousCatalog,
  notifyCatalogRefresh,
  publishCatalogSnapshot,
  pruneCatalogSnapshots,
  readPreviousCatalogManifest,
  relayCatalogSnapshot,
} from "./stapply-refresh.ts";

const NOW = Date.parse("2026-11-23T15:30:00.000Z");
const SECRET = "test-catalog-refresh-secret";
const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratchStore() {
  const directory = mkdtempSync(join(tmpdir(), "stapply-refresh-"));
  scratchDirectories.push(directory);

  return createDiskObjectStore(directory);
}

function artifacts() {
  const sqliteBytes = new TextEncoder().encode("a fake catalog.sqlite payload");
  const compressedBytes = compressCatalogSnapshot(sqliteBytes);

  return {
    sqliteBytes,
    compressedBytes,
    manifest: buildCatalogManifest({
      version: "2026-11-23",
      builtAt: new Date(NOW).toISOString(),
      sqliteBytes,
      rowCount: 42,
      supportedCount: 9,
    }),
  };
}

describe("compression", () => {
  test("round-trips through zstd and hashes the uncompressed bytes", () => {
    const { sqliteBytes, compressedBytes, manifest } = artifacts();

    expect(decompressCatalogSnapshot(compressedBytes)).toEqual(sqliteBytes);
    expect(manifest.sha256).toBe(catalogSha256(sqliteBytes));
    expect(catalogSnapshotKey(manifest.version)).toBe("catalog/snapshots/2026-11-23.sqlite.zst");
  });
});

describe("catalogRefreshSignature", () => {
  test("signs the timestamp and body, and the verifier accepts the exact request once", () => {
    const body = JSON.stringify({ version: "2026-11-23" });
    const timestamp = String(NOW);

    const headers = {
      [CATALOG_TIMESTAMP_HEADER]: timestamp,
      [CATALOG_SIGNATURE_HEADER]: catalogRefreshSignature(SECRET, timestamp, body),
    };

    const verify = createCatalogRefreshVerifier(SECRET);

    expect(verify({ headers, body, nowMs: NOW })).toEqual({ ok: true, timestampMs: NOW });
    expect(verify({ headers, body, nowMs: NOW })).toEqual({
      ok: false,
      reason: "replayed_timestamp",
    });
  });

  test("rejects a tampered body, a stale timestamp, missing headers and a bad signature", () => {
    const body = '{"version":"2026-11-23"}';
    const timestamp = String(NOW);
    const signature = catalogRefreshSignature(SECRET, timestamp, body);

    expect(
      createCatalogRefreshVerifier(SECRET)({
        headers: { [CATALOG_TIMESTAMP_HEADER]: timestamp },
        body,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "missing_signature" });
    expect(
      createCatalogRefreshVerifier(SECRET)({
        headers: { [CATALOG_SIGNATURE_HEADER]: signature },
        body,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "missing_timestamp" });
    expect(
      createCatalogRefreshVerifier(SECRET)({
        headers: { [CATALOG_TIMESTAMP_HEADER]: timestamp, [CATALOG_SIGNATURE_HEADER]: signature },
        body: `${body}tampered`,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      createCatalogRefreshVerifier(SECRET)({
        headers: { [CATALOG_TIMESTAMP_HEADER]: timestamp, [CATALOG_SIGNATURE_HEADER]: signature },
        body,
        nowMs: NOW + 10 * 60_000,
      }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(
      createCatalogRefreshVerifier(SECRET)({
        headers: {
          [CATALOG_TIMESTAMP_HEADER]: timestamp,
          [CATALOG_SIGNATURE_HEADER]: catalogRefreshSignature("another-secret", timestamp, body),
        },
        body,
        nowMs: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("accepts a header name in any case", () => {
    const body = "{}";
    const timestamp = String(NOW);
    const verify = createCatalogRefreshVerifier(SECRET);

    expect(
      verify({
        headers: {
          "X-Overture-Catalog-Timestamp": timestamp,
          "X-OVERTURE-CATALOG-SIGNATURE": catalogRefreshSignature(SECRET, timestamp, body),
        },
        body,
        nowMs: NOW,
      }),
    ).toEqual({ ok: true, timestampMs: NOW });
  });
});

describe("publishCatalogSnapshot", () => {
  test("writes the dated snapshot, the latest pointer and the manifest, and reads them back", async () => {
    const objects = scratchStore();
    const { sqliteBytes, compressedBytes, manifest } = artifacts();

    const keys = await publishCatalogSnapshot({ objects, manifest, compressedBytes });

    expect(keys.snapshotKey).toBe("catalog/snapshots/2026-11-23.sqlite.zst");
    expect(await readPreviousCatalogManifest(objects)).toEqual(manifest);

    const downloaded = await downloadPreviousCatalog({
      objects,
      decompress: decompressCatalogSnapshot,
    });

    expect(downloaded?.manifest).toEqual(manifest);
    expect(downloaded?.sqliteBytes).toEqual(sqliteBytes);
    expect(await objects.get(CATALOG_LATEST_KEY)).not.toBeNull();
    expect(await objects.get(CATALOG_MANIFEST_KEY)).not.toBeNull();
  });

  test("refuses a downloaded snapshot whose bytes do not match the manifest", async () => {
    const objects = scratchStore();
    const { compressedBytes, manifest } = artifacts();

    await publishCatalogSnapshot({ objects, manifest, compressedBytes });
    await objects.put(
      CATALOG_LATEST_KEY,
      compressCatalogSnapshot(new TextEncoder().encode("swapped")),
    );

    const download = downloadPreviousCatalog({ objects, decompress: decompressCatalogSnapshot });

    expect(download).rejects.toThrow(/does not match its manifest/u);
  });

  test("keeps the newest dated snapshots and deletes the older ones", async () => {
    const objects = scratchStore();
    const { compressedBytes, manifest } = artifacts();

    for (const day of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
      await objects.put(`catalog/snapshots/2026-11-${day}.sqlite.zst`, compressedBytes);
    }

    const published = await publishCatalogSnapshot({
      objects,
      manifest: { ...manifest, version: "2026-11-10" },
      compressedBytes,
      keepSnapshots: 7,
    });

    expect(published.pruned).toEqual([
      "catalog/snapshots/2026-11-01.sqlite.zst",
      "catalog/snapshots/2026-11-02.sqlite.zst",
      "catalog/snapshots/2026-11-03.sqlite.zst",
    ]);

    const remaining: string[] = [];

    for await (const key of objects.list("catalog/snapshots")) {
      remaining.push(key);
    }

    expect(remaining.toSorted()).toEqual([
      "catalog/snapshots/2026-11-04.sqlite.zst",
      "catalog/snapshots/2026-11-05.sqlite.zst",
      "catalog/snapshots/2026-11-06.sqlite.zst",
      "catalog/snapshots/2026-11-07.sqlite.zst",
      "catalog/snapshots/2026-11-08.sqlite.zst",
      "catalog/snapshots/2026-11-09.sqlite.zst",
      "catalog/snapshots/2026-11-10.sqlite.zst",
    ]);
    expect(await objects.get("catalog/latest.sqlite.zst")).toEqual(new Uint8Array(compressedBytes));
  });

  test("prunes to one snapshot at the floor", async () => {
    const objects = scratchStore();

    await objects.put("catalog/snapshots/2026-11-01.sqlite.zst", new Uint8Array([1]));
    await objects.put("catalog/snapshots/2026-11-02.sqlite.zst", new Uint8Array([2]));

    expect(await pruneCatalogSnapshots(objects, 0)).toEqual([
      "catalog/snapshots/2026-11-01.sqlite.zst",
    ]);
    expect(await pruneCatalogSnapshots(objects)).toEqual([]);
  });

  test("returns null when there is no previous manifest", async () => {
    const objects = scratchStore();

    expect(await readPreviousCatalogManifest(objects)).toBeNull();
    expect(
      await downloadPreviousCatalog({ objects, decompress: decompressCatalogSnapshot }),
    ).toBeNull();
  });
});

describe("notifyCatalogRefresh", () => {
  test("sends the signed manifest so the runtime hot-swaps an R2 upload", async () => {
    const { manifest } = artifacts();
    const calls: { url: string; init: RequestInit }[] = [];

    const result = await notifyCatalogRefresh({
      origin: "https://tryoverture.com",
      secret: SECRET,
      manifest,
      nowMs: NOW,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        await Promise.resolve();

        return Response.json({ version: manifest.version, sha256: manifest.sha256 });
      },
    });

    expect(result).toEqual({ outcome: "delivered" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://tryoverture.com/internal/catalog/refresh");
    expect(calls[0]?.init.method).toBe("POST");

    const headers = new Headers(calls[0]?.init.headers);
    const body = z.string().parse(calls[0]?.init.body);

    expect(headers.get(CATALOG_SIGNATURE_HEADER)).toBe(
      catalogRefreshSignature(SECRET, String(NOW), body),
    );
    expect(JSON.parse(body)).toEqual(manifest);
  });

  test("reports a missing endpoint and raises a real failure", async () => {
    const { manifest } = artifacts();

    expect(
      await notifyCatalogRefresh({
        origin: "https://tryoverture.com",
        secret: SECRET,
        manifest,
        nowMs: NOW,
        fetchImpl: async () => {
          await Promise.resolve();

          return new Response("not implemented", { status: 501 });
        },
      }),
    ).toEqual({ outcome: "endpoint_missing" });

    const failed = notifyCatalogRefresh({
      origin: "https://tryoverture.com",
      secret: SECRET,
      manifest,
      nowMs: NOW,
      fetchImpl: async () => {
        await Promise.resolve();

        return new Response("bad signature", { status: 401 });
      },
    });

    expect(failed).rejects.toThrow(/HTTP 401/u);
  });
});

describe("relayCatalogSnapshot", () => {
  test("uploads the compressed snapshot, then asks for the signed hot swap", async () => {
    const { compressedBytes, manifest } = artifacts();
    const calls: { url: string; init: RequestInit }[] = [];

    const fetchImpl: CatalogFetch = async (url, init) => {
      calls.push({ url, init });
      await Promise.resolve();

      return Response.json({ version: manifest.version, sha256: manifest.sha256 });
    };

    const result = await relayCatalogSnapshot({
      origin: "https://tryoverture.com/",
      secret: SECRET,
      manifest,
      compressedBytes,
      nowMs: NOW,
      fetchImpl,
    });

    expect(result).toEqual({ outcome: "delivered" });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://tryoverture.com/internal/catalog/snapshot");
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.init.body).toBe(compressedBytes);

    const uploadHeaders = new Headers(calls[0]?.init.headers);

    expect(uploadHeaders.get("content-type")).toBe("application/zstd");
    expect(uploadHeaders.get("x-overture-catalog-version")).toBe(manifest.version);
    expect(uploadHeaders.get("x-overture-catalog-sha256")).toBe(manifest.sha256);
    expect(uploadHeaders.get(CATALOG_TIMESTAMP_HEADER)).toBe(String(NOW));
    expect(uploadHeaders.get(CATALOG_SIGNATURE_HEADER)).toBe(
      catalogRefreshSignature(SECRET, String(NOW), catalogSha256(compressedBytes)),
    );

    expect(calls[1]?.url).toBe("https://tryoverture.com/internal/catalog/refresh");
    expect(calls[1]?.init.method).toBe("POST");

    const refreshHeaders = new Headers(calls[1]?.init.headers);
    const refreshBody = z.string().parse(calls[1]?.init.body);

    expect(refreshHeaders.get(CATALOG_TIMESTAMP_HEADER)).toBe(String(NOW + 1));
    expect(refreshHeaders.get(CATALOG_SIGNATURE_HEADER)).toBe(
      catalogRefreshSignature(SECRET, String(NOW + 1), refreshBody),
    );
    expect(JSON.parse(refreshBody)).toEqual(manifest);
  });

  test("reports a missing endpoint instead of failing the run", async () => {
    const { compressedBytes, manifest } = artifacts();

    const result = await relayCatalogSnapshot({
      origin: "https://tryoverture.com",
      secret: SECRET,
      manifest,
      compressedBytes,
      nowMs: NOW,
      fetchImpl: async () => {
        await Promise.resolve();

        return new Response("not found", { status: 404 });
      },
    });

    expect(result).toEqual({ outcome: "endpoint_missing" });
  });

  test("raises a real failure", () => {
    const { compressedBytes, manifest } = artifacts();

    const relay = relayCatalogSnapshot({
      origin: "https://tryoverture.com",
      secret: SECRET,
      manifest,
      compressedBytes,
      nowMs: NOW,
      fetchImpl: async () => {
        await Promise.resolve();

        return new Response("boom", { status: 500 });
      },
    });

    expect(relay).rejects.toThrow(/HTTP 500/u);
  });
});
