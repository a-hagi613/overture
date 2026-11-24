import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  stageStapplyRows,
  tagSourceSummary,
  unresolvedRoleCount,
} from "../src/server/catalog/stapply-delta.ts";
import {
  STAPPLY_LLM_BATCH_SIZE,
  STAPPLY_LLM_MAX_ROWS,
  createAnthropicStapplyClassifier,
  runStapplyLlmTagging,
} from "../src/server/catalog/stapply-tagging.ts";
import {
  compressCatalogSnapshot,
  decompressCatalogSnapshot,
  downloadPreviousCatalog,
  publishCatalogSnapshot,
  relayCatalogSnapshot,
} from "../src/server/catalog/stapply-refresh.ts";
import type { Ats } from "../src/shared/ats.ts";
import type { CatalogDatabase } from "../src/server/platform/db/client.ts";
import type { CatalogManifest, StapplyIngestRow } from "../src/server/catalog/stapply-daily.ts";

const DAY_MS = 86_400_000;
const STAGE_CHUNK = 5000;

const args = parseArgs({
  options: {
    "out-dir": { type: "string" },
    db: { type: "string" },
    "source-base-url": { type: "string" },
    "as-of": { type: "string" },
    "freshness-days": { type: "string" },
    "allow-row-drop": { type: "boolean" },
    "dry-run": { type: "boolean" },
    "skip-llm": { type: "boolean" },
    "max-llm-rows": { type: "string" },
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
const freshnessDays = Number(args.values["freshness-days"] ?? "30");

if (!Number.isFinite(freshnessDays) || freshnessDays < 0) {
  throw new TypeError("--freshness-days must be zero or a positive number");
}

const maxLlmRows = Number(args.values["max-llm-rows"] ?? String(STAPPLY_LLM_MAX_ROWS));

if (!Number.isInteger(maxLlmRows) || maxLlmRows < 0) {
  throw new TypeError("--max-llm-rows must be a non-negative integer");
}

const zstdLevel = Number(args.values["zstd-level"] ?? "19");

if (!Number.isInteger(zstdLevel) || zstdLevel < 1 || zstdLevel > 22) {
  throw new TypeError("--zstd-level must be an integer between 1 and 22");
}

const outDir = args.values["out-dir"];
const workDir = outDir ?? mkdtempSync(join(tmpdir(), "stapply-daily-"));
const catalogPath = join(workDir, "catalog.sqlite");

function objectStoreFromEnv() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_FILES, R2_ENDPOINT } =
    Bun.env;

  if (
    R2_ACCOUNT_ID === undefined ||
    R2_ACCESS_KEY_ID === undefined ||
    R2_SECRET_ACCESS_KEY === undefined ||
    R2_BUCKET_FILES === undefined
  ) {
    return null;
  }

  return createR2ObjectStore({
    endpoint: R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: R2_BUCKET_FILES,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  });
}

const objects = outDir === undefined ? objectStoreFromEnv() : createDiskObjectStore(outDir);

function classifierFromEnv() {
  const apiKey = Bun.env.ANTHROPIC_API_KEY;

  if (apiKey === undefined) {
    return null;
  }

  const model = Bun.env.CATALOG_LLM_MODEL;

  return createAnthropicStapplyClassifier(
    model === undefined || model === "" ? { apiKey } : { apiKey, model },
  );
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

  if (previous === null && args.values.db === undefined) {
    migrateCatalogDatabase(catalog.db, "drizzle-catalog");
  }

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

  const freshnessCutoffMs = seed && freshnessDays > 0 ? seedFreshnessCutoffMs(now) : null;

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
      sql: buildStapplyIngestQuery({ boards: [board], freshnessCutoffMs }),
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

  dropStapplyStaging(catalog.db);

  progress(
    `delta: ${String(delta.inserted)} new, ${String(delta.updated)} changed, ${String(delta.closed)} closed, ${String(delta.pruned)} pruned, ${String(delta.tagged)} tagged`,
  );

  const rowCount = countPostings(catalog.db);
  const supportedCount = countSupportedPostings(catalog.db);
  const unresolved = unresolvedRoleCount(catalog.db);
  const tagSources = tagSourceSummary(catalog.db);

  const llm =
    args.values["skip-llm"] === true || maxLlmRows === 0
      ? { considered: 0, sent: 0, tagged: 0, skipped: 0, available: false }
      : await runStapplyLlmTagging({
          db: catalog.db,
          classifier: classifierFromEnv(),
          now,
          limit: maxLlmRows,
          batchSize: STAPPLY_LLM_BATCH_SIZE,
        });

  progress(`llm tagging: ${String(llm.tagged)} tagged, ${String(llm.skipped)} left`);

  catalog.db.$client.run("PRAGMA optimize");
  catalog.db.$client.run("PRAGMA wal_checkpoint(TRUNCATE)");
  catalog.db.$client.run("PRAGMA journal_mode = DELETE");
  catalog.db.$client.run("VACUUM");
  const integrity = integrityCheck(catalog.db);
  catalog.sqlite.close();

  progress(
    `integrity ${integrity}; compressing ${String(rowCount)} rows at zstd level ${String(zstdLevel)}`,
  );

  const sqliteBytes = new Uint8Array(readFileSync(catalogPath));
  const compressedBytes = compressCatalogSnapshot(sqliteBytes, zstdLevel);

  const manifest = buildCatalogManifest({
    version,
    builtAt,
    sqliteBytes,
    rowCount,
    supportedCount,
  });

  if (
    isRowDrop(previous?.manifest.rowCount ?? null, rowCount, args.values["allow-row-drop"] === true)
  ) {
    throw new Error(
      `refusing to publish ${String(rowCount)} rows against the previous ${String(previous?.manifest.rowCount ?? 0)}; pass --allow-row-drop after checking upstream`,
    );
  }

  const publish = await publishArtifacts(manifest, compressedBytes);

  progress(`published ${publish} (${String(compressedBytes.byteLength)} bytes)`);

  const perBoardSummary: Partial<Record<Ats, number>> = {};

  for (const board of perBoard) {
    perBoardSummary[board.ats] = board.rows;
  }

  return {
    outcome: "published",
    version,
    builtAt,
    mode: objects === null ? "relay" : objects.kind,
    publish,
    seed,
    freshnessDays: freshnessCutoffMs === null ? null : freshnessDays,
    sqlite: {
      path: catalogPath,
      bytes: sqliteBytes.byteLength,
      zstdBytes: compressedBytes.byteLength,
    },
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
    },
    llm,
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
    return "dry_run";
  }

  if (objects !== null) {
    await publishCatalogSnapshot({ objects, manifest, compressedBytes });

    return objects.kind;
  }

  if (Bun.env.CATALOG_REFRESH_SECRET === undefined) {
    throw new Error(
      "no publish target: set the R2 repository secrets or CATALOG_REFRESH_SECRET (docs/DEPLOY.md, the daily catalog ETL)",
    );
  }

  const relay = await relayCatalogSnapshot({
    origin: Bun.env.CATALOG_REFRESH_ORIGIN ?? "https://tryoverture.com",
    secret: Bun.env.CATALOG_REFRESH_SECRET,
    manifest,
    compressedBytes,
    nowMs: now,
  });

  return relay.outcome === "delivered" ? "relay" : "relay_endpoint_missing";
}

const summary = await main();

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
