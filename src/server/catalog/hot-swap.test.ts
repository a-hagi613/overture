import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { CatalogRefreshError, createCatalogHotSwap } from "./hot-swap.ts";
import type { CatalogApplyResult, CatalogRefreshErrorReason } from "./hot-swap.ts";
import {
  CATALOG_LATEST_KEY,
  CATALOG_MANIFEST_KEY,
  catalogSha256,
  compressCatalogSnapshot,
} from "./stapply-refresh.ts";
import type { CatalogManifest } from "./stapply-daily.ts";
import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { createDiskObjectStore } from "../platform/ports/object-store.ts";
import { companies } from "../platform/db/catalog-schema.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];

const noop = () => undefined;

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "catalog-hot-swap-"));
  scratchDirectories.push(directory);

  return { catalogPath: join(directory, "catalog.sqlite"), directory };
}

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

async function publish(
  objects: ReturnType<typeof createDiskObjectStore>,
  manifest: CatalogManifest,
  bytes: Uint8Array<ArrayBuffer>,
) {
  await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(bytes));
  await objects.put(
    CATALOG_MANIFEST_KEY,
    new TextEncoder().encode(`${JSON.stringify(manifest)}\n`),
  );
}

function companyNames(db: ReturnType<typeof createCatalogHotSwap>["db"]) {
  return db.all<{ name: string }>(sql`select name from companies`).map((row) => row.name);
}

async function refusal(run: Promise<CatalogApplyResult>) {
  try {
    await run;

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

async function coldBootRefusal(hotSwap: ReturnType<typeof createCatalogHotSwap>) {
  try {
    await hotSwap.coldBoot();

    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function expectRefusal(value: Error | null, reason: CatalogRefreshErrorReason) {
  expect(value).toBeInstanceOf(CatalogRefreshError);

  if (!(value instanceof CatalogRefreshError)) {
    throw new TypeError("expected a catalog refresh refusal");
  }

  expect(value.reason).toBe(reason);
}

describe("the read-only catalog hot-swap", () => {
  test("cold boot hydrates the catalog from R2 when no local file exists", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const bytes = buildCatalog(join(directory, "source.sqlite"), "Alpha");
    const manifest = manifestFor("2026-11-22", bytes);

    await publish(objects, manifest, bytes);

    const hotSwap = createCatalogHotSwap({ catalogPath, objects });

    try {
      await hotSwap.coldBoot();

      expect(hotSwap.activeVersion()).toBe("2026-11-22");
      expect(companyNames(hotSwap.db)).toEqual(["Alpha"]);
      expect(existsSync(join(directory, "catalog.2026-11-22.sqlite"))).toBe(true);
      expect(existsSync(catalogPath)).toBe(true);
    } finally {
      hotSwap.close();
    }
  });

  test("a checksum mismatch is refused and the active catalog keeps serving", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await publish(objects, manifestFor("2026-11-22", first), first);

    const hotSwap = createCatalogHotSwap({ catalogPath, objects });

    try {
      await hotSwap.coldBoot();

      const second = buildCatalog(join(directory, "v2.sqlite"), "Beta");

      await objects.put(CATALOG_LATEST_KEY, compressCatalogSnapshot(second));

      const failure = await refusal(
        hotSwap.applyManifest({ ...manifestFor("2026-11-23", second), sha256: "0".repeat(64) }),
      );

      expectRefusal(failure, "checksum_mismatch");
      expect(hotSwap.activeVersion()).toBe("2026-11-22");
      expect(companyNames(hotSwap.db)).toEqual(["Alpha"]);
    } finally {
      hotSwap.close();
    }
  });

  test("a failed integrity check is refused and the active catalog keeps serving", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await publish(objects, manifestFor("2026-11-22", first), first);

    const hotSwap = createCatalogHotSwap({ catalogPath, objects });

    try {
      await hotSwap.coldBoot();

      const truncated = first.slice(0, Math.floor(first.byteLength / 2));

      await publish(objects, manifestFor("2026-11-23", truncated), truncated);

      const failure = await refusal(hotSwap.applyManifest(manifestFor("2026-11-23", truncated)));

      expectRefusal(failure, "integrity_check_failed");
      expect(hotSwap.activeVersion()).toBe("2026-11-22");
      expect(companyNames(hotSwap.db)).toEqual(["Alpha"]);
      expect(existsSync(join(directory, "catalog.2026-11-23.sqlite"))).toBe(false);
    } finally {
      hotSwap.close();
    }
  });

  test("reads keep working while a hot-swap is in flight", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await publish(objects, manifestFor("2026-11-22", first), first);

    const hotSwap = createCatalogHotSwap({ catalogPath, drainDelayMs: 0, objects });

    try {
      await hotSwap.coldBoot();

      const second = buildCatalog(join(directory, "v2.sqlite"), "Beta");

      await publish(objects, manifestFor("2026-11-23", second), second);

      const reads = Array.from({ length: 40 }, async () => {
        await Promise.resolve();

        return companyNames(hotSwap.db);
      });

      const [applied, ...snapshots] = await Promise.all([
        hotSwap.applyManifest(manifestFor("2026-11-23", second)),
        ...reads,
      ]);

      expect(applied.applied).toBe(true);

      for (const names of snapshots) {
        expect(names.length).toBeGreaterThan(0);
      }

      expect(companyNames(hotSwap.db)).toEqual(["Beta"]);
      expect(hotSwap.activeVersion()).toBe("2026-11-23");
    } finally {
      hotSwap.close();
    }
  });

  test("the previous catalog is closed and unlinked once the swap settles", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await publish(objects, manifestFor("2026-11-22", first), first);

    let resolveDrained: (version: string) => void = noop;

    const drained = new Promise<string>((resolve) => {
      resolveDrained = resolve;
    });

    const hotSwap = createCatalogHotSwap({
      catalogPath,
      drainDelayMs: 0,
      objects,
      onDrained: (version) => {
        resolveDrained(version);
      },
    });

    try {
      await hotSwap.coldBoot();

      const second = buildCatalog(join(directory, "v2.sqlite"), "Beta");

      await publish(objects, manifestFor("2026-11-23", second), second);
      await hotSwap.applyManifest(manifestFor("2026-11-23", second));

      expect(await drained).toBe("2026-11-22");
      expect(existsSync(join(directory, "catalog.2026-11-22.sqlite"))).toBe(false);
      expect(existsSync(join(directory, "catalog.2026-11-23.sqlite"))).toBe(true);
    } finally {
      hotSwap.close();
    }
  });

  test("re-applying the active version and an older version never swap", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));
    const first = buildCatalog(join(directory, "v1.sqlite"), "Alpha");

    await publish(objects, manifestFor("2026-11-22", first), first);

    const hotSwap = createCatalogHotSwap({ catalogPath, objects });

    try {
      await hotSwap.coldBoot();

      expect(await hotSwap.applyManifest(manifestFor("2026-11-22", first))).toEqual({
        applied: false,
        reason: "already_applied",
        activeVersion: "2026-11-22",
      });
      expect(await hotSwap.applyManifest(manifestFor("2026-11-20", first))).toEqual({
        applied: false,
        reason: "stale_version",
        activeVersion: "2026-11-22",
      });
    } finally {
      hotSwap.close();
    }
  });

  test("an invalid manifest on cold boot is refused before anything is applied", async () => {
    const { catalogPath, directory } = scratch();
    const objects = createDiskObjectStore(join(directory, "objects"));

    await objects.put(
      CATALOG_MANIFEST_KEY,
      new TextEncoder().encode(JSON.stringify({ sha256: "short", version: "not-a-date" })),
    );

    const hotSwap = createCatalogHotSwap({ catalogPath, objects });

    try {
      const failure = await coldBootRefusal(hotSwap);

      expectRefusal(failure, "invalid_manifest");
      expect(hotSwap.activeVersion()).toBeNull();
    } finally {
      hotSwap.close();
    }
  });
});
