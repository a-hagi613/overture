import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";

import { createClock } from "../src/server/platform/ports/clock.ts";
import { createDiskObjectStore } from "../src/server/platform/ports/object-store.ts";
import { createR2ObjectStore } from "../src/server/platform/ports/r2-object-store.ts";
import { openCatalogDatabase } from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase } from "../src/server/platform/db/migrate.ts";
import {
  CATALOG_SIZE_BUDGET_BYTES,
  DEFAULT_SEED_FRESHNESS_DAYS,
  assertCatalogSizeWithinBudget,
  buildCatalogManifest,
  buildStapplyIngestQuery,
  isRowDrop,
  seedFreshnessCutoffMs,
  stapplyBoardSources,
  streamStapplyIngest,
} from "../src/server/catalog/stapply-daily.ts";
import {
  applyStapplyDelta,
  countPostings,
  countSupportedPostings,
  createStapplyStaging,
  dropStapplyStaging,
  markClassificationAttempted,
  selectClassificationTargets,
  stageStapplyRows,
  tagSourceSummary,
  untaggedPostingCount,
  unresolvedRoleCount,
  writePostingClassifications,
  writeStagedSkills,
} from "../src/server/catalog/stapply-delta.ts";
import { classifierCacheKey, runClassificationPipeline } from "../src/server/catalog/classifier.ts";
import {
  CLASSIFICATION_CACHE_KEY,
  decompressClassificationCache,
  emptyClassificationCache,
  mergeClassificationCache,
  parseClassificationCache,
  serializeClassificationCache,
} from "../src/server/catalog/classification-cache.ts";
import { createOnnxEmbedder } from "../src/server/catalog/embedder.ts";
import { createHaikuBatchClassifier } from "../src/server/catalog/haiku-classifier.ts";
import { ESCO_VERSION } from "../src/server/catalog/esco-taxonomy.ts";
import {
  rebuildPostingLocations,
  rebuildPostingsFts,
  seedGeoPlaces,
} from "../src/server/catalog/geo-store.ts";
import { salaryUsdUpdateSql } from "../src/server/catalog/salary-usd.ts";
import { rebuildSupplyFacets } from "../src/server/catalog/supply-facets.ts";
import { committedRoleLabels, writeTaxonomyTags } from "../src/server/catalog/taxonomy-tags.ts";
import {
  compressCatalogSnapshot,
  decompressCatalogSnapshot,
  downloadPreviousCatalog,
  fetchClassificationCacheRelay,
  notifyCatalogRefresh,
  publishCatalogSnapshot,
  putClassificationCacheRelay,
  readClassificationCacheObject,
  relayCatalogSnapshot,
  writeClassificationCacheObject,
} from "../src/server/catalog/stapply-refresh.ts";
import type { Ats } from "../src/shared/ats.ts";
import type { CatalogDatabase } from "../src/server/platform/db/client.ts";
import type { CatalogManifest, StapplyIngestRow } from "../src/server/catalog/stapply-daily.ts";
import type { AmbiguousClassificationItem } from "../src/server/catalog/haiku-classifier.ts";
import type { ClassificationCache } from "../src/server/catalog/classification-cache.ts";
import type { PostingClassificationWrite } from "../src/server/catalog/stapply-delta.ts";
import type { TaggingReport } from "../src/server/catalog/tagging-report.ts";

const DAY_MS = 86_400_000;
const STAGE_CHUNK = 5000;

const args = parseArgs({
  options: {
    "out-dir": { type: "string" },
    db: { type: "string" },
    "source-base-url": { type: "string" },
    "as-of": { type: "string" },
    "freshness-days": { type: "string" },
    "include-undated": { type: "boolean" },
    "allow-row-drop": { type: "boolean" },
    "dry-run": { type: "boolean" },
    "skip-llm": { type: "boolean" },
    "skip-embeddings": { type: "boolean" },
    "max-classify-rows": { type: "string" },
    "accept-top1": { type: "string" },
    "accept-margin": { type: "string" },
    "tag-unsupported": { type: "boolean" },
    "zstd-level": { type: "string" },
  },
  strict: true,
});

const clock = createClock();
const asOf = args.values["as-of"];
const now = asOf === undefined ? clock.now() : Date.parse(asOf);

if (Number.isNaN(now)) {
  throw new TypeError(`--as-of is not a date: ${asOf ?? ""}`);
}

const builtAt = new Date(now).toISOString();
const version = builtAt.slice(0, 10);
const freshnessDays = Number(args.values["freshness-days"] ?? String(DEFAULT_SEED_FRESHNESS_DAYS));
const includeUndated = args.values["include-undated"] === true;

if (!Number.isFinite(freshnessDays) || freshnessDays < 0) {
  throw new TypeError("--freshness-days must be zero or a positive number");
}

const maxClassifyRows = Number(args.values["max-classify-rows"] ?? "60000");

if (!Number.isInteger(maxClassifyRows) || maxClassifyRows < 0) {
  throw new TypeError("--max-classify-rows must be a non-negative integer");
}

const acceptTop1 = Number(args.values["accept-top1"] ?? "0.78");
const acceptMargin = Number(args.values["accept-margin"] ?? "0.06");

if (!Number.isFinite(acceptTop1) || !Number.isFinite(acceptMargin)) {
  throw new TypeError("--accept-top1 and --accept-margin must be numbers");
}

let lastSignedMs = 0;

function nextSignedMs() {
  lastSignedMs = Math.max(clock.now(), lastSignedMs + 1);

  return lastSignedMs;
}

const zstdLevel = Number(args.values["zstd-level"] ?? "12");

if (!Number.isInteger(zstdLevel) || zstdLevel < 1 || zstdLevel > 22) {
  throw new TypeError("--zstd-level must be an integer between 1 and 22");
}

const outDir = args.values["out-dir"];
const workDir = outDir ?? mkdtempSync(join(tmpdir(), "stapply-daily-"));
const catalogPath = join(workDir, "catalog.sqlite");

function envValue(name: string) {
  const value = Bun.env[name];

  return value === undefined || value === "" ? undefined : value;
}

function objectStoreFromEnv() {
  const accountId = envValue("R2_ACCOUNT_ID");
  const accessKeyId = envValue("R2_ACCESS_KEY_ID");
  const secretAccessKey = envValue("R2_SECRET_ACCESS_KEY");
  const bucket = envValue("R2_BUCKET_FILES");

  if (
    accountId === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined
  ) {
    return null;
  }

  return createR2ObjectStore({
    endpoint: envValue("R2_ENDPOINT") ?? `https://${accountId}.r2.cloudflarestorage.com`,
    bucket,
    accessKeyId,
    secretAccessKey,
  });
}

const objects = outDir === undefined ? objectStoreFromEnv() : createDiskObjectStore(outDir);

function haikuClassifierFromEnv() {
  const apiKey = envValue("ANTHROPIC_API_KEY");
  const maxItems = Number(envValue("CATALOG_LLM_MAX_ITEMS") ?? "0");

  if (apiKey === undefined || !Number.isInteger(maxItems) || maxItems <= 0) {
    return null;
  }

  const model = envValue("CATALOG_LLM_MODEL");
  const classify = createHaikuBatchClassifier(model === undefined ? { apiKey } : { apiKey, model });

  return async (items: readonly AmbiguousClassificationItem[]) =>
    classify(items.slice(0, maxItems));
}

function embedderFromEnv() {
  if (args.values["skip-embeddings"] === true) {
    return null;
  }

  const model = envValue("CATALOG_EMBEDDING_MODEL");

  return createOnnxEmbedder(model === undefined ? {} : { model });
}

function relayCredentials() {
  const origin = envValue("CATALOG_REFRESH_ORIGIN") ?? "https://tryoverture.com";
  const secret = envValue("CATALOG_REFRESH_SECRET");

  return secret === undefined ? null : { origin, secret };
}

async function loadClassificationCache() {
  try {
    let compressed: Uint8Array<ArrayBuffer> | null = null;

    if (objects) {
      compressed = await readClassificationCacheObject(objects, CLASSIFICATION_CACHE_KEY);
    } else {
      const relay = relayCredentials();

      if (relay) {
        compressed = await fetchClassificationCacheRelay({
          ...relay,
          nowMs: nextSignedMs(),
        });
      }
    }

    if (compressed === null) {
      return emptyClassificationCache(ESCO_VERSION);
    }

    return parseClassificationCache(decompressClassificationCache(compressed), ESCO_VERSION);
  } catch (error) {
    progress(`classification cache read failed (${String(error)}); starting cold`);

    return emptyClassificationCache(ESCO_VERSION);
  }
}

async function saveClassificationCache(cache: ClassificationCache) {
  if (args.values["dry-run"] === true) {
    return "dry_run";
  }

  const compressed = serializeClassificationCache(cache);

  if (objects !== null) {
    await writeClassificationCacheObject(objects, CLASSIFICATION_CACHE_KEY, compressed);

    return objects.kind;
  }

  const relay = relayCredentials();

  if (relay === null) {
    return "none";
  }

  const result = await putClassificationCacheRelay({
    ...relay,
    nowMs: nextSignedMs(),
    compressedBytes: compressed,
  });

  return result.outcome === "delivered" ? "relay" : "relay_endpoint_missing";
}

async function prepareCatalog() {
  const previous =
    objects === null
      ? null
      : await downloadPreviousCatalog({ objects, decompress: decompressCatalogSnapshot });

  if (previous !== null) {
    writeFileSync(catalogPath, previous.sqliteBytes);
  } else if (args.values.db !== undefined) {
    copyFileSync(args.values.db, catalogPath);
  }

  const catalog = openCatalogDatabase(catalogPath);

  catalog.db.$client.run("PRAGMA foreign_keys = ON");
  catalog.db.$client.run("PRAGMA synchronous = OFF");

  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  return { catalog, previous };
}

async function openDuck(connectionSource: string) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  mkdirSync(join(workDir, "duckdb-tmp"), { recursive: true });
  await connection.run("SET TimeZone = 'UTC'");
  await connection.run("SET memory_limit = '3GB'");
  await connection.run("SET threads = 4");
  await connection.run(
    `SET temp_directory = '${join(workDir, "duckdb-tmp").replaceAll("'", "''")}'`,
  );

  if (connectionSource.startsWith("http")) {
    await connection.run("INSTALL httpfs; LOAD httpfs;");
  }

  return connection;
}

function integrityCheck(catalogDb: CatalogDatabase) {
  const rows = z
    .array(z.record(z.string(), z.unknown()))
    .parse(catalogDb.$client.query("PRAGMA integrity_check").all());

  const verdict = rows.map((row) => Object.values(row).join(" ")).join("; ");

  if (verdict !== "ok") {
    throw new Error(`catalog.sqlite failed PRAGMA integrity_check: ${verdict}`);
  }

  return verdict;
}

function progress(message: string) {
  process.stderr.write(`stapply-daily: ${message}\n`);
}

async function main() {
  const started = performance.now();
  const boards = stapplyBoardSources(args.values["source-base-url"]);
  const connection = await openDuck(boards[0]?.url ?? "");
  const { catalog, previous } = await prepareCatalog();
  const seed = previous === null && args.values.db === undefined;

  progress(
    `${seed ? "seed" : "delta"} run against ${String(previous?.manifest.rowCount ?? 0)} existing rows`,
  );

  const geo = seedGeoPlaces(catalog.db);

  progress(
    `geo_places: ${String(geo.places)} places (${String(geo.cities)} cities) from dataset ${geo.datasetVersion}`,
  );

  const freshnessCutoffMs =
    seed && freshnessDays > 0 ? seedFreshnessCutoffMs(now, freshnessDays) : null;

  createStapplyStaging(catalog.db);

  let buffer: StapplyIngestRow[] = [];

  const flush = () => {
    if (buffer.length > 0) {
      stageStapplyRows(catalog.db, buffer);
      buffer = [];
    }
  };

  progress("streaming the 28 boards through DuckDB, one board at a time");

  const perBoard: { ats: Ats; rows: number }[] = [];
  const totals = { staged: 0, skipped: 0 };

  const stageBoard: (index: number) => Promise<void> = async (index) => {
    const board = boards[index];

    if (board === undefined) {
      return;
    }

    const boardStarted = performance.now();

    const streamed = await streamStapplyIngest({
      connection,
      sql: buildStapplyIngestQuery({ boards: [board], freshnessCutoffMs, includeUndated }),
      onRow: (row) => {
        buffer.push(row);

        if (buffer.length >= STAGE_CHUNK) {
          flush();
        }
      },
    });

    flush();

    totals.staged += streamed.rows;
    totals.skipped += streamed.skipped;

    progress(
      `${board.ats}: ${String(streamed.rows)} rows in ${String(Math.round(performance.now() - boardStarted))} ms`,
    );

    if (streamed.rows > 0) {
      perBoard.push({ ats: board.ats, rows: streamed.rows });
    }

    await stageBoard(index + 1);
  };

  await stageBoard(0);

  progress(
    `staged ${String(totals.staged)} rows (${String(totals.skipped)} unusable) in ${String(Math.round(performance.now() - started))} ms`,
  );

  const delta = applyStapplyDelta(catalog.db, {
    now,
    boards: perBoard,
    pruneClosedBeforeMs: now - 30 * DAY_MS,
    tagSupportedOnly: args.values["tag-unsupported"] !== true,
  });

  progress(
    `delta: ${String(delta.inserted)} new, ${String(delta.updated)} changed, ${String(delta.closed)} closed, ${String(delta.pruned)} pruned, ${String(delta.tagged)} tagged`,
  );

  const rowCount = countPostings(catalog.db);
  const supportedCount = countSupportedPostings(catalog.db);

  const skillsTagged = writeStagedSkills(catalog.db);

  progress(`staged skills: ${String(skillsTagged)} postings`);

  const targets = selectClassificationTargets(catalog.db, maxClassifyRows);
  const byKey = new Map<string, { item: AmbiguousClassificationItem; postingIds: string[] }>();

  for (const target of targets) {
    const key = classifierCacheKey(target.title, target.department);

    const entry = byKey.get(key) ?? {
      item: {
        key,
        title: target.title,
        department: target.department,
        jobCategory: target.jobCategory,
        language: target.language,
      },
      postingIds: [],
    };

    entry.postingIds.push(target.id);
    byKey.set(key, entry);
  }

  const items = [...byKey.values()].map((entry) => entry.item);
  const cache = await loadClassificationCache();
  const embedder = embedderFromEnv();
  const haiku = args.values["skip-llm"] === true ? null : haikuClassifierFromEnv();

  progress(
    `classifying ${String(items.length)} unique title/department pairs for ${String(targets.length)} postings`,
  );

  const pipeline = await runClassificationPipeline({
    cache,
    crossBoardDupesRemoved: delta.duplicates,
    embedder,
    haiku,
    items,
    thresholds: {
      acceptMargin,
      acceptTop1,
      escoMin: 0.74,
      secondaryMin: 0.74,
      strongTop1: 0.86,
    },
    totalPostings: rowCount,
  });

  const writes: PostingClassificationWrite[] = [];
  const unresolvedIds: string[] = [];

  for (const [key, entry] of byKey) {
    const classification = pipeline.results.get(key);

    if (classification === undefined) {
      unresolvedIds.push(...entry.postingIds);
      continue;
    }

    for (const postingId of entry.postingIds) {
      writes.push({ classification, postingId, skillRequirements: [] });
    }
  }

  writePostingClassifications(catalog.db, writes, now);
  markClassificationAttempted(catalog.db, unresolvedIds, now);

  const cacheMode = await saveClassificationCache(
    mergeClassificationCache(cache, pipeline.updates),
  );

  const taggingReport: TaggingReport = {
    ...pipeline.report,
    cross_board_dupes_removed: delta.duplicates,
    still_untagged: untaggedPostingCount(catalog.db),
    total_postings: rowCount,
    unique_title_dept_pairs: items.length,
  };

  progress(
    `classification: ${String(taggingReport.tier1_esco_rules)} rules, ${String(taggingReport.tier2_embeddings)} embeddings, ${String(taggingReport.tier3_haiku_resolved)} haiku; ${String(taggingReport.still_untagged)} still untagged; cache ${cacheMode}`,
  );

  const taxonomyTags = writeTaxonomyTags(catalog.db, committedRoleLabels());

  progress(
    `role taxonomy: ${String(taxonomyTags.labelled)} AI labelled, ${String(taxonomyTags.categoryOnly)} AI category only, ${String(taxonomyTags.bridged)} bridged, ${String(taxonomyTags.junk)} junk, ${String(taxonomyTags.untagged)} untagged`,
  );

  rebuildSupplyFacets(catalog.db);

  progress("supply facets rebuilt");

  const unresolved = unresolvedRoleCount(catalog.db);
  const tagSources = tagSourceSummary(catalog.db);

  const salaryUpdate = salaryUsdUpdateSql();

  if (salaryUpdate !== null) {
    catalog.db.$client.run(salaryUpdate);
  }

  const locationRows = rebuildPostingLocations(catalog.db);
  const ftsRows = rebuildPostingsFts(catalog.db);

  progress(`derived: ${String(locationRows)} posting_locations rows, ${String(ftsRows)} FTS rows`);

  dropStapplyStaging(catalog.db);

  catalog.db.$client.run("PRAGMA optimize");
  catalog.db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  catalog.db.$client.run("PRAGMA journal_mode = DELETE");
  catalog.db.$client.run("VACUUM");
  const integrity = integrityCheck(catalog.db);
  catalog.sqlite.close();

  progress(
    `integrity ${integrity}; compressing ${String(rowCount)} rows at zstd level ${String(zstdLevel)}`,
  );

  const sqliteBytesWithinBudget = assertCatalogSizeWithinBudget(statSync(catalogPath).size);
  const sqliteBytes = new Uint8Array(readFileSync(catalogPath));
  const compressedBytes = compressCatalogSnapshot(sqliteBytes, zstdLevel);

  const manifest = buildCatalogManifest({
    version,
    builtAt,
    sqliteBytes,
    rowCount,
    supportedCount,
    tagging: taggingReport,
  });

  if (
    isRowDrop(previous?.manifest.rowCount ?? null, rowCount, args.values["allow-row-drop"] === true)
  ) {
    throw new Error(
      `refusing to publish ${String(rowCount)} rows against the previous ${String(previous?.manifest.rowCount ?? 0)}; pass --allow-row-drop after checking upstream`,
    );
  }

  const publish = await publishArtifacts(manifest, compressedBytes);

  progress(
    `published ${publish.mode} (${String(compressedBytes.byteLength)} bytes, ${String(publish.pruned)} old snapshots pruned)`,
  );

  const perBoardSummary: Partial<Record<Ats, number>> = {};

  for (const board of perBoard) {
    perBoardSummary[board.ats] = board.rows;
  }

  return {
    outcome: "published",
    version,
    builtAt,
    mode: objects === null ? "relay" : objects.kind,
    publish: publish.mode,
    prunedSnapshots: publish.pruned,
    seed,
    freshnessDays: freshnessCutoffMs === null ? null : freshnessDays,
    includeUndated,
    sqlite: {
      path: catalogPath,
      bytes: sqliteBytesWithinBudget,
      zstdBytes: compressedBytes.byteLength,
      budgetBytes: CATALOG_SIZE_BUDGET_BYTES,
    },
    geo,
    derived: { ftsRows, postingLocations: locationRows },
    manifest: { ...manifest, zstdBytes: compressedBytes.byteLength },
    previousRows: previous?.manifest.rowCount ?? null,
    rows: {
      ingested: delta.ingested,
      inserted: delta.inserted,
      updated: delta.updated,
      reopened: delta.reopened,
      unchanged: delta.unchanged,
      closed: delta.closed,
      pruned: delta.pruned,
      tagged: delta.tagged,
      skipped: totals.skipped,
      rowCount,
      supportedCount,
      unresolved,
      skillsTagged,
    },
    tagging: taggingReport,
    taxonomyTags,
    classificationCache: cacheMode,
    perBoard: perBoardSummary,
    tagSources,
    integrity,
    elapsedMs: Math.round(performance.now() - started),
  };
}

async function publishArtifacts(
  manifest: CatalogManifest,
  compressedBytes: Uint8Array<ArrayBuffer>,
) {
  if (args.values["dry-run"] === true) {
    return { mode: "dry_run", pruned: 0 };
  }

  const origin = envValue("CATALOG_REFRESH_ORIGIN") ?? "https://tryoverture.com";
  const secret = envValue("CATALOG_REFRESH_SECRET");

  if (objects !== null) {
    const published = await publishCatalogSnapshot({ objects, manifest, compressedBytes });

    if (secret === undefined) {
      return { mode: objects.kind, pruned: published.pruned.length };
    }

    const notified = await notifyCatalogRefresh({
      origin,
      secret,
      manifest,
      nowMs: nextSignedMs(),
    });

    return {
      mode:
        notified.outcome === "delivered"
          ? `${objects.kind}+refresh`
          : `${objects.kind}+refresh_endpoint_missing`,
      pruned: published.pruned.length,
    };
  }

  if (secret === undefined) {
    throw new Error(
      "no publish target: set the R2 repository secrets or CATALOG_REFRESH_SECRET (docs/DEPLOY.md, the daily catalog ETL)",
    );
  }

  const relay = await relayCatalogSnapshot({
    origin,
    secret,
    manifest,
    compressedBytes,
    nowMs: nextSignedMs(),
  });

  return {
    mode: relay.outcome === "delivered" ? "relay" : "relay_endpoint_missing",
    pruned: 0,
  };
}

const summary = await main();

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
