import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createGunzip, createGzip } from "node:zlib";
import { once } from "node:events";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { request } from "node:https";

import { createDiskObjectStore } from "../src/server/platform/ports/object-store.ts";
import { createR2ObjectStore } from "../src/server/platform/ports/r2-object-store.ts";
import {
  WORKABLE_MANIFEST_KEY,
  WORKABLE_TARGETS_KEY,
  streamWorkablePass,
  workableManifestSchema,
  workableTargetsSchema,
} from "../src/server/catalog/workable-feed.ts";
import { committedRoleLabels } from "../src/server/catalog/taxonomy-tags.ts";

import type { IncomingMessage } from "node:http";
import type { ObjectStore } from "../src/server/platform/ports/object-store.ts";
import type { WorkableManifest } from "../src/server/catalog/workable-feed.ts";

const DEFAULT_FEED_URL = "https://www.workable.com/boards/workable.xml";
const ROW_DROP_SHARE = 0.2;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const args = parseArgs({
  options: {
    feed: { type: "string" },
    "feed-url": { type: "string" },
    targets: { type: "string" },
    "out-dir": { type: "string" },
    "as-of": { type: "string" },
    "allow-row-drop": { type: "boolean" },
  },
  strict: true,
});

const feedUrl = args.values["feed-url"];
const feedPath = args.values.feed;

if (feedUrl !== undefined && feedPath !== undefined) {
  throw new Error("pass either --feed or --feed-url, not both");
}

if (feedUrl !== undefined && Bun.env.WORKABLE_LIVE_FETCH !== "1") {
  throw new Error("live Workable fetch needs WORKABLE_LIVE_FETCH=1 (the scheduled Action only)");
}

const outDir = args.values["out-dir"];

const objects: ObjectStore =
  outDir === undefined ? createObjectStoreFromEnv() : createDiskObjectStore(outDir);

if (outDir !== undefined) {
  mkdirSync(outDir, { recursive: true });
}

const fetchedAtText = args.values["as-of"];

const fetchedAtMs =
  fetchedAtText === undefined
    ? performance.timeOrigin + performance.now()
    : Date.parse(fetchedAtText);

if (Number.isNaN(fetchedAtMs)) {
  throw new TypeError(`--as-of is not a date: ${fetchedAtText ?? ""}`);
}

const fetchedAt = new Date(fetchedAtMs).toISOString();
const datePart = fetchedAt.slice(0, 10);
const snapshotKey = `workable/${datePart}.jsonl.gz`;
const roleLabels = committedRoleLabels();
const baselineRss = process.memoryUsage.rss();
const startedAt = performance.now();

function createObjectStoreFromEnv() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_FILES, R2_ENDPOINT } =
    Bun.env;

  if (
    R2_ACCOUNT_ID === undefined ||
    R2_ACCESS_KEY_ID === undefined ||
    R2_SECRET_ACCESS_KEY === undefined ||
    R2_BUCKET_FILES === undefined
  ) {
    throw new Error("the Workable pass needs R2 credentials or --out-dir");
  }

  return createR2ObjectStore({
    endpoint: R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: R2_BUCKET_FILES,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
}

async function readJson(key: string) {
  const bytes = await objects.get(key);

  if (bytes === null) {
    return null;
  }

  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));

  return value;
}

async function readTargets() {
  const targetPath = args.values.targets;

  if (targetPath !== undefined) {
    return workableTargetsSchema.parse(JSON.parse(readFileSync(targetPath, "utf8")));
  }

  const remote = await readJson(WORKABLE_TARGETS_KEY);

  if (remote === null) {
    return workableTargetsSchema.parse({
      version: 1,
      generatedAt: fetchedAt,
      roles: [],
      locations: [],
      seniorities: [],
      workplaces: [],
      employmentTypes: [],
    });
  }

  return workableTargetsSchema.parse(remote);
}

async function readPreviousManifest() {
  const raw = await readJson(WORKABLE_MANIFEST_KEY);

  return raw === null ? null : workableManifestSchema.parse(raw);
}

type PreviousManifest = WorkableManifest | null;

async function liveFeed(url: string, ifModifiedSince: string | null) {
  const message = await new Promise<IncomingMessage>((resolve, reject) => {
    const headers =
      ifModifiedSince === null
        ? { "Accept-Encoding": "gzip" }
        : { "Accept-Encoding": "gzip", "If-Modified-Since": ifModifiedSince };

    const req = request(url, { headers }, (response) => {
      const status = response.statusCode ?? 0;
      const { location } = response.headers;

      if (REDIRECT_STATUSES.has(status) && location !== undefined) {
        response.resume();
        void (async () => {
          try {
            resolve(await liveFeed(new URL(location, url).href, ifModifiedSince));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })();

        return;
      }

      resolve(response);
    });

    req.on("error", reject);
    req.end();
  });

  return message;
}

async function openFeed(previous: PreviousManifest) {
  if (feedPath !== undefined) {
    const file = createReadStream(feedPath);

    const body: AsyncIterable<Uint8Array> = feedPath.endsWith(".gz")
      ? file.pipe(createGunzip())
      : file;

    return { body, lastModified: null, notModified: false };
  }

  const url = feedUrl ?? DEFAULT_FEED_URL;
  const response = await liveFeed(url, previous?.sourceLastModified ?? null);
  const status = response.statusCode ?? 0;

  if (status === 304) {
    response.resume();

    return {
      body: null,
      lastModified: response.headers["last-modified"] ?? null,
      notModified: true,
    };
  }

  if (status !== 200) {
    response.resume();
    throw new Error(`GET ${url} failed: ${String(status)}`);
  }

  const encoding = response.headers["content-encoding"] ?? "";

  const body: AsyncIterable<Uint8Array> =
    encoding === "gzip" ? response.pipe(createGunzip()) : response;

  return {
    body,
    lastModified: response.headers["last-modified"] ?? null,
    notModified: false,
  };
}

interface WorkablePassSummary {
  outcome: string;
  fetchedAt: string;
  snapshot: string | null;
  sourceLastModified?: string | null;
  feedJobs?: number;
  distinctReferences?: number;
  duplicates?: number;
  rows?: number;
  previousRows?: number | null;
  bytes?: number;
  contentHash?: string;
  elapsedMs?: number;
  baselineRssMB?: number;
  peakRssMB?: number;
  rssDeltaMB?: number;
}

function print(summary: WorkablePassSummary) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function main() {
  const targets = await readTargets();
  const previous = await readPreviousManifest();

  if (targets.roles.length === 0) {
    print({ outcome: "no_targets", fetchedAt, snapshot: snapshotKey });

    return;
  }

  const feed = await openFeed(previous);

  if (feed.notModified || feed.body === null) {
    print({
      outcome: "not_modified",
      fetchedAt,
      snapshot: previous?.snapshot ?? null,
      sourceLastModified: feed.lastModified,
    });

    return;
  }

  const tempDir = outDir ?? Bun.env.RUNNER_TEMP ?? mkdtempSync(join(tmpdir(), "workable-pass-"));

  const tempPath = join(tempDir, `workable-${datePart}-${String(process.pid)}.jsonl.gz`);

  const gzipped = createWriteStream(tempPath);
  const gzip = createGzip({ level: 9 });
  const hash = createHash("sha256");

  gzip.pipe(gzipped);

  const stats = await streamWorkablePass({
    source: feed.body,
    targets,
    labels: roleLabels,
    onMatch: async (_row, line) => {
      hash.update(line);

      if (!gzip.write(line)) {
        await once(gzip, "drain");
      }
    },
  });

  gzip.end();

  await once(gzipped, "finish");

  const contentHash = hash.digest("hex");
  const snapshotBytes = readFileSync(tempPath);
  const elapsedMs = performance.now() - startedAt;
  const peakRss = Math.max(stats.peakRssBytes, process.memoryUsage.rss());

  const dropped =
    previous !== null && previous.rows > 0 && stats.matched < previous.rows * (1 - ROW_DROP_SHARE);

  const summary = {
    outcome: dropped && args.values["allow-row-drop"] !== true ? "row_drop" : "written",
    fetchedAt,
    snapshot: snapshotKey,
    sourceLastModified: feed.lastModified,
    feedJobs: stats.feedJobs,
    distinctReferences: stats.distinctReferences,
    duplicates: stats.duplicates,
    rows: stats.matched,
    previousRows: previous?.rows ?? null,
    bytes: snapshotBytes.byteLength,
    contentHash,
    elapsedMs: Math.round(elapsedMs),
    baselineRssMB: Number((baselineRss / 1024 / 1024).toFixed(1)),
    peakRssMB: Number((peakRss / 1024 / 1024).toFixed(1)),
    rssDeltaMB: Number(((peakRss - baselineRss) / 1024 / 1024).toFixed(1)),
  };

  if (summary.outcome === "row_drop") {
    print(summary);
    process.exitCode = 1;

    return;
  }

  const manifest = workableManifestSchema.parse({
    version: 1,
    snapshot: snapshotKey,
    fetchedAt,
    sourceLastModified: feed.lastModified,
    feedJobs: stats.feedJobs,
    distinctReferences: stats.distinctReferences,
    duplicates: stats.duplicates,
    rows: stats.matched,
    bytes: snapshotBytes.byteLength,
    contentHash,
  });

  await objects.put(snapshotKey, snapshotBytes);
  await objects.put(
    WORKABLE_MANIFEST_KEY,
    new TextEncoder().encode(`${JSON.stringify(manifest)}\n`),
  );

  print(summary);
}

await main();
