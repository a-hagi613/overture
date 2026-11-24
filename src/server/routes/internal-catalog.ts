import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  catalogRefreshHeaderRefusal,
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

class SnapshotTooLargeError extends Error {
  constructor() {
    super("the relay snapshot is over the maximum size");
    this.name = "SnapshotTooLargeError";
  }
}

async function streamSnapshotToFile(
  body: ReadableStream<Uint8Array> | null,
  path: string,
  maxBytes: number,
) {
  const hash = createHash("sha256");
  const source = body === null ? Readable.from([]) : Readable.from(body);
  const sink = createWriteStream(path);
  let bytes = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;

      if (bytes > maxBytes) {
        callback(new SnapshotTooLargeError());

        return;
      }

      hash.update(chunk);
      callback(null, chunk);
    },
  });

  await pipeline(source, meter, sink);

  return { bytes, sha256: hash.digest("hex") };
}

/**
 * The runtime side of the WS-3a catalog contract (issue #576): a signed `POST /internal/catalog/refresh` that hands
 * the manifest to the hot-swap manager, and a signed `PUT /internal/catalog/snapshot` relay for a producer without R2
 * credentials. Both verify the timestamp and HMAC before doing anything, and the verifier refuses a replayed or
 * out-of-order timestamp. A refused refresh always leaves the active catalog serving.
 *
 * The relay upload streams to a temp file beside the catalog and hands R2 a file stream twice, so neither the request
 * body nor the snapshot is ever held in memory.
 * @param deps the hot-swap manager, the R2 store, the shared secret, the clock, an optional verifier (tests) and the
 * temp directory for a relay upload
 * @returns the mounted routes
 */
export function createInternalCatalogRoutes(deps: {
  hotSwap: CatalogHotSwap;
  objects: Pick<ObjectStore, "get" | "put" | "putStream">;
  secret: string;
  clock: Clock;
  verifier?: ReturnType<typeof createCatalogRefreshVerifier>;
  stagingDir?: string;
}) {
  const { hotSwap, objects, secret, clock } = deps;
  const stagingDir = deps.stagingDir ?? tmpdir();
  const verify = deps.verifier ?? createCatalogRefreshVerifier(secret);
  const routes = new Hono();

  async function storedVersion() {
    const bytes = await objects.get(CATALOG_MANIFEST_KEY);

    if (bytes === null) {
      return null;
    }

    try {
      const parsed = catalogManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));

      return parsed.success ? parsed.data.version : null;
    } catch {
      return null;
    }
  }

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

      try {
        await objects.put(CATALOG_MANIFEST_KEY, new TextEncoder().encode(text));
      } catch (error) {
        logError("catalog.refresh.manifest", error);
      }

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
    const version = context.req.header("x-overture-catalog-version");

    if (version === undefined || !/^\d{4}-\d{2}-\d{2}$/u.test(version)) {
      return context.json({ error: API_ERRORS.invalidRequest }, 400);
    }

    const declaredLength = Number(context.req.header("content-length"));

    if (Number.isFinite(declaredLength) && declaredLength > CATALOG_SNAPSHOT_MAX_BYTES) {
      return context.json({ error: API_ERRORS.invalidRequest }, 413);
    }

    const headerRefusal = catalogRefreshHeaderRefusal(
      {
        [CATALOG_TIMESTAMP_HEADER]: context.req.header(CATALOG_TIMESTAMP_HEADER),
        [CATALOG_SIGNATURE_HEADER]: context.req.header(CATALOG_SIGNATURE_HEADER),
      },
      clock.now(),
    );

    if (headerRefusal !== null) {
      return refuse(context, headerRefusal);
    }

    try {
      await mkdir(stagingDir, { recursive: true });
    } catch (error) {
      logError("catalog.snapshot", error);

      return context.json({ error: API_ERRORS.internal }, 500);
    }

    const temporary = join(stagingDir, `catalog-snapshot-${randomUUID()}.zst.tmp`);

    try {
      let bytes: number;
      let digest: string;

      try {
        ({ bytes, sha256: digest } = await streamSnapshotToFile(
          context.req.raw.body,
          temporary,
          CATALOG_SNAPSHOT_MAX_BYTES,
        ));
      } catch (error) {
        if (error instanceof SnapshotTooLargeError) {
          return context.json({ error: API_ERRORS.invalidRequest }, 413);
        }

        throw error;
      }

      const verdict: CatalogRefreshVerdict = verify({
        body: digest,
        headers: {
          [CATALOG_TIMESTAMP_HEADER]: context.req.header(CATALOG_TIMESTAMP_HEADER),
          [CATALOG_SIGNATURE_HEADER]: context.req.header(CATALOG_SIGNATURE_HEADER),
        },
        nowMs: clock.now(),
      });

      if (!verdict.ok) {
        return refuse(context, verdict.reason);
      }

      const stored = await storedVersion();

      if (stored !== null && version < stored) {
        return context.json({ error: "stale_version" }, 409);
      }

      try {
        await objects.putStream(catalogSnapshotKey(version), Bun.file(temporary).stream());
        await objects.putStream(CATALOG_LATEST_KEY, Bun.file(temporary).stream());
      } catch (error) {
        logError("catalog.snapshot", error);

        return context.json({ error: API_ERRORS.internal }, 500);
      }

      logInfo("catalog.snapshot.stored", `archived catalog ${version} (${String(bytes)} bytes)`);

      return context.body(null, 204);
    } finally {
      await rm(temporary, { force: true });
    }
  });

  return routes;
}
