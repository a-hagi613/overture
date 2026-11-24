import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { CatalogManifest } from "./stapply-daily.ts";

import { createClock } from "../platform/ports/clock.ts";
import { openReadOnlyCatalogDatabase } from "../platform/db/client.ts";
import { catalogManifestSchema } from "./stapply-daily.ts";
import {
  CATALOG_LATEST_KEY,
  CATALOG_MANIFEST_KEY,
  catalogSha256,
  catalogSnapshotKey,
  decompressCatalogSnapshot,
} from "./stapply-refresh.ts";

/**
 * Where the active catalog pointer lives: `<catalog path>.active.json` beside the catalog itself.
 * @param catalogPath the stable `catalog.sqlite` path
 * @returns the pointer file path beside it
 */
export function catalogPointerPath(catalogPath: string) {
  return `${catalogPath}.active.json`;
}

const pointerSchema = z.object({
  version: z.string().min(1),
  file: z.string().min(1),
  sha256: z.string().min(1),
  appliedAt: z.number().int().nonnegative(),
});

const integrityCheckSchema = z.array(z.object({ integrity_check: z.string() }));

export type CatalogPointer = z.infer<typeof pointerSchema>;

export type CatalogRefreshErrorReason =
  | "invalid_manifest"
  | "artifact_missing"
  | "decompress_failed"
  | "checksum_mismatch"
  | "integrity_check_failed"
  | "write_failed";

/** A refresh that could not be applied. The active catalog keeps serving; nothing was swapped. */
export class CatalogRefreshError extends Error {
  readonly reason: CatalogRefreshErrorReason;

  constructor(reason: CatalogRefreshErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogRefreshError";
    this.reason = reason;
  }
}

export type CatalogApplyResult =
  | { applied: true; version: string; path: string }
  | { applied: false; reason: "already_applied" | "stale_version"; activeVersion: string | null };

interface ActiveCatalog {
  version: string;
  path: string;
  sqlite: ReturnType<typeof openReadOnlyCatalogDatabase>["sqlite"];
  appliedAt: number;
}

interface OpenedCatalog {
  version: string;
  path: string;
  sqlite: ReturnType<typeof openReadOnlyCatalogDatabase>["sqlite"];
  db: CatalogDatabase;
  appliedAt: number;
}

export interface CatalogHotSwapOptions {
  /** The stable path the app reads: `catalog.sqlite` on the Fly volume. */
  catalogPath: string;
  /** The R2 (or disk, in tests) object store the artifacts are fetched from. */
  objects: Pick<ObjectStore, "get">;
  /** Epoch-ms clock, injectable for tests. */
  now?: () => number;
  /** Where to report a swap or a refused refresh. Defaults to silence. */
  log?: (event: string, message: string) => void;
  /** How long to wait before closing and unlinking the previous catalog, so in-flight readers finish. */
  drainDelayMs?: number;
  /** Called once the previous catalog is closed and unlinked; tests await this instead of sleeping. */
  onDrained?: (version: string) => void;
}

export type CatalogHotSwap = ReturnType<typeof createCatalogHotSwap>;

const DEFAULT_DRAIN_DELAY_MS = 250;

function openVerified(path: string, version: string) {
  const { db, sqlite } = openReadOnlyCatalogDatabase(path);

  let verdict: string;

  try {
    const [check] = integrityCheckSchema.parse(sqlite.query("PRAGMA integrity_check").all());

    verdict = check?.integrity_check ?? "missing";
  } catch (error) {
    sqlite.close();

    throw new CatalogRefreshError(
      "integrity_check_failed",
      `catalog ${version} could not be checked: ${String(error)}`,
      { cause: error },
    );
  }

  if (verdict !== "ok") {
    sqlite.close();

    throw new CatalogRefreshError(
      "integrity_check_failed",
      `catalog ${version} failed PRAGMA integrity_check: ${verdict}`,
    );
  }

  return { db, sqlite };
}

/**
 * The read-only catalog hot-swap (issue #576). It owns the active `catalog.sqlite` handle, verifies every artifact
 * before it is trusted, and swaps the handle atomically so a failed refresh can never take the live catalog down.
 *
 * The app only ever reads the catalog: a refresh writes a new `catalog.<version>.sqlite` beside the old one, verifies
 * its SHA-256 and `PRAGMA integrity_check`, then points `catalog.sqlite` at it and drains the previous handle.
 *
 * The `db` it exposes keeps one identity for the life of the process. Drizzle reads the active connection through its
 * own `session` field, so a swap adopts the new handle's fields onto that object instead of replacing it: every
 * service built at boot keeps working without being rewired, and a query builder created before the swap finishes
 * against the still-open previous connection before it is drained.
 * @param options the catalog path, the object store, the clock and the drain settings
 * @returns the hot-swap handle, its stable `db`, and the refresh entry points
 */
export function createCatalogHotSwap(options: CatalogHotSwapOptions) {
  const { catalogPath, objects } = options;
  const now = options.now ?? createClock().now;
  const log = options.log ?? (() => undefined);
  const drainDelayMs = options.drainDelayMs ?? DEFAULT_DRAIN_DELAY_MS;

  const directory = dirname(catalogPath);
  const pointerPath = catalogPointerPath(catalogPath);

  let active: ActiveCatalog | null = null;
  let stableDb: CatalogDatabase | null = null;
  const pendingDrains = new Set<ReturnType<typeof setTimeout>>();

  function install(next: OpenedCatalog) {
    const previous = active;

    if (stableDb === null) {
      stableDb = next.db;
    } else {
      Object.assign(stableDb, next.db);
    }

    active = {
      version: next.version,
      path: next.path,
      sqlite: next.sqlite,
      appliedAt: next.appliedAt,
    };

    return previous;
  }

  function db() {
    if (stableDb === null) {
      throw new Error("the catalog is not open yet; cold boot must run before the app serves");
    }

    return stableDb;
  }

  function versionedPath(version: string) {
    return join(directory, `catalog.${version}.sqlite`);
  }

  async function writePointer(pointer: CatalogPointer) {
    const temporary = `${pointerPath}.tmp`;

    await writeFile(temporary, JSON.stringify(pointer));
    await rename(temporary, pointerPath);
  }

  async function pointStablePathAt(target: string) {
    const temporaryLink = `${catalogPath}.link.tmp`;

    await rm(temporaryLink, { force: true });

    try {
      await symlink(basename(target), temporaryLink);
      await rename(temporaryLink, catalogPath);
    } catch (error) {
      await rm(temporaryLink, { force: true });
      log(
        "catalog.hot_swap.symlink_failed",
        `could not point ${catalogPath} at ${target}; the pointer file remains authoritative (${String(error)})`,
      );
    }
  }

  function scheduleDrain(previous: ActiveCatalog) {
    const timer = setTimeout(() => {
      pendingDrains.delete(timer);

      try {
        previous.sqlite.close();
      } catch (error) {
        log("catalog.hot_swap.close_failed", String(error));
      }

      void (async () => {
        if (previous.path !== catalogPath) {
          try {
            await rm(previous.path, { force: true });
          } catch (error) {
            log("catalog.hot_swap.unlink_failed", String(error));
          }
        }

        options.onDrained?.(previous.version);
      })();
    }, drainDelayMs);

    timer.unref();
    pendingDrains.add(timer);
  }

  async function applyManifest(manifest: CatalogManifest) {
    if (active !== null) {
      if (active.version === manifest.version) {
        const already: CatalogApplyResult = {
          applied: false,
          reason: "already_applied",
          activeVersion: active.version,
        };

        return already;
      }

      if (manifest.version < active.version) {
        const stale: CatalogApplyResult = {
          applied: false,
          reason: "stale_version",
          activeVersion: active.version,
        };

        return stale;
      }
    }

    const compressed =
      (await objects.get(CATALOG_LATEST_KEY)) ??
      (await objects.get(catalogSnapshotKey(manifest.version)));

    if (compressed === null) {
      throw new CatalogRefreshError(
        "artifact_missing",
        `neither ${CATALOG_LATEST_KEY} nor ${catalogSnapshotKey(manifest.version)} is in the bucket`,
      );
    }

    let bytes: Uint8Array<ArrayBuffer>;

    try {
      bytes = decompressCatalogSnapshot(compressed);
    } catch (error) {
      throw new CatalogRefreshError("decompress_failed", "the catalog artifact is not zstd", {
        cause: error,
      });
    }

    const digest = catalogSha256(bytes);

    if (digest !== manifest.sha256) {
      throw new CatalogRefreshError(
        "checksum_mismatch",
        `catalog ${manifest.version} has sha256 ${digest}, manifest says ${manifest.sha256}`,
      );
    }

    const target = versionedPath(manifest.version);
    const temporary = `${target}.tmp`;

    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });

      throw new CatalogRefreshError("write_failed", `could not write ${target}`, { cause: error });
    }

    let opened: ReturnType<typeof openVerified>;

    try {
      opened = openVerified(target, manifest.version);
    } catch (error) {
      await rm(target, { force: true });

      throw error;
    }

    const previous = install({
      version: manifest.version,
      path: target,
      sqlite: opened.sqlite,
      db: opened.db,
      appliedAt: now(),
    });

    await writePointer({
      version: manifest.version,
      file: target,
      sha256: manifest.sha256,
      appliedAt: active?.appliedAt ?? now(),
    });
    await pointStablePathAt(target);

    if (previous !== null) {
      scheduleDrain(previous);
    }

    log(
      "catalog.hot_swap.applied",
      `catalog ${manifest.version}: ${String(manifest.rowCount)} rows, ${String(manifest.supportedCount)} supported`,
    );

    const applied: CatalogApplyResult = { applied: true, version: manifest.version, path: target };

    return applied;
  }

  async function readPointer() {
    try {
      return pointerSchema.parse(JSON.parse(await readFile(pointerPath, "utf8")));
    } catch {
      return null;
    }
  }

  async function adoptExistingFile() {
    const pointer = await readPointer();

    if (pointer !== null) {
      try {
        const opened = openVerified(pointer.file, pointer.version);

        install({
          version: pointer.version,
          path: pointer.file,
          sqlite: opened.sqlite,
          db: opened.db,
          appliedAt: pointer.appliedAt,
        });

        return true;
      } catch {}
    }

    if (!(await Bun.file(catalogPath).exists())) {
      return false;
    }

    try {
      const opened = openVerified(catalogPath, "local");

      install({
        version: "local",
        path: catalogPath,
        sqlite: opened.sqlite,
        db: opened.db,
        appliedAt: now(),
      });

      return true;
    } catch {
      return false;
    }
  }

  async function coldBoot() {
    if (await adoptExistingFile()) {
      return active;
    }

    const manifestBytes = await objects.get(CATALOG_MANIFEST_KEY);

    if (manifestBytes === null) {
      throw new CatalogRefreshError(
        "artifact_missing",
        `${CATALOG_MANIFEST_KEY} is not in the bucket and no local catalog exists`,
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch (error) {
      throw new CatalogRefreshError("invalid_manifest", "the catalog manifest is not JSON", {
        cause: error,
      });
    }

    const manifest = catalogManifestSchema.safeParse(parsed);

    if (!manifest.success) {
      throw new CatalogRefreshError(
        "invalid_manifest",
        `the catalog manifest is invalid: ${manifest.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}`,
      );
    }

    const result = await applyManifest(manifest.data);

    if (!result.applied) {
      throw new CatalogRefreshError(
        "invalid_manifest",
        `cold boot could not apply manifest: ${result.reason}`,
      );
    }

    log("catalog.hot_swap.cold_boot", `hydrated catalog ${result.version} from R2`);

    return active;
  }

  function activeVersion() {
    return active?.version ?? null;
  }

  function activePath() {
    return active?.path ?? null;
  }

  function close() {
    for (const timer of pendingDrains) {
      clearTimeout(timer);
    }

    pendingDrains.clear();

    if (active !== null) {
      try {
        active.sqlite.close();
      } catch (error) {
        log("catalog.hot_swap.close_failed", String(error));
      }

      active = null;
    }

    stableDb = null;
  }

  return {
    activePath,
    activeVersion,
    applyManifest,
    close,
    coldBoot,
    get db() {
      return db();
    },
  };
}
