import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openCatalogDatabase, openDatabase } from "./client.ts";

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "db-client-"));
  scratchDirectories.push(directory);

  return { databasePath: join(directory, "app.sqlite"), directory };
}

function checkpointSetting(sqlite: ReturnType<typeof openDatabase>["sqlite"]) {
  return sqlite.query("PRAGMA wal_autocheckpoint").get();
}

describe("the application database connection", () => {
  test("opens WAL with FULL sync and keeps SQLite's checkpoint when nothing replicates the file", () => {
    const { databasePath } = scratch();
    const { sqlite } = openDatabase(databasePath);

    try {
      expect(sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(sqlite.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
      expect(sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(sqlite.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
      expect(checkpointSetting(sqlite)).toEqual({ wal_autocheckpoint: 1000 });
    } finally {
      sqlite.close();
    }
  });

  test("hands the checkpoints to Litestream when it replicates the file", () => {
    const { databasePath } = scratch();
    const { sqlite } = openDatabase(databasePath, { checkpointOwner: "litestream" });

    try {
      expect(sqlite.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      expect(checkpointSetting(sqlite)).toEqual({ wal_autocheckpoint: 0 });
    } finally {
      sqlite.close();
    }
  });

  test("keeps SQLite's automatic checkpoint on the catalog file Litestream does not replicate", () => {
    const { directory } = scratch();
    const { sqlite } = openCatalogDatabase(join(directory, "catalog.sqlite"));

    try {
      expect(checkpointSetting(sqlite)).toEqual({ wal_autocheckpoint: 1000 });
    } finally {
      sqlite.close();
    }
  });
});

describe("the container's checkpoint ownership", () => {
  test("opts into Litestream checkpoints only on the replicate path", () => {
    const entrypoint = readFileSync("scripts/docker-entrypoint.sh", "utf8");
    const directRunAt = entrypoint.indexOf("exec bun run /app/src/server/main.ts");
    const ownsAt = entrypoint.indexOf("LITESTREAM_OWNS_CHECKPOINTS=true");
    const replicateAt = entrypoint.indexOf("exec litestream replicate");

    expect(directRunAt).toBeGreaterThan(-1);
    expect(ownsAt).toBeGreaterThan(directRunAt);
    expect(replicateAt).toBeGreaterThan(ownsAt);
  });
});
