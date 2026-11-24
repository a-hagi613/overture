import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import {
  bestEffortCatalogWrite,
  isReadOnlyCatalogError,
  resetReadOnlyCatalogWarnings,
} from "./read-only-catalog.ts";
import { openCatalogDatabase, openReadOnlyCatalogDatabase } from "./client.ts";
import { migrateCatalogDatabase } from "./migrate.ts";
import { createQuestionCatalog } from "../../catalog/questions.ts";
import { companies } from "./catalog-schema.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  resetReadOnlyCatalogWarnings();

  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratchCatalog() {
  const directory = mkdtempSync(join(tmpdir(), "read-only-catalog-"));
  scratchDirectories.push(directory);

  const path = join(directory, "catalog.sqlite");
  const writable = openCatalogDatabase(path);

  migrateCatalogDatabase(writable.db, "drizzle-catalog");
  writable.db
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: null,
      id: "company-1",
      industry: null,
      name: "A",
      nameNorm: "a",
    })
    .run();
  writable.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
  writable.sqlite.close();

  return { path, directory };
}

describe("best-effort catalog writes", () => {
  test("recognises a SQLite read-only refusal and nothing else", () => {
    expect(isReadOnlyCatalogError(new Error("attempt to write a readonly database"))).toBe(true);
    expect(isReadOnlyCatalogError(Object.assign(new Error("x"), { name: "SQLiteError" }))).toBe(
      false,
    );
    expect(isReadOnlyCatalogError(null)).toBe(false);
  });

  test("swallows a read-only refusal but rethrows any other failure", () => {
    expect(
      bestEffortCatalogWrite("test.read_only", () => {
        throw new Error("attempt to write a readonly database");
      }),
    ).toBe(false);
    expect(bestEffortCatalogWrite("test.ok", () => undefined)).toBe(true);
    expect(() =>
      bestEffortCatalogWrite("test.other", () => {
        throw new Error("disk I/O error");
      }),
    ).toThrow("disk I/O error");
  });

  test("caching Posting questions against a read-only catalog does not break the caller", () => {
    const { path } = scratchCatalog();
    const readOnly = openReadOnlyCatalogDatabase(path);

    try {
      const catalog = createQuestionCatalog({
        catalogDb: readOnly.db,
        clock: { now: () => NOW },
        db: readOnly.db,
      });

      expect(() =>
        catalog.savePostingQuestions("posting-1", [
          {
            fieldName: null,
            options: [],
            position: 1,
            questionId: "question-1",
            required: true,
          },
        ]),
      ).not.toThrow();

      expect(
        readOnly.db.select().from(companies).where(eq(companies.id, "company-1")).get()?.name,
      ).toBe("A");
      expect(readFileSync(path).byteLength).toBeGreaterThan(0);
    } finally {
      readOnly.sqlite.close();
    }
  });
});
