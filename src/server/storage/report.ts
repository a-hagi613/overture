import { chmod, mkdtemp, rm, stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";

import { postings } from "../platform/db/catalog-schema.ts";
import { logError } from "../platform/log.ts";

const NAMED_PREFIXES = ["files/", "mail/", "exports/"] as const;

export const OBJECT_PREFIXES = [...NAMED_PREFIXES, "other"] as const;

export type ObjectPrefix = (typeof OBJECT_PREFIXES)[number];

export interface FileUsage {
  file: string;
  present: boolean;
  mainBytes: number;
  walBytes: number;
  shmBytes: number;
  totalBytes: number;
}

export interface VolumeUsage {
  mount: string;
  totalBytes: number;
  freeBytes: number;
  usedRatio: number;
}

export interface PostingSourceUsage {
  source: string;
  open: number;
  closed: number;
}

export interface PrefixUsage {
  prefix: ObjectPrefix;
  objects: number;
  bytes: number;
}

export interface BackupUsage {
  status: "ok" | "unavailable" | "unconfigured";
  store: ObjectStore["kind"] | null;
  objects: number;
  bytes: number;
}

export interface ObjectUsage {
  store: ObjectStore["kind"];
  status: "ok" | "unavailable";
  prefixes: PrefixUsage[];
  totalObjects: number;
  totalBytes: number;
  backups: BackupUsage;
}

export interface TableUsage {
  table: string;
  bytes: number;
}

export interface TableBreakdown {
  status: "ok" | "unavailable";
  tables: TableUsage[];
  totalBytes: number;
}

export interface StorageReport {
  generatedAt: number;
  databases: {
    app: FileUsage;
    catalog: FileUsage | null;
  };
  volume: VolumeUsage | null;
  postings: {
    open: number;
    closed: number;
    bySource: PostingSourceUsage[];
  };
  objects: ObjectUsage;
  tables: TableBreakdown | null;
}

export interface StorageReportDeps {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: Clock;
  databasePath: string;
  catalogPath?: string | null;
  objects: ObjectStore;
  backups?: ObjectStore | null;
  includeTables?: boolean;
}

function emptyPrefixUsage() {
  return {
    "exports/": { bytes: 0, objects: 0 },
    "files/": { bytes: 0, objects: 0 },
    "mail/": { bytes: 0, objects: 0 },
    other: { bytes: 0, objects: 0 },
  } satisfies Record<ObjectPrefix, { objects: number; bytes: number }>;
}

function prefixOf(key: string) {
  return NAMED_PREFIXES.find((prefix) => key.startsWith(prefix)) ?? "other";
}

async function filesUnder(path: string) {
  const [main, wal, shm] = await Promise.all([
    stat(path).catch(() => null),
    stat(`${path}-wal`).catch(() => null),
    stat(`${path}-shm`).catch(() => null),
  ]);

  const mainBytes = main?.isFile() === true ? main.size : 0;
  const walBytes = wal?.isFile() === true ? wal.size : 0;
  const shmBytes = shm?.isFile() === true ? shm.size : 0;

  return {
    file: basename(path),
    mainBytes,
    present: main?.isFile() === true,
    shmBytes,
    totalBytes: mainBytes + walBytes + shmBytes,
    walBytes,
  } satisfies FileUsage;
}

async function volumeUsage(databasePath: string) {
  const mount = dirname(resolve(databasePath));
  const fs = await statfs(mount).catch(() => null);

  if (fs === null || fs.blocks === 0) {
    return null;
  }

  const totalBytes = fs.bsize * fs.blocks;
  const freeBytes = fs.bsize * fs.bavail;

  return {
    freeBytes,
    mount,
    totalBytes,
    usedRatio: 1 - freeBytes / totalBytes,
  } satisfies VolumeUsage;
}

function postingsBySource(db: CatalogDatabase) {
  const rows = db
    .select({
      source: postings.ats,
      open: sql<number>`sum(case when ${postings.closedAt} is null then 1 else 0 end)`,
      closed: sql<number>`sum(case when ${postings.closedAt} is not null then 1 else 0 end)`,
    })
    .from(postings)
    .groupBy(postings.ats)
    .all();

  return rows
    .map((row) => ({ closed: row.closed, open: row.open, source: row.source }))
    .toSorted((left, right) => left.source.localeCompare(right.source));
}

async function prefixUsage(objects: ObjectStore) {
  const usage = emptyPrefixUsage();

  for await (const entry of objects.listWithSizes("")) {
    const prefix = prefixOf(entry.key);
    const group = usage[prefix];

    group.bytes += entry.bytes;
    group.objects += 1;
  }

  return OBJECT_PREFIXES.map((prefix) => ({
    bytes: usage[prefix].bytes,
    objects: usage[prefix].objects,
    prefix,
  }));
}

async function totalsUnder(objects: ObjectStore) {
  const totals = { bytes: 0, objects: 0 };

  for await (const entry of objects.listWithSizes("")) {
    totals.bytes += entry.bytes;
    totals.objects += 1;
  }

  return totals;
}

async function objectUsage(objects: ObjectStore, backups: ObjectStore | null | undefined) {
  let prefixes: PrefixUsage[] = [];
  let status: ObjectUsage["status"] = "ok";

  try {
    prefixes = await prefixUsage(objects);
  } catch (error) {
    logError("storage.report.objects", error);
    status = "unavailable";
  }

  const totalObjects = prefixes.reduce((total, row) => total + row.objects, 0);
  const totalBytes = prefixes.reduce((total, row) => total + row.bytes, 0);

  return {
    backups: await backupUsage(backups),
    prefixes,
    status,
    store: objects.kind,
    totalBytes,
    totalObjects,
  } satisfies ObjectUsage;
}

async function backupUsage(backups: ObjectStore | null | undefined) {
  if (backups === null || backups === undefined) {
    const usage: BackupUsage = { bytes: 0, objects: 0, status: "unconfigured", store: null };

    return usage;
  }

  const store = backups.kind;

  try {
    const totals = await totalsUnder(backups);

    const usage: BackupUsage = { ...totals, status: "ok", store };

    return usage;
  } catch (error) {
    logError("storage.report.backups", error);

    const usage: BackupUsage = { bytes: 0, objects: 0, status: "unavailable", store };

    return usage;
  }
}

async function snapshotDatabase(databasePath: string, target: string) {
  const live = new Database(databasePath, { readonly: true, strict: true });

  try {
    live.run("PRAGMA busy_timeout = 5000;");
    live.run(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    live.close();
  }

  await chmod(target, 0o600);
}

async function readTableBreakdown(databasePath: string) {
  const directory = await mkdtemp(join(tmpdir(), "overture-storage-report-"));

  try {
    const target = join(directory, "snapshot.sqlite");

    await snapshotDatabase(databasePath, target);

    const snapshot = new Database(target, { readonly: true, strict: true });

    try {
      const rows = snapshot
        .query<{ bytes: number; name: string }, []>(
          "select name, sum(pgsize) as bytes from dbstat group by name order by sum(pgsize) desc, name asc",
        )
        .all();

      const tables = rows.map((row) => ({ bytes: row.bytes, table: row.name }));

      return {
        status: "ok",
        tables,
        totalBytes: tables.reduce((total, row) => total + row.bytes, 0),
      } satisfies TableBreakdown;
    } finally {
      snapshot.close();
    }
  } catch (error) {
    logError("storage.report.dbstat", error);

    return { status: "unavailable", tables: [], totalBytes: 0 } satisfies TableBreakdown;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

const tableBreakdowns = new Map<string, Promise<TableBreakdown>>();

async function readTableBreakdownOnce(databasePath: string) {
  try {
    return await readTableBreakdown(databasePath);
  } finally {
    tableBreakdowns.delete(databasePath);
  }
}

async function tableBreakdown(databasePath: string) {
  const existing = tableBreakdowns.get(databasePath);

  if (existing !== undefined) {
    return existing;
  }

  const reading = readTableBreakdownOnce(databasePath);

  tableBreakdowns.set(databasePath, reading);

  return reading;
}

async function combinedTableBreakdown(paths: readonly string[]) {
  const parts = await Promise.all(paths.map(async (path) => tableBreakdown(path)));

  if (parts.some((part) => part.status !== "ok")) {
    return { status: "unavailable", tables: [], totalBytes: 0 } satisfies TableBreakdown;
  }

  const tables = parts
    .flatMap((part) => part.tables)
    .toSorted((left, right) => right.bytes - left.bytes || left.table.localeCompare(right.table));

  return {
    status: "ok",
    tables,
    totalBytes: tables.reduce((total, row) => total + row.bytes, 0),
  } satisfies TableBreakdown;
}

export async function buildStorageReport(deps: StorageReportDeps) {
  const catalogPath =
    deps.catalogPath === null
      ? null
      : (deps.catalogPath ?? join(dirname(resolve(deps.databasePath)), "catalog.sqlite"));

  const [app, catalog, volume, objects] = await Promise.all([
    filesUnder(deps.databasePath),
    catalogPath === null ? null : filesUnder(catalogPath),
    volumeUsage(deps.databasePath),
    objectUsage(deps.objects, deps.backups),
  ]);

  const bySource = postingsBySource(deps.catalogDb);

  return {
    databases: { app, catalog: catalog?.present === true ? catalog : null },
    generatedAt: deps.clock.now(),
    objects,
    postings: {
      bySource,
      closed: bySource.reduce((total, row) => total + row.closed, 0),
      open: bySource.reduce((total, row) => total + row.open, 0),
    },
    tables:
      deps.includeTables === true
        ? await combinedTableBreakdown(
            catalog === null ? [deps.databasePath] : [deps.databasePath, catalogPath ?? ""],
          )
        : null,
    volume,
  } satisfies StorageReport;
}
