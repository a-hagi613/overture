import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { databasePath, env } from "../../config/env.ts";

const ltxFileSchema = z.object({
  max_txid: z.string().min(1),
  timestamp: z.iso.datetime(),
});

const ltxListingSchema = z.array(ltxFileSchema);

export type ReplicaTransaction = z.infer<typeof ltxFileSchema>;

export type BackupStatus =
  | { replication: "unconfigured" }
  | { replication: "unavailable" }
  | { replication: "ok"; lagSeconds: number; replicaTxid: string };

function compareTransactions(left: ReplicaTransaction, right: ReplicaTransaction) {
  if (left.max_txid < right.max_txid) {
    return -1;
  }

  return left.max_txid > right.max_txid ? 1 : 0;
}

function newestTransaction(transactions: ReplicaTransaction[]) {
  const ordered = transactions.toSorted(compareTransactions);

  return ordered.at(-1);
}

function oldestUnreplicatedTransaction(local: ReplicaTransaction[], replica: ReplicaTransaction) {
  const ordered = local.toSorted(compareTransactions);

  return ordered.find((transaction) => transaction.max_txid > replica.max_txid);
}

export async function readBackupStatus(now: number) {
  if (env.LITESTREAM_CONFIG_PATH === undefined) {
    return { replication: "unconfigured" } as const;
  }

  const configPath = env.LITESTREAM_CONFIG_PATH;
  const absoluteDatabasePath = resolve(databasePath);

  const shadowDirectory = pathToFileURL(
    join(dirname(absoluteDatabasePath), `.${basename(absoluteDatabasePath)}-litestream`),
  ).href;

  const [replicaListing, localListing] = await Promise.all([
    listTransactions(["-config", configPath, databasePath]),
    listTransactions([shadowDirectory]),
  ]);

  if (replicaListing === null || localListing === null) {
    return { replication: "unavailable" } as const;
  }

  const newestReplica = newestTransaction(replicaListing);

  if (newestReplica === undefined) {
    return { replication: "unavailable" } as const;
  }

  const oldestUnreplicated = oldestUnreplicatedTransaction(localListing, newestReplica);

  if (oldestUnreplicated === undefined) {
    return {
      replication: "ok",
      lagSeconds: 0,
      replicaTxid: newestReplica.max_txid,
    } as const satisfies BackupStatus;
  }

  const oldestUnreplicatedAt = Date.parse(oldestUnreplicated.timestamp);

  return {
    replication: "ok",
    lagSeconds: Math.max(0, Math.round((now - oldestUnreplicatedAt) / 1000)),
    replicaTxid: newestReplica.max_txid,
  } as const satisfies BackupStatus;
}

async function listTransactions(ltxArguments: string[]) {
  try {
    const child = Bun.spawn(["litestream", "ltx", "-json", "-level", "all", ...ltxArguments], {
      stdout: "pipe",
      stderr: "ignore",
      signal: AbortSignal.timeout(5000),
    });

    const output = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
      return null;
    }

    return ltxListingSchema.parse(JSON.parse(output));
  } catch {
    return null;
  }
}
