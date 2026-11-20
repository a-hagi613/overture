import { readdirSync } from "node:fs";
import { join } from "node:path";

import { expect } from "@playwright/test";

function ltxFileCount(path: string) {
  try {
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}

export async function waitForReplicaTransactions(directory: string) {
  await expect
    .poll(() => ltxFileCount(join(directory, "replica", "ltx", "0")), { timeout: 30_000 })
    .toBeGreaterThan(0);

  await expect
    .poll(() => ltxFileCount(join(directory, ".live.db-litestream", "ltx", "0")), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
}
