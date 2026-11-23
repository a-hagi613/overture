import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { VacuumRefusedError, openReadOnlyDatabase, vacuumAppDatabase } from "./vacuum-app-db.ts";

const freelistSchema = z.object({ freelist_count: z.number().int().nonnegative() });
const busyTimeoutSchema = z.object({ timeout: z.number().int().positive() });

function scratchDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "vacuum-app-db-"));
  const path = join(directory, "app.sqlite");
  const sqlite = new Database(path);

  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA synchronous = OFF;");
  sqlite.run("create table blobs (id integer primary key, payload text not null);");

  const insert = sqlite.prepare("insert into blobs (payload) values (?);");

  for (let index = 0; index < 4000; index += 1) {
    insert.run("x".repeat(500));
  }

  sqlite.run("delete from blobs where id > 10;");
  sqlite.close();

  return { directory, path };
}

function freelistOf(path: string) {
  const sqlite = new Database(path, { readonly: true });

  try {
    return freelistSchema.parse(sqlite.query("PRAGMA freelist_count;").get()).freelist_count;
  } finally {
    sqlite.close();
  }
}

test("vacuum-app-db compacts a fragmented file to zero free pages and keeps integrity", () => {
  const { directory, path } = scratchDatabase();

  try {
    const fragmented = freelistOf(path);

    expect(fragmented).toBeGreaterThan(0);

    const fileBefore = statSync(path).size;
    const report = vacuumAppDatabase(path, { confirm: true });

    expect(report.before.freelistCount).toBe(fragmented);
    expect(report.after?.freelistCount).toBe(0);
    expect(report.after?.freeBytes).toBe(0);
    expect(report.integrityCheck).toBe("ok");
    expect(report.after?.fileBytes).toBeLessThan(fileBefore);
    expect(report.after?.walBytes).toBeLessThanOrEqual(4096);
    expect(freelistOf(path)).toBe(0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("vacuum-app-db dry run reports the sizes before and changes nothing", () => {
  const { directory, path } = scratchDatabase();

  try {
    const fileBefore = statSync(path).size;
    const report = vacuumAppDatabase(path, { confirm: false, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.after).toBeNull();
    expect(report.integrityCheck).toBeNull();
    expect(report.before.freelistCount).toBeGreaterThan(0);
    expect(report.before.freeBytes).toBeGreaterThan(0);
    expect(statSync(path).size).toBe(fileBefore);
    expect(freelistOf(path)).toBe(report.before.freelistCount);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("vacuum-app-db refuses to write without --confirm", () => {
  const { directory, path } = scratchDatabase();

  try {
    expect(() => vacuumAppDatabase(path, { confirm: false })).toThrow(VacuumRefusedError);
    expect(() => vacuumAppDatabase(path, { confirm: false })).toThrow(/--confirm/u);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("the dry run's read-only handle waits on a busy database instead of failing at once", () => {
  const { directory, path } = scratchDatabase();

  try {
    const readonly = openReadOnlyDatabase(path);

    try {
      expect(busyTimeoutSchema.parse(readonly.query("PRAGMA busy_timeout;").get()).timeout).toBe(
        5000,
      );
    } finally {
      readonly.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("vacuum-app-db refuses while another process holds the write lock", () => {
  const { directory, path } = scratchDatabase();
  const writer = new Database(path);

  try {
    writer.run("PRAGMA busy_timeout = 0;");
    writer.run("BEGIN IMMEDIATE;");

    expect(() => vacuumAppDatabase(path, { confirm: true })).toThrow(/write lock/u);

    writer.run("ROLLBACK;");
  } finally {
    writer.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("vacuum-app-db refuses a missing database", () => {
  expect(() => vacuumAppDatabase("/nonexistent/app.sqlite", { confirm: true })).toThrow(
    VacuumRefusedError,
  );
});
