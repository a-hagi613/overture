import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";

import { sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { BackupMonitor, BackupStatus } from "../platform/ports/backup.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { DegradedFlagReader } from "../platform/degraded.ts";
import type { DatabaseSizes } from "../storage/database-sizes.ts";
import type { VolumeUsage } from "../storage/report.ts";
import type { DegradedFlag } from "../../shared/degraded.ts";

import { companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { readLiveCheckResults } from "../live-checks/store.ts";
import { readDatabaseSizes } from "../storage/database-sizes.ts";
import { postingsBySource, readVolume } from "../storage/report.ts";

/** Which integrations are configured, never the values they are configured with. */
export interface SystemIntegrations {
  browserProvider: "browser_use" | "kernel" | "local" | null;
  cfAccessConfigured: boolean;
  cloudflareEmailConfigured: boolean;
  demoLoginEnabled: boolean;
  ntfyConfigured: boolean;
  publicSignupEnabled: boolean;
  stripeMode: "live" | "test" | "unconfigured";
  turnstileConfigured: boolean;
}

export interface RuntimeSnapshot {
  bunVersion: string;
  heapTotalBytes: number;
  heapUsedBytes: number;
  loadAverage: [number, number, number];
  rssBytes: number;
  uptimeSeconds: number;
}

export interface SystemLiveCheck {
  check: string;
  detail: Record<string, boolean | number | string | null>;
  durationMs: number;
  id: string;
  ok: boolean;
  runId: string;
  startedAt: number;
}

export interface SystemReport {
  backups: BackupStatus;
  catalog: {
    boards: number;
    bySource: { closed: number; open: number; source: string }[];
    closedPostings: number;
    lastPolledAt: number | null;
    lastSeenAt: number | null;
    openPostings: number;
  };
  databases: { app: DatabaseSizes | null; catalog: DatabaseSizes | null };
  degraded: DegradedFlag | null;
  generatedAt: number;
  integrations: SystemIntegrations;
  liveChecks: { latestRunAt: number | null; results: SystemLiveCheck[] };
  runtime: RuntimeSnapshot;
  volume: VolumeUsage | null;
}

export interface SystemReportDeps {
  backups: BackupMonitor;
  catalogDb: CatalogDatabase;
  clock: Clock;
  databasePath: string;
  db: AppDatabase;
  degraded: DegradedFlagReader;
  integrations: SystemIntegrations;
}

function runtimeSnapshot() {
  const memory = process.memoryUsage();
  const [one, five, fifteen] = loadavg();

  return {
    bunVersion: Bun.version,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    loadAverage: [one ?? 0, five ?? 0, fifteen ?? 0],
    rssBytes: memory.rss,
    uptimeSeconds: Math.round(process.uptime()),
  } satisfies RuntimeSnapshot;
}

function catalogSnapshot(catalogDb: CatalogDatabase) {
  const boards = catalogDb
    .select({ total: sql<number>`count(*)` })
    .from(companyBoards)
    .get();

  const lastPolled = catalogDb
    .select({ at: sql<number | null>`max(${companyBoards.lastPolledAt})` })
    .from(companyBoards)
    .get();

  const lastSeen = catalogDb
    .select({ at: sql<number | null>`max(${postings.lastSeenAt})` })
    .from(postings)
    .get();

  const bySource = postingsBySource(catalogDb);

  return {
    boards: boards?.total ?? 0,
    bySource,
    closedPostings: bySource.reduce((total, row) => total + row.closed, 0),
    lastPolledAt: lastPolled?.at ?? null,
    lastSeenAt: lastSeen?.at ?? null,
    openPostings: bySource.reduce((total, row) => total + row.open, 0),
  };
}

/**
 * Reads the system page's whole report: the databases and their reclaimable pages, the volume, Litestream's
 * replication status, the degraded flag, catalog freshness and the newest live checks. It only reads, and it never
 * returns a secret value, only whether each integration is configured.
 * @param deps The application and catalog handles, the paths, the clock and the integration flags.
 * @returns The structured system report.
 */
export async function buildSystemReport(deps: SystemReportDeps) {
  const catalogPath = join(dirname(resolve(deps.databasePath)), "catalog.sqlite");

  const [volume, degraded, backups] = await Promise.all([
    readVolume(deps.databasePath),
    deps.degraded.read(),
    Promise.resolve(deps.backups.status()),
  ]);

  const results = readLiveCheckResults(deps.db, 20);

  return {
    backups,
    catalog: catalogSnapshot(deps.catalogDb),
    databases: {
      app: readDatabaseSizes(deps.databasePath),
      catalog: readDatabaseSizes(catalogPath),
    },
    degraded,
    generatedAt: deps.clock.now(),
    integrations: deps.integrations,
    liveChecks: {
      latestRunAt: results[0]?.startedAt ?? null,
      results,
    },
    runtime: runtimeSnapshot(),
    volume,
  } satisfies SystemReport;
}

/**
 * Decides the Stripe mode from the key's prefix without ever returning the key.
 * @param secretKey The configured secret key, when there is one.
 * @returns `live`, `test` or `unconfigured`.
 */
export function stripeModeOf(secretKey: string | undefined) {
  if (secretKey === undefined) {
    return "unconfigured" as const;
  }

  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live" as const;
  }

  return secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")
    ? ("test" as const)
    : ("unconfigured" as const);
}
