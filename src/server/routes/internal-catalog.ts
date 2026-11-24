import { Hono } from "hono";
import type { Context } from "hono";

import { API_ERRORS } from "../../shared/api-errors.ts";
import { CatalogRefreshError } from "../catalog/hot-swap.ts";
import type { CatalogHotSwap, CatalogRefreshErrorReason } from "../catalog/hot-swap.ts";
import { catalogManifestSchema } from "../catalog/stapply-daily.ts";
import type { CatalogRefreshRejection, CatalogRefreshVerdict } from "../catalog/stapply-refresh.ts";
import {
  CATALOG_LATEST_KEY,
  CATALOG_MANIFEST_KEY,
  CATALOG_SIGNATURE_HEADER,
  CATALOG_TIMESTAMP_HEADER,
  catalogSha256,
  catalogSnapshotKey,
  createCatalogRefreshVerifier,
} from "../catalog/stapply-refresh.ts";
import { readBodyCapped } from "../platform/http-body.ts";
import { logError, logInfo } from "../platform/log.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { Clock } from "../platform/ports/clock.ts";

/** The producer's signed "a new catalog is published" call (WS-3a, issue #568). */
export const CATALOG_REFRESH_PATH = "/internal/catalog/refresh";

/** The producer's fallback upload for a repository without R2 credentials (WS-3a relay path). */
export const CATALOG_SNAPSHOT_PATH = "/internal/catalog/snapshot";

/** The largest compressed snapshot the relay accepts; the manifest is tiny. */
export const CATALOG_REFRESH_MAX_BYTES = 8 * 1024;
export const CATALOG_SNAPSHOT_MAX_BYTES = 512 * 1024 * 1024;

const REJECTION_STATUS: Readonly<Record<CatalogRefreshRejection, 401 | 409>> = {
  bad_signature: 401,
  missing_signature: 401,
  missing_timestamp: 401,
  replayed_timestamp: 409,
  stale_timestamp: 401,
};

const REFRESH_ERROR_STATUS: Readonly<Record<CatalogRefreshError["reason"], 400 | 422 | 500 | 502>> =
  {
    artifact_missing: 502,
    checksum_mismatch: 422,
    decompress_failed: 422,
    integrity_check_failed: 422,
    invalid_manifest: 400,
    write_failed: 500,
  };

function refuse(context: Context, reason: CatalogRefreshRejection) {
  logInfo("catalog.refresh.refused", `refused a catalog request: ${reason}`);

  return context.json({ error: reason }, REJECTION_STATUS[reason]);
}

/**
 * The runtime side of the WS-3a catalog contract (issue #576): a signed `POST /internal/catalog/refresh` that hands
 * the manifest to the hot-swap manager, and a signed `PUT /internal/catalog/snapshot` relay for a producer without R2
 * credentials. Both verify the timestamp and HMAC before doing anything, and the verifier refuses a replayed or
 * out-of-order timestamp. A refused refresh always leaves the active catalog serving.
 * @param deps the hot-swap manager, the R2 store, the shared secret, the clock and an optional verifier (tests)
 * @returns the mounted routes
 */
export function createInternalCatalogRoutes(deps: {
  hotSwap: CatalogHotSwap;
  objects: Pick<ObjectStore, "get" | "put">;
  secret: string;
  clock: Clock;
  verifier?: ReturnType<typeof createCatalogRefreshVerifier>;
}) {
  const { hotSwap, objects, secret, clock } = deps;
  const verify = deps.verifier ?? createCatalogRefreshVerifier(secret);
  const routes = new Hono();

  routes.post(CATALOG_REFRESH_PATH, async (context) => {
    const body = await readBodyCapped(context.req.raw, CATALOG_REFRESH_MAX_BYTES);

    if (body === null) {
      return context.json({ error: API_ERRORS.invalidRequest }, 413);
    }

    const text = new TextDecoder().decode(body);

    const verdict: CatalogRefreshVerdict = verify({
      body: text,
      headers: {
        [CATALOG_TIMESTAMP_HEADER]: context.req.header(CATALOG_TIMESTAMP_HEADER),
        [CATALOG_SIGNATURE_HEADER]: context.req.header(CATALOG_SIGNATURE_HEADER),
      },
      nowMs: clock.now(),
    });

    if (!verdict.ok) {
      return refuse(context, verdict.reason);
    }

    let raw: unknown;

    try {
      raw = JSON.parse(text);
    } catch {
      return context.json({ error: API_ERRORS.invalidRequest }, 400);
    }

    const manifest = catalogManifestSchema.safeParse(raw);

    if (!manifest.success) {
      return context.json({ error: "invalid_manifest" satisfies CatalogRefreshErrorReason }, 400);
    }

    try {
      const result = await hotSwap.applyManifest(manifest.data);

      if (!result.applied) {
        return context.json(
          { status: result.reason, version: result.activeVersion },
          result.reason === "stale_version" ? 409 : 200,
        );
      }

      await objects.put(CATALOG_MANIFEST_KEY, new TextEncoder().encode(text));

      return context.json({ status: "applied", version: result.version }, 200);
    } catch (error) {
      if (error instanceof CatalogRefreshError) {
        logError("catalog.refresh", error);

        return context.json(
          { error: error.reason, message: error.message },
          REFRESH_ERROR_STATUS[error.reason],
        );
      }

      logError("catalog.refresh", error);

      return context.json({ error: API_ERRORS.internal }, 500);
    }
  });

  routes.put(CATALOG_SNAPSHOT_PATH, async (context) => {
    const bytes = await readBodyCapped(context.req.raw, CATALOG_SNAPSHOT_MAX_BYTES);

    if (bytes === null) {
      return context.json({ error: API_ERRORS.invalidRequest }, 413);
    }

    const verdict: CatalogRefreshVerdict = verify({
      body: catalogSha256(bytes),
      headers: {
        [CATALOG_TIMESTAMP_HEADER]: context.req.header(CATALOG_TIMESTAMP_HEADER),
        [CATALOG_SIGNATURE_HEADER]: context.req.header(CATALOG_SIGNATURE_HEADER),
      },
      nowMs: clock.now(),
    });

    if (!verdict.ok) {
      return refuse(context, verdict.reason);
    }

    const version = context.req.header("x-overture-catalog-version");

    if (version === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(version)) {
      return context.json({ error: API_ERRORS.invalidRequest }, 400);
    }

    try {
      await objects.put(catalogSnapshotKey(version), bytes);
      await objects.put(CATALOG_LATEST_KEY, bytes);
    } catch (error) {
      logError("catalog.snapshot", error);

      return context.json({ error: API_ERRORS.internal }, 500);
    }

    logInfo(
      "catalog.snapshot.stored",
      `archived catalog ${version} (${String(bytes.byteLength)} bytes)`,
    );

    return context.body(null, 204);
  });

  return routes;
}
