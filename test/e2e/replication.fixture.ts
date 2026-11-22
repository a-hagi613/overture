import { readdirSync } from "node:fs";
import { join } from "node:path";

import { expect } from "@playwright/test";

const LTX_FILE_PATTERN = /-(?<txid>[0-9a-f]+)\.ltx$/u;
const COMPACTION_LEVELS = ["0", "1", "2", "3", "9"];

function ltxFileNames(path: string) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function newestTxid(path: string) {
  const txids = COMPACTION_LEVELS.flatMap((level) =>
    ltxFileNames(join(path, "ltx", level)).flatMap(
      (file) => LTX_FILE_PATTERN.exec(file)?.groups?.["txid"] ?? [],
    ),
  );

  return txids.toSorted().at(-1);
}

/**
 * Waits until the replica holds every transaction the local shadow has.
 *
 * A replica is not ready when its first transaction lands: Litestream uploads
 * the transactions it already has, so a test that starts its app at that point
 * can read a replica that is still behind the local database. Comparing the
 * newest transaction id on both sides closes that gap, so "an idle database
 * reports lag 0" starts from a caught-up replica rather than a race.
 * @param directory The Litestream working directory (config, database, replica).
 */
export async function waitForReplicaTransactions(directory: string) {
  const shadowDirectory = join(directory, ".live.db-litestream");
  const replicaDirectory = join(directory, "replica");

  await expect.poll(() => newestTxid(shadowDirectory), { timeout: 30_000 }).toBeDefined();

  await expect
    .poll(
      () => {
        const shadowTxid = newestTxid(shadowDirectory);
        const replicaTxid = newestTxid(replicaDirectory);

        return shadowTxid !== undefined && replicaTxid !== undefined && replicaTxid >= shadowTxid;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}
