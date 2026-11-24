import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { CatalogManifest } from "./stapply-daily.ts";

import { catalogManifestSchema } from "./stapply-daily.ts";

/**
 * The runtime's pointer object, written last so a reader never sees a manifest for a snapshot that is not there.
 */
export const CATALOG_MANIFEST_KEY = "catalog/latest.json";

/**
 * The snapshot the runtime hot-swaps, `catalog/latest.sqlite.zst` in the `WS-8` contract.
 */
export const CATALOG_LATEST_KEY = "catalog/latest.sqlite.zst";

/**
 * The dated snapshot prefix, one immutable object per day.
 */
export const CATALOG_SNAPSHOT_PREFIX = "catalog/snapshots";

/**
 * The header carrying the request's epoch milliseconds.
 */
export const CATALOG_TIMESTAMP_HEADER = "x-overture-catalog-timestamp";

/**
 * The header carrying the HMAC-SHA256 signature, lowercase hex.
 */
export const CATALOG_SIGNATURE_HEADER = "x-overture-catalog-signature";

/**
 * How far a signed request's timestamp may be from the receiver's clock.
 */
export const CATALOG_REFRESH_MAX_SKEW_MS = 5 * 60_000;

/**
 * @param version A `YYYY-MM-DD` snapshot version.
 * @returns The dated snapshot object key.
 */
export function catalogSnapshotKey(version: string) {
  return `${CATALOG_SNAPSHOT_PREFIX}/${version}.sqlite.zst`;
}

/**
 * Compresses the built `catalog.sqlite` for publication. The manifest hashes the uncompressed bytes, so the runtime
 * verifies what it actually opens.
 * @param sqliteBytes The built catalog file.
 * @param level The zstd level, 19 by default.
 * @returns The compressed bytes.
 */
export function compressCatalogSnapshot(sqliteBytes: Uint8Array<ArrayBuffer>, level = 19) {
  return new Uint8Array(Bun.zstdCompressSync(sqliteBytes, { level }));
}

/**
 * @param compressedBytes A `catalog.sqlite.zst` payload.
 * @returns The uncompressed SQLite bytes.
 */
export function decompressCatalogSnapshot(compressedBytes: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(Bun.zstdDecompressSync(compressedBytes));
}

/**
 * @param bytes The uncompressed catalog file.
 * @returns Its SHA-256 as lowercase hex.
 */
export function catalogSha256(bytes: Uint8Array<ArrayBuffer>) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The signature the runtime verifies: HMAC-SHA256 over `<timestamp>\n<body>`.
 * @param secret The shared `CATALOG_REFRESH_SECRET`.
 * @param timestamp The epoch-millisecond timestamp sent in the header.
 * @param body The exact request body, or the body's SHA-256 for a binary upload.
 * @returns Lowercase hex.
 */
export function catalogRefreshSignature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
}

/**
 * @param secret The shared secret.
 * @param timestampMs The epoch-millisecond timestamp.
 * @param body The exact body, or its SHA-256.
 * @returns The two signed-request headers.
 */
export function catalogRefreshHeaders(secret: string, timestampMs: number, body: string) {
  const timestamp = String(Math.trunc(timestampMs));

  return {
    [CATALOG_TIMESTAMP_HEADER]: timestamp,
    [CATALOG_SIGNATURE_HEADER]: catalogRefreshSignature(secret, timestamp, body),
  } satisfies Record<string, string>;
}

function headerValue(headers: Readonly<Record<string, string | undefined>>, name: string) {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return value ?? null;
    }
  }

  return null;
}

export type CatalogRefreshVerdict =
  | { readonly ok: true; readonly timestampMs: number }
  | { readonly ok: false; readonly reason: CatalogRefreshRejection };

export type CatalogRefreshRejection =
  | "missing_timestamp"
  | "missing_signature"
  | "stale_timestamp"
  | "replayed_timestamp"
  | "bad_signature";

export interface CatalogRefreshVerifierInput {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
  readonly nowMs: number;
}

/**
 * The runtime side of the contract (`WS-8`'s `POST /internal/catalog/refresh`). It rejects a missing or malformed
 * signature, a timestamp outside the skew window, and any timestamp it has already accepted, so a captured request
 * cannot be replayed.
 * @param secret The shared secret.
 * @param maxSkewMs The accepted clock difference; five minutes by default.
 * @returns A verifier whose closure remembers the newest accepted timestamp.
 */
export function createCatalogRefreshVerifier(
  secret: string,
  maxSkewMs: number = CATALOG_REFRESH_MAX_SKEW_MS,
) {
  let lastAcceptedMs = Number.NEGATIVE_INFINITY;

  const verify = (input: CatalogRefreshVerifierInput) => {
    const timestamp = headerValue(input.headers, CATALOG_TIMESTAMP_HEADER);
    const signature = headerValue(input.headers, CATALOG_SIGNATURE_HEADER);

    if (timestamp === null) {
      return { ok: false, reason: "missing_timestamp" };
    }

    if (signature === null) {
      return { ok: false, reason: "missing_signature" };
    }

    const timestampMs = Number(timestamp);

    if (!Number.isFinite(timestampMs) || Math.abs(input.nowMs - timestampMs) > maxSkewMs) {
      return { ok: false, reason: "stale_timestamp" };
    }

    if (timestampMs <= lastAcceptedMs) {
      return { ok: false, reason: "replayed_timestamp" };
    }

    const expected = catalogRefreshSignature(secret, timestamp, input.body);
    const given = Buffer.from(signature.toLowerCase(), "hex");
    const wanted = Buffer.from(expected, "hex");

    if (given.byteLength !== wanted.byteLength || !timingSafeEqual(given, wanted)) {
      return { ok: false, reason: "bad_signature" };
    }

    lastAcceptedMs = timestampMs;

    return { ok: true, timestampMs };
  };

  return verify;
}

export type CatalogFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface CatalogPublishInput {
  readonly objects: ObjectStore;
  readonly manifest: CatalogManifest;
  readonly compressedBytes: Uint8Array<ArrayBuffer>;
}

/**
 * Uploads the dated snapshot, then `catalog/latest.sqlite.zst`, then the manifest, in that order.
 * @param input The store, the manifest and the compressed snapshot.
 * @returns The keys written.
 */
export async function publishCatalogSnapshot(input: CatalogPublishInput) {
  const snapshotKey = catalogSnapshotKey(input.manifest.version);

  await input.objects.put(snapshotKey, input.compressedBytes);
  await input.objects.put(CATALOG_LATEST_KEY, input.compressedBytes);
  await input.objects.put(
    CATALOG_MANIFEST_KEY,
    new TextEncoder().encode(`${JSON.stringify(input.manifest)}\n`),
  );

  return { snapshotKey, latestKey: CATALOG_LATEST_KEY, manifestKey: CATALOG_MANIFEST_KEY };
}

/**
 * Reads the previous manifest from the store so the run can preserve tags and run the row-drop guard.
 * @param objects The store.
 * @returns The parsed manifest, or null when this is the first run.
 */
export async function readPreviousCatalogManifest(objects: ObjectStore) {
  const bytes = await objects.get(CATALOG_MANIFEST_KEY);

  if (bytes === null) {
    return null;
  }

  const parsed = catalogManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));

  return parsed.success ? parsed.data : null;
}

export interface CatalogDownloadInput {
  readonly objects: ObjectStore;
  readonly decompress: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

/**
 * Downloads and verifies `catalog/latest.sqlite.zst` against the manifest's SHA-256.
 * @param input The store and the decompressor.
 * @returns The verified SQLite bytes, or null when there is no previous snapshot.
 */
export async function downloadPreviousCatalog(input: CatalogDownloadInput) {
  const manifest = await readPreviousCatalogManifest(input.objects);

  if (manifest === null) {
    return null;
  }

  const compressed = await input.objects.get(CATALOG_LATEST_KEY);

  if (compressed === null) {
    return null;
  }

  const sqliteBytes = input.decompress(compressed);
  const actual = catalogSha256(sqliteBytes);

  if (actual !== manifest.sha256) {
    throw new Error(
      `catalog/latest.sqlite.zst does not match its manifest: expected ${manifest.sha256}, got ${actual}`,
    );
  }

  return { manifest, sqliteBytes };
}

export type RelayOutcome = "delivered" | "endpoint_missing";

export interface CatalogNotifyInput {
  readonly origin: string;
  readonly secret: string;
  readonly manifest: CatalogManifest;
  readonly nowMs: number;
  readonly fetchImpl?: CatalogFetch;
}

function isMissingEndpoint(status: number) {
  return status === 404 || status === 501;
}

/**
 * Asks the runtime to hot-swap the snapshot the manifest names. It is sent after an R2 upload and again after the
 * relay upload, always signed over the exact JSON body.
 * @param input The origin, secret, manifest and clock.
 * @returns Whether the runtime endpoint accepted the request.
 */
export async function notifyCatalogRefresh(input: CatalogNotifyInput) {
  const call: CatalogFetch = input.fetchImpl ?? fetch;
  const origin = input.origin.replace(/\/+$/u, "");
  const body = `${JSON.stringify(input.manifest)}\n`;

  const response = await call(`${origin}/internal/catalog/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...catalogRefreshHeaders(input.secret, input.nowMs, body),
    },
    body,
  });

  if (isMissingEndpoint(response.status)) {
    return { outcome: "endpoint_missing" } satisfies { outcome: RelayOutcome };
  }

  if (!response.ok) {
    throw new Error(`POST /internal/catalog/refresh failed: HTTP ${String(response.status)}`);
  }

  return { outcome: "delivered" } satisfies { outcome: RelayOutcome };
}

export interface CatalogRelayInput {
  readonly origin: string;
  readonly secret: string;
  readonly manifest: CatalogManifest;
  readonly compressedBytes: Uint8Array<ArrayBuffer>;
  readonly nowMs: number;
  readonly fetchImpl?: CatalogFetch;
}

/**
 * The relay path for a repository without R2 credentials. The compressed snapshot is uploaded to the app, which
 * archives it to R2 with its own credentials, and the signed refresh request then asks for the hot swap. A 404 or 501
 * means the runtime endpoint has not shipped yet, which is reported rather than treated as an outage.
 *
 * Both requests sign `<timestamp>\n<body>`: the exact JSON for the refresh request, and the compressed body's SHA-256
 * digest for the binary upload, so the HMAC never has to hash a large payload twice. The refresh timestamp is one
 * millisecond later than the upload's because the verifier rejects a timestamp it has already accepted.
 * @param input The origin, secret, artifacts and clock.
 * @returns Whether the endpoint accepted the snapshot.
 */
export async function relayCatalogSnapshot(input: CatalogRelayInput) {
  const call: CatalogFetch = input.fetchImpl ?? fetch;
  const origin = input.origin.replace(/\/+$/u, "");

  const snapshotHeaders = {
    "content-type": "application/zstd",
    "x-overture-catalog-version": input.manifest.version,
    "x-overture-catalog-sha256": input.manifest.sha256,
    ...catalogRefreshHeaders(input.secret, input.nowMs, catalogSha256(input.compressedBytes)),
  };

  const upload = await call(`${origin}/internal/catalog/snapshot`, {
    method: "PUT",
    headers: snapshotHeaders,
    body: input.compressedBytes,
  });

  if (isMissingEndpoint(upload.status)) {
    return { outcome: "endpoint_missing" } satisfies { outcome: RelayOutcome };
  }

  if (!upload.ok) {
    throw new Error(`PUT /internal/catalog/snapshot failed: HTTP ${String(upload.status)}`);
  }

  const notify = { origin, secret: input.secret, manifest: input.manifest, nowMs: input.nowMs + 1 };

  return input.fetchImpl === undefined
    ? notifyCatalogRefresh(notify)
    : notifyCatalogRefresh({ ...notify, fetchImpl: input.fetchImpl });
}
