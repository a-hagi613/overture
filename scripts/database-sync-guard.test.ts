import { expect, test } from "bun:test";

import { findUnguardedDatabaseSyncHandles } from "./database-sync-guard.ts";

const unguarded = {
  path: "test/e2e/lock-holder.test.ts",
  source: 'const lock = new DatabaseSync(databasePath);\nlock.exec("BEGIN IMMEDIATE");\n',
};

test("rejects a DatabaseSync handle that never configures busy_timeout", () => {
  const problems = findUnguardedDatabaseSyncHandles([unguarded]);

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(unguarded.path);
  expect(problems[0]).toContain("PRAGMA busy_timeout");
});

test("a test title that names busy_timeout is not a configured handle", () => {
  const problems = findUnguardedDatabaseSyncHandles([
    {
      path: "test/e2e/lock-holder.test.ts",
      source:
        'test("a write lock held past busy_timeout is retried", () => {\n' +
        "  const lock = new DatabaseSync(databasePath);\n" +
        "});\n",
    },
  ]);

  expect(problems).toHaveLength(1);
});

test("allows a handle that configures busy_timeout", () => {
  const problems = findUnguardedDatabaseSyncHandles([
    {
      path: "test/e2e/lock-holder.test.ts",
      source:
        "const lock = new DatabaseSync(databasePath);\n" +
        'lock.exec("PRAGMA busy_timeout = 5000;");\n',
    },
  ]);

  expect(problems).toStrictEqual([]);
});

test("allows a documented opt-out with a reason", () => {
  const problems = findUnguardedDatabaseSyncHandles(
    [unguarded],
    [{ path: unguarded.path, reason: "a probe that must fail at once on a held lock" }],
  );

  expect(problems).toStrictEqual([]);
});

test("an opt-out for one file does not excuse another", () => {
  const problems = findUnguardedDatabaseSyncHandles(
    [unguarded],
    [{ path: "test/e2e/another.test.ts", reason: "a probe that must fail at once on a held lock" }],
  );

  expect(problems).toHaveLength(1);
});

test("files without a DatabaseSync handle are not reported", () => {
  const problems = findUnguardedDatabaseSyncHandles([
    { path: "src/server/platform/db/client.ts", source: "const sqlite = new Database(path);\n" },
  ]);

  expect(problems).toStrictEqual([]);
});
