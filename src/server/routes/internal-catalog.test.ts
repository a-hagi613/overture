import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { Hono } from "hono";

import { createCatalogHotSwap } from "../catalog/hot-swap.ts";
import {
  CATALOG_LATEST_KEY,
  CATALOG_MANIFEST_KEY,
  catalogRefreshHeaders,
  catalogSha256,
  compressCatalogSnapshot,
} from "../catalog/stapply-refresh.ts";
import type { CatalogManifest } from "../catalog/stapply-daily.ts";
import {
  CATALOG_REFRESH_PATH,
  CATALOG_SNAPSHOT_PATH,
  createInternalCatalogRoutes,
} from "./internal-catalog.ts";
import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { companies } from "../platform/db/catalog-schema.ts";

const NOW = 1_800_000_000_000;

const errorBodySchema = z.object({ error: z.string() });
const SECRET = "catalog-refresh-test-secret";

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function buildCatalog(path: string, name: string) {
  const { db, sqlite } = openCatalogDatabase(path);

  migrateCatalogDatabase(db, "drizzle-catalog");
  db.insert(companies)
    .values({ createdAt: NOW, domain: null, id: "company-1", industry: null, name, nameNorm: name })
    .run();
  sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
  sqlite.close();

  return new Uint8Array(readFileSync(path));
}

function manifestFor(version: string, bytes: Uint8Array<ArrayBuffer>) {
  return {
    version,
    sha256: catalogSha256(bytes),
    builtAt: new Date(NOW).toISOString(),
    rowCount: 1,
    supportedCount: 1,
  } satisfies CatalogManifest;
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "catalog-refresh-"));
  scratchDirectories.push(directory);

  const objects = createDiskObjectStore(join(directory, "objects"));
  const hotSwap = createCatalogHotSwap({ catalogPath: join(directory, "catalog.sqlite"), objects });

  const app = new Hono();

  app.route(
    "/",
    createInternalCatalogRoutes({
      clock: { now: () => NOW },
      hotSwap,
      objects,
      secret: SECRET,
    }),
  );

  return { app, directory, hotSwap, objects };
}

async function signedPost(
  app: Hono,
  manifest: CatalogManifest,
  timestampMs: number,
  secret = SECRET,
) {
  const body = `${JSON.stringify(manifest)}\n`;

  const response = await app.request(CATALOG_REFRESH_PATH, {
    body,
    headers: {
      "content-type": "application/json",
      ...catalogRefreshHeaders(secret, timestampMs, body),
    },
    method: "POST",
  });

  return response;
}

describe("POST /internal/catalog/refresh", () => {
  test("applies a signed manifest and serves the new catalog", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const bytes = buildCatalog(join(directory, "v1.sqlite"), "Alpha");
    const manifest = manifestFor("2026-11-22", bytes);

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(bytes));

    const response = await signedPost(app, manifest, NOW);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "applied", version: "2026-11-22" });
    expect(hotSwap.activeVersion()).toBe("2026-11-22");
    expect(await objects.get(CATALOG_MANIFEST_KEY)).not.toBeNull();

    hotSwap.close();
  });

  test("rejects a stale timestamp outside the skew window", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const bytes = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(bytes));

    const response = await signedPost(app, manifestFor("2026-11-22", bytes), NOW - 10 * 60_000);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "stale_timestamp" });
    expect(hotSwap.activeVersion()).toBeNull();

    hotSwap.close();
  });

  test("rejects a replayed request even inside the skew window", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const bytes = buildCatalog(join(directory, "v1.sqlite"), "Alpha");
    const manifest = manifestFor("2026-11-22", bytes);

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(bytes));

    expect((await signedPost(app, manifest, NOW)).status).toBe(200);

    const replay = await signedPost(app, manifest, NOW);

    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "replayed_timestamp" });

    hotSwap.close();
  });

  test("rejects a bad signature", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const bytes = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(bytes));

    const response = await signedPost(app, manifestFor("2026-11-22", bytes), NOW, "another-secret");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "bad_signature" });
    expect(hotSwap.activeVersion()).toBeNull();

    hotSwap.close();
  });

  test("reports already-applied and refuses to move backwards", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");
    const second = buildCatalog(join(directory, "v2.sqlite"), "Beta");

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(first));
    expect((await signedPost(app, manifestFor("2026-11-22", first), NOW)).status).toBe(200);

    await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(second));
    expect((await signedPost(app, manifestFor("2026-11-23", second), NOW + 1)).status).toBe(200);

    const alreadyApplied = await signedPost(app, manifestFor("2026-11-23", second), NOW + 2);

    expect(alreadyApplied.status).toBe(200);
    expect(await alreadyApplied.json()).toEqual({
      status: "already_applied",
      version: "2026-11-23",
    });

    const stale = await signedPost(app, manifestFor("2026-11-22", first), NOW + 3);

    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ status: "stale_version", version: "2026-11-23" });
    expect(hotSwap.activeVersion()).toBe("2026-11-23");

    hotSwap.close();
  });

  test("refuses an invalid manifest with a 400", async () => {
    const { app, hotSwap } = setup();
    const body = `${JSON.stringify({ version: "nope" })}\n`;

    const response = await app.request(CATALOG_REFRESH_PATH, {
      body,
      headers: {
        "content-type": "application/json",
        ...catalogRefreshHeaders(SECRET, NOW, body),
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(await response.json()).error).toBe("invalid_manifest");
    expect(hotSwap.activeVersion()).toBeNull();

    hotSwap.close();
  });
});

describe("PUT /internal/catalog/snapshot", () => {
  test("archives a signed relay upload so the next refresh can apply it", async () => {
    const { app, hotSwap, objects, directory } = setup();
    const bytes = buildCatalog(join(directory, "v1.sqlite"), "Alpha");
    const compressed = compressCatalogSnapshot(bytes);

    const upload = await app.request(CATALOG_SNAPSHOT_PATH, {
      body: compressed,
      headers: {
        "content-type": "application/zstd",
        "x-overture-catalog-version": "2026-11-22",
        ...catalogRefreshHeaders(SECRET, NOW, catalogSha256(compressed)),
      },
      method: "PUT",
    });

    expect(upload.status).toBe(204);
    expect(await objects.get(CATALOG_LATEST_KEY)).not.toBeNull();

    const refresh = await signedPost(app, manifestFor("2026-11-22", bytes), NOW + 1);

    expect(refresh.status).toBe(200);
    expect(hotSwap.activeVersion()).toBe("2026-11-22");

    hotSwap.close();
  });

  test("rejects an unsigned relay upload", async () => {
    const { app, hotSwap, directory } = setup();
    const compressed = compressCatalogSnapshot(buildCatalog(join(directory, "v1.sqlite"), "Alpha"));

    const upload = await app.request(CATALOG_SNAPSHOT_PATH, {
      body: compressed,
      headers: { "content-type": "application/zstd", "x-overture-catalog-version": "2026-11-22" },
      method: "PUT",
    });

    expect(upload.status).toBe(401);

    hotSwap.close();
  });
});
