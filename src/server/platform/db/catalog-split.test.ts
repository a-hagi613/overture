import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  applyClosedPostings,
  closedPostingsWithUnsentApplications,
  reconcileClosedPostings,
} from "../../catalog/closed-postings.ts";
import { summarizeRun } from "../../catalog/sweep-run.ts";
import { createClock } from "../ports/clock.ts";
import { openCatalogDatabase, openDatabase } from "./client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "./migrate.ts";
import { applications, users } from "./schema.ts";
import { companies, postings } from "./catalog-schema.ts";

const NOW = 1_800_000_000_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function scratchDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "catalog-split-"));
  scratchDirectories.push(directory);

  const databasePath = join(directory, "app.sqlite");
  const catalogPath = join(directory, "catalog.sqlite");

  const app = openDatabase(databasePath);
  const catalog = openCatalogDatabase(catalogPath);

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  return { app, catalog, catalogPath, databasePath };
}

function seedApp(app: ReturnType<typeof openDatabase>) {
  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Owner",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();
  app.db
    .insert(applications)
    .values({
      ats: "greenhouse",
      companyId: "company-1",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      id: "application-1",
      origin: "auto",
      postingId: "posting-1",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/1",
      status: "ready",
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();
}

function seedCatalog(catalog: ReturnType<typeof openCatalogDatabase>) {
  catalog.db
    .insert(companies)
    .values({ createdAt: NOW, id: "company-1", name: "Ferro Cloud", nameNorm: "ferro cloud" })
    .run();
  catalog.sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values ('board-1', 'company-1', 'greenhouse', 'ferro', 'us', 'active', 'v1_seed', ?)",
    [NOW],
  );
  catalog.db
    .insert(postings)
    .values({
      applyUrlNorm: "https://boards.example/jobs/1",
      ats: "greenhouse",
      atsJobId: "job-1",
      boardId: "board-1",
      companyId: "company-1",
      dedupeKey: "ferro:job-1",
      firstSeenAt: NOW,
      id: "posting-1",
      lastSeenAt: NOW,
      title: "Senior Platform Engineer",
      titleNorm: "senior platform engineer",
      url: "https://boards.example/jobs/1",
    })
    .run();
}

const databaseEntrySchema = z.array(z.object({ path: z.string() }));

function replicatedPaths(config: string) {
  const dbsBlock = /^dbs:\s*$(?<entries>[\s\S]*)$/mu.exec(config)?.groups?.entries ?? "";

  return databaseEntrySchema.parse(
    dbsBlock
      .split("\n")
      .map((line) => /^\s*-\s*path:\s*(?<path>\S+)\s*$/u.exec(line)?.groups)
      .filter((groups) => groups !== undefined),
  );
}

describe("closed postings", () => {
  test("the sweep's closed posting ids come back and skip the unsent Applications", () => {
    const { app, catalog } = scratchDatabase();

    seedApp(app);
    seedCatalog(catalog);

    const summary = summarizeRun(
      "sweep",
      [
        {
          added: 0,
          boardId: "board-1",
          closed: 1,
          closedPostingIds: ["posting-1"],
          error: null,
          outcome: "not_modified",
          updated: 0,
        },
      ],
      10,
    );

    expect(summary.closedPostingIds).toEqual(["posting-1"]);
    expect(applyClosedPostings(app.db, createClock(), summary.closedPostingIds)).toBe(1);
    expect(
      app.sqlite
        .query("select status, status_reason as reason from applications where id = ?")
        .get("application-1"),
    ).toEqual({ reason: "posting_closed", status: "skipped" });
    expect(applyClosedPostings(app.db, createClock(), summary.closedPostingIds)).toBe(0);

    app.sqlite.close();
    catalog.sqlite.close();
  });

  test("a closed Posting a crashed sweep never reported is found from the catalog", () => {
    const { app, catalog } = scratchDatabase();

    seedApp(app);
    seedCatalog(catalog);

    catalog.db.update(postings).set({ closedAt: NOW }).run();

    expect(closedPostingsWithUnsentApplications(app.db, catalog.db)).toEqual(["posting-1"]);
    expect(
      reconcileClosedPostings({ catalogDb: catalog.db, clock: createClock(), db: app.db }, []),
    ).toBe(1);
    expect(
      app.sqlite.query("select status from applications where id = 'application-1'").get(),
    ).toEqual({ status: "skipped" });

    app.sqlite.close();
    catalog.sqlite.close();
  });
});

describe("the catalog split", () => {
  test("Litestream replicates app.sqlite only, never catalog.sqlite", () => {
    const config = readFileSync("litestream.yml", "utf8");

    expect(replicatedPaths(config)).toEqual([{ path: "/data/app.sqlite" }]);
    expect(config).not.toMatch(/^\s*-\s*path:\s*\S*catalog\.sqlite\s*$/mu);
  });

  test("a heavy catalog write transaction never holds the application database's write lock", () => {
    const { app, catalog, catalogPath } = scratchDatabase();

    seedApp(app);
    seedCatalog(catalog);

    catalog.sqlite.run("BEGIN IMMEDIATE");
    catalog.sqlite.run("update postings set missing_polls = missing_polls + 1");

    try {
      const started = performance.now();

      app.db.update(applications).set({ status: "approved", updatedAt: NOW }).run();

      expect(performance.now() - started).toBeLessThan(1000);
      expect(
        app.sqlite.query("select status from applications where id = 'application-1'").get(),
      ).toEqual({ status: "approved" });

      const blocked = openCatalogDatabase(catalogPath);

      blocked.sqlite.run("PRAGMA busy_timeout = 25");
      expect(() => {
        blocked.sqlite.run("update postings set missing_polls = missing_polls + 1");
      }).toThrow(/busy|locked/iu);
      blocked.sqlite.close();
    } finally {
      catalog.sqlite.run("ROLLBACK");
      app.sqlite.close();
      catalog.sqlite.close();
    }
  });

  test("deleting and recreating catalog.sqlite leaves every user row and Application intact", () => {
    const { app, catalog, catalogPath } = scratchDatabase();

    seedApp(app);
    seedCatalog(catalog);

    catalog.sqlite.close();

    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${catalogPath}${suffix}`, { force: true });
    }

    const recreated = openCatalogDatabase(catalogPath);

    migrateCatalogDatabase(recreated.db, "drizzle-catalog");

    expect(recreated.sqlite.query("select count(*) as total from postings").get()).toEqual({
      total: 0,
    });
    expect(app.sqlite.query("select count(*) as total from users").get()).toEqual({ total: 1 });
    expect(
      app.sqlite
        .query("select company_name as company, posting_title as title from applications")
        .get(),
    ).toEqual({ company: "Ferro Cloud", title: "Senior Platform Engineer" });

    seedCatalog(recreated);
    app.db.update(applications).set({ status: "sent", sentAt: NOW }).run();

    expect(
      app.sqlite.query("select status from applications where id = 'application-1'").get(),
    ).toEqual({ status: "sent" });

    app.sqlite.close();
    recreated.sqlite.close();
  });
});
