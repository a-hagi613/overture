import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { measureSqliteQuery } from "./sqlite-metrics.ts";

test("a timed statement returns its result and records only the database and operation", () => {
  const sqlite = new Database(":memory:");

  sqlite.run("PRAGMA busy_timeout = 5000");

  const recorded: { db: string; op: string; durationMs: number }[] = [];

  const record = (input: { db: string; durationMs: number; op: string }) => {
    recorded.push(input);
  };

  measureSqliteQuery(
    "app",
    "insert",
    () => {
      sqlite.run("create table users (id text primary key, email text)");
      sqlite.prepare("insert into users (id, email) values (?, ?)").run("u1", "a@b.test");
    },
    record,
  );

  const row = measureSqliteQuery(
    "app",
    "select",
    () => sqlite.prepare("select email from users where id = ?").get("u1"),
    record,
  );

  expect(row).toEqual({ email: "a@b.test" });

  const measured = measureSqliteQuery(
    "catalog",
    "delete",
    () => sqlite.prepare("delete from users where id = ?").run("u1"),
    record,
  );

  expect(measured).toMatchObject({ changes: 1 });
  expect(recorded.map((entry) => [entry.db, entry.op])).toEqual([
    ["app", "insert"],
    ["app", "select"],
    ["catalog", "delete"],
  ]);

  for (const entry of recorded) {
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  }

  sqlite.close();
});
