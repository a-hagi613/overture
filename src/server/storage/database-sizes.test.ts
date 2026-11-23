import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { checkpointDatabase, LitestreamCheckpointRefusedError } from "./database-sizes.ts";

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratchPath() {
  const directory = mkdtempSync(join(tmpdir(), "database-sizes-"));

  scratchDirectories.push(directory);

  return join(directory, "catalog.sqlite");
}

describe("checkpointing a database", () => {
  test("refuses a live truncate on the Litestream-replicated app database", () => {
    const path = scratchPath();

    expect(() => checkpointDatabase(path, { replicated: true })).toThrow(
      LitestreamCheckpointRefusedError,
    );
    expect(existsSync(path)).toBe(false);
  });

  test("truncates the catalog WAL", () => {
    const path = scratchPath();
    const { db, sqlite } = openCatalogDatabase(path);

    db.$client.run("create table scratch (id text primary key)");
    db.$client.run("insert into scratch (id) values ('one')");
    sqlite.close();

    const report = checkpointDatabase(path);

    expect(report.busy).toBe(0);
    expect(report.afterWalBytes).toBeLessThanOrEqual(report.beforeWalBytes);
  });
});
