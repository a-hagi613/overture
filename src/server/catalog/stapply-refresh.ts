import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";

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

export type CatalogStreamStage = "decompress" | "write";

/**
 * A streaming decompress that failed at one named stage, so a caller can tell a corrupt artifact (and a corrupt
 * artifact is fine to retry from the other object key) from a full disk (a write failure).
 */
export class CatalogStreamStageError extends Error {
  readonly stage: CatalogStreamStage;

  constructor(stage: CatalogStreamStage, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogStreamStageError";
    this.stage = stage;
  }
}

/**
 * Streams a `catalog.sqlite.zst` payload through zstd into `destinationPath`, hashing and counting the uncompressed
 * bytes as they pass so a multi-gigabyte catalog never sits in the Bun heap.
 *
 * Each stage tags its own failure: an error from the input or the decompressor is a `decompress` stage failure, an
 * error from the destination file is a `write` stage failure. `pipeline` closes every stream on any failure, so no
 * file descriptor leaks on a refused refresh.
 * @param stream The compressed snapshot from the object store.
 * @param destinationPath The file to write the uncompressed SQLite bytes to.
 * @returns The uncompressed byte count and its SHA-256 as lowercase hex.
 */
export async function decompressCatalogStreamToFile(
  stream: ReadableStream<Uint8Array>,
  destinationPath: string,
) {
  const hash = createHash("sha256");
  const decompressor = createZstdDecompress();
  const sink = createWriteStream(destinationPath);
  const source = Readable.from(stream);
  const stages: CatalogStreamStage[] = [];
  let bytes = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  source.once("error", () => {
    stages.push("decompress");
  });
  decompressor.once("error", () => {
    stages.push("decompress");
  });
  sink.once("error", () => {
    stages.push("write");
  });

  try {
    await pipeline(source, decompressor, meter, sink);
  } catch (error) {
    const stage = stages[0] ?? "decompress";

    throw new CatalogStreamStageError(
      stage,
      stage === "write"
        ? `could not write ${destinationPath}`
        : `the catalog artifact is not zstd (${destinationPath})`,
      { cause: error },
    );
  }

  return { bytes, sha256: hash.digest("hex") };
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

/**
 * The cheap header check a caller can run before reading a body: the timestamp and signature must be present, and the
 * timestamp must be a finite epoch-ms value inside the skew window. It deliberately does not check the HMAC (that
 * needs the body) or replay state (that belongs to the verifier closure).
 * @param headers The request headers.
 * @param nowMs The receiver's clock.
 * @param maxSkewMs The accepted clock difference; five minutes by default.
 * @returns The refusal reason, or null when the headers are worth streaming a body for.
 */
export function catalogRefreshHeaderRefusal(
  headers: Readonly<Record<string, string | undefined>>,
  nowMs: number,
  maxSkewMs: number = CATALOG_REFRESH_MAX_SKEW_MS,
) {
  const timestamp = headerValue(headers, CATALOG_TIMESTAMP_HEADER);

  if (timestamp === null) {
    return "missing_timestamp";
  }

  if (headerValue(headers, CATALOG_SIGNATURE_HEADER) === null) {
    return "missing_signature";
  }

  const timestampMs = Number(timestamp);

  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
    return "stale_timestamp";
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

  const verify: (input: CatalogRefreshVerifierInput) => CatalogRefreshVerdict = (input) => {
    const refusal = catalogRefreshHeaderRefusal(input.headers, input.nowMs, maxSkewMs);

    if (refusal !== null) {
      return { ok: false, reason: refusal };
    }

    const timestamp = headerValue(input.headers, CATALOG_TIMESTAMP_HEADER) ?? "";
    const signature = headerValue(input.headers, CATALOG_SIGNATURE_HEADER) ?? "";
    const timestampMs = Number(timestamp);

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

export const CATALOG_SNAPSHOT_RETENTION = 7;

export interface CatalogPublishInput {
  readonly objects: ObjectStore;
  readonly manifest: CatalogManifest;
  readonly compressedBytes: Uint8Array<ArrayBuffer>;
  readonly keepSnapshots?: number;
}

/**
 * Keeps the newest dated snapshots and deletes the rest. The names sort chronologically, so the last `keep` are the
 * newest; retention is what keeps a daily artifact inside the bucket's free tier.
 * @param objects The store.
 * @param keep How many dated snapshots to keep.
 * @returns The deleted keys.
 */
export async function pruneCatalogSnapshots(
  objects: ObjectStore,
  keep: number = CATALOG_SNAPSHOT_RETENTION,
) {
  const keys: string[] = [];

  for await (const key of objects.list(CATALOG_SNAPSHOT_PREFIX)) {
    keys.push(key);
  }

  const keepKeys = new Set(keys.toSorted().slice(-Math.max(1, keep)));
  const deleted = keys.toSorted().filter((key) => !keepKeys.has(key));

  await Promise.all(deleted.map(async (key) => await objects.delete(key)));

  return deleted;
}

/**
 * Uploads the dated snapshot, then `catalog/latest.sqlite.zst`, then the manifest, in that order, then prunes dated
 * snapshots beyond the retention window.
 * @param input The store, the manifest and the compressed snapshot.
 * @returns The keys written and the snapshots deleted.
 */
export async function publishCatalogSnapshot(input: CatalogPublishInput) {
  const snapshotKey = catalogSnapshotKey(input.manifest.version);

  await input.objects.put(snapshotKey, input.compressedBytes);
  await input.objects.put(CATALOG_LATEST_KEY, input.compressedBytes);
  await input.objects.put(
    CATALOG_MANIFEST_KEY,
    new TextEncoder().encode(`${JSON.stringify(input.manifest)}\n`),
  );

  const pruned = await pruneCatalogSnapshots(input.objects, input.keepSnapshots);

  return { snapshotKey, latestKey: CATALOG_LATEST_KEY, manifestKey: CATALOG_MANIFEST_KEY, pruned };
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

export interface ClassificationCacheRelayInput {
  readonly origin: string;
  readonly secret: string;
  readonly nowMs: number;
  readonly fetchImpl?: CatalogFetch;
}

/**
 * Reads the classification cache through the signed relay. A 404 (Day 1) or a 501 is an empty cache, not an error, so
 * the first daily run classifies cold instead of failing.
 * @param input The origin, secret and clock.
 * @returns The compressed cache bytes, or null when the cache does not exist yet.
 */
export async function fetchClassificationCacheRelay(input: ClassificationCacheRelayInput) {
  const call: CatalogFetch = input.fetchImpl ?? fetch;
  const origin = input.origin.replace(/\/+$/u, "");

  const response = await call(`${origin}/internal/catalog/classification-cache`, {
    method: "GET",
    headers: catalogRefreshHeaders(input.secret, input.nowMs, ""),
  });

  if (isMissingEndpoint(response.status) || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GET /internal/catalog/classification-cache failed: HTTP ${String(response.status)}`,
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

export interface ClassificationCacheUploadInput extends ClassificationCacheRelayInput {
  readonly compressedBytes: Uint8Array<ArrayBuffer>;
}

/**
 * Writes the Tier-2 and Tier-3 classifications back through the signed relay, signing the compressed body's SHA-256
 * exactly like the snapshot upload does.
 * @param input The origin, secret, clock and compressed cache.
 * @returns Whether the endpoint accepted the cache.
 */
export async function putClassificationCacheRelay(input: ClassificationCacheUploadInput) {
  const call: CatalogFetch = input.fetchImpl ?? fetch;
  const origin = input.origin.replace(/\/+$/u, "");

  const response = await call(`${origin}/internal/catalog/classification-cache`, {
    method: "PUT",
    headers: {
      "content-type": "application/zstd",
      ...catalogRefreshHeaders(input.secret, input.nowMs, catalogSha256(input.compressedBytes)),
    },
    body: input.compressedBytes,
  });

  if (isMissingEndpoint(response.status)) {
    return { outcome: "endpoint_missing" } satisfies { outcome: RelayOutcome };
  }

  if (!response.ok) {
    throw new Error(
      `PUT /internal/catalog/classification-cache failed: HTTP ${String(response.status)}`,
    );
  }

  return { outcome: "delivered" } satisfies { outcome: RelayOutcome };
}

/**
 * Reads the cache straight from R2 when the runner has the repository's R2 secrets.
 * @param objects The object store.
 * @param key The cache object key.
 * @returns The compressed bytes, or null.
 */
export async function readClassificationCacheObject(
  objects: Pick<ObjectStore, "get">,
  key: string,
) {
  return objects.get(key);
}

/**
 * Writes the cache straight to R2.
 * @param objects The object store.
 * @param key The cache object key.
 * @param bytes The compressed cache.
 */
export async function writeClassificationCacheObject(
  objects: Pick<ObjectStore, "put">,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  await objects.put(key, bytes);
}
