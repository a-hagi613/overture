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

export async function readBackupStatus(now: number) {
  if (env.LITESTREAM_CONFIG_PATH === undefined) {
    return { replication: "unconfigured" } as const;
  }

  const ltxListing = await listReplicaTransactions();

  if (ltxListing.length === 0) {
    return { replication: "unavailable" } as const;
  }

  let newest: ReplicaTransaction | undefined;

  for (const file of ltxListing) {
    newest =
      newest === undefined || Date.parse(file.timestamp) > Date.parse(newest.timestamp)
        ? file
        : newest;
  }

  if (newest === undefined) {
    return { replication: "unavailable" } as const;
  }

  const newestTimestamp = Date.parse(newest.timestamp);

  return {
    replication: "ok",
    lagSeconds: Math.max(0, Math.round((now - newestTimestamp) / 1000)),
    replicaTxid: newest.max_txid,
  } as const satisfies BackupStatus;
}

async function listReplicaTransactions() {
  if (env.LITESTREAM_CONFIG_PATH === undefined) {
    return [];
  }

  try {
    const child = Bun.spawn(
      [
        "litestream",
        "ltx",
        "-json",
        "-level",
        "0",
        "-config",
        env.LITESTREAM_CONFIG_PATH,
        databasePath,
      ],
      { stdout: "pipe", stderr: "ignore", signal: AbortSignal.timeout(5000) },
    );

    const output = await new Response(child.stdout).text();

    if ((await child.exited) !== 0) {
      return [];
    }

    return ltxListingSchema.parse(JSON.parse(output));
  } catch {
    return [];
  }
}
