import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { z } from "zod";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "./clock.ts";
import type { ReplicaTransaction } from "./replica-listing.ts";

import { databasePath, env } from "../../config/env.ts";
import { getSetting } from "../settings/index.ts";
import { compareTransactions, readNewestReplicaTransaction } from "./replica-listing.ts";

const ltxFileSchema = z.object({
  max_txid: z.string().min(1),
  timestamp: z.iso.datetime(),
});

const ltxListingSchema = z.array(ltxFileSchema);

export type { ReplicaTransaction } from "./replica-listing.ts";

const DEFAULT_READ_INTERVAL_MS = 30_000;
const MIN_READ_INTERVAL_MS = 1000;
const STALE_AFTER_INTERVALS = 3;

export type BackupStatus =
  | { replication: "unconfigured" }
  | { replication: "unknown"; readAgeSeconds: number | null }
  | { replication: "unavailable"; readAgeSeconds: number }
  | { replication: "ok"; lagSeconds: number; replicaTxid: string; readAgeSeconds: number };

type Observation =
  | { replication: "unavailable" }
  | { replication: "ok"; replicaTxid: string; oldestUnreplicatedAt: number | null };

function oldestUnreplicatedTransaction(local: ReplicaTransaction[], replica: ReplicaTransaction) {
  const ordered = local.toSorted(compareTransactions);

  return ordered.find((transaction) => transaction.max_txid > replica.max_txid);
}

async function observeReplica(configPath: string) {
  const absoluteDatabasePath = resolve(databasePath);

  const shadowDirectory = pathToFileURL(
    join(dirname(absoluteDatabasePath), `.${basename(absoluteDatabasePath)}-litestream`),
  ).href;

  const [newestReplica, localListing] = await Promise.all([
    readNewestReplicaTransaction(async (level) =>
      listTransactions(String(level), ["-config", configPath, databasePath]),
    ),
    listTransactions("all", [shadowDirectory]),
  ]);

  if (newestReplica === null || newestReplica === undefined || localListing === null) {
    return { replication: "unavailable" } as const satisfies Observation;
  }

  const oldestUnreplicated = oldestUnreplicatedTransaction(localListing, newestReplica);

  return {
    replication: "ok",
    replicaTxid: newestReplica.max_txid,
    oldestUnreplicatedAt:
      oldestUnreplicated === undefined ? null : Date.parse(oldestUnreplicated.timestamp),
  } as const satisfies Observation;
}

async function listTransactions(level: string, ltxArguments: string[]) {
  try {
    const child = Bun.spawn(
      [env.LITESTREAM_BINARY, "ltx", "-json", "-level", level, ...ltxArguments],
      {
        stdout: "pipe",
        stderr: "ignore",
        signal: AbortSignal.timeout(5000),
      },
    );

    const output = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
      return null;
    }

    return ltxListingSchema.parse(JSON.parse(output));
  } catch {
    return null;
  }
}

export function createBackupMonitor(db: AppDatabase, clock: Clock) {
  let latest: (Observation & { readAt: number }) | null = null;

  function readIntervalMs() {
    const parsed = Number(getSetting(db, "backups.replica_read_interval_ms"));

    return Number.isFinite(parsed) && parsed >= MIN_READ_INTERVAL_MS
      ? Math.trunc(parsed)
      : DEFAULT_READ_INTERVAL_MS;
  }

  function status() {
    if (env.LITESTREAM_CONFIG_PATH === undefined) {
      return { replication: "unconfigured" } as const satisfies BackupStatus;
    }

    const reading = latest;

    if (reading === null) {
      return { replication: "unknown", readAgeSeconds: null } as const satisfies BackupStatus;
    }

    const now = clock.now();
    const readAgeSeconds = Math.max(0, Math.round((now - reading.readAt) / 1000));

    if (now - reading.readAt > STALE_AFTER_INTERVALS * readIntervalMs()) {
      return { replication: "unknown", readAgeSeconds } as const satisfies BackupStatus;
    }

    if (reading.replication === "unavailable") {
      return { replication: "unavailable", readAgeSeconds } as const satisfies BackupStatus;
    }

    const lagSeconds =
      reading.oldestUnreplicatedAt === null
        ? 0
        : Math.max(0, Math.round((now - reading.oldestUnreplicatedAt) / 1000));

    return {
      replication: "ok",
      lagSeconds,
      replicaTxid: reading.replicaTxid,
      readAgeSeconds,
    } as const satisfies BackupStatus;
  }

  async function refresh(configPath: string) {
    const observation = await observeReplica(configPath);

    latest = { ...observation, readAt: clock.now() };
  }

  async function run(signal: AbortSignal) {
    const configPath = env.LITESTREAM_CONFIG_PATH;

    if (configPath === undefined) {
      return;
    }

    async function step(path: string) {
      if (signal.aborted) {
        return;
      }

      await refresh(path);
      await delay(readIntervalMs(), undefined, { signal }).catch(() => undefined);

      return step(path);
    }

    await step(configPath);
  }

  return { status, run };
}

export type BackupMonitor = ReturnType<typeof createBackupMonitor>;
