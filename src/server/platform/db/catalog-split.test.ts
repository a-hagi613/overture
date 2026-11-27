import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      origin: "pick",
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

  test("Litestream owns the WAL checkpoints and the shutdown clocks nest", () => {
    const litestream = readFileSync("litestream.yml", "utf8");
    const fly = readFileSync("fly.toml", "utf8");
    const env = readFileSync("src/server/config/env.ts", "utf8");

    const appBudgetText =
      /KILL_TIMEOUT_MS:[\s\S]*?default\((?<milliseconds>\d[\d_]*)\)/u.exec(env)?.groups
        ?.milliseconds ?? "";

    const appBudgetMs = Number(appBudgetText.replaceAll("_", ""));

    const litestreamShutdownSeconds = Number(
      /^shutdown-timeout:\s*(?<seconds>\d+)s$/mu.exec(litestream)?.groups?.seconds ?? "",
    );

    const flyKillTimeoutSeconds = Number(
      /^kill_timeout\s*=\s*(?<seconds>\d+)$/mu.exec(fly)?.groups?.seconds ?? "",
    );

    expect(litestream).toMatch(/^\s*checkpoint-interval:\s*1m$/mu);
    expect(litestream).toMatch(/^\s*min-checkpoint-page-count:\s*1000$/mu);
    expect(appBudgetMs).toBe(240_000);
    expect(litestreamShutdownSeconds * 1000).toBeGreaterThan(appBudgetMs);
    expect(flyKillTimeoutSeconds * 1000).toBeGreaterThan(litestreamShutdownSeconds * 1000);
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

test("the catalog hot-path indexes exist after every migration", () => {
  const { app, catalog } = scratchDatabase();

  try {
    const names = z
      .array(z.object({ name: z.string() }))
      .parse(catalog.sqlite.query("select name from sqlite_master where type = 'index'").all())
      .map((row) => row.name);

    expect(names).toContain("companies_name_norm");
    expect(names).toContain("company_boards_ats_status_next_poll");
    expect(names).toContain("postings_apply_supported_status");
    expect(names).toContain("postings_company_requisition");
  } finally {
    app.sqlite.close();
    catalog.sqlite.close();
  }
});

const CATALOG_WINDOW_MIGRATION = "0002_catalog_28_boards";

function catalogMigrationsBeforeWindow() {
  const directory = mkdtempSync(join(tmpdir(), "catalog-window-migration-"));
  scratchDirectories.push(directory);

  const journal = z
    .object({
      entries: z.array(z.looseObject({ idx: z.number(), tag: z.string(), when: z.number() })),
      version: z.string(),
    })
    .parse(JSON.parse(readFileSync("drizzle-catalog/meta/_journal.json", "utf8")));

  const cutoff = journal.entries.findIndex((entry) => entry.tag === CATALOG_WINDOW_MIGRATION);

  if (cutoff === -1) {
    throw new Error(`migration ${CATALOG_WINDOW_MIGRATION} is missing from the catalog journal`);
  }

  const before = journal.entries.slice(0, cutoff);

  cpSync("drizzle-catalog/meta", join(directory, "meta"), { recursive: true });

  for (const entry of before) {
    cpSync(join("drizzle-catalog", `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(
    join(directory, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: before }, null, 2),
  );

  return directory;
}

test("the 0002 migration backfills apply_supported and status on existing postings", () => {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  try {
    migrateCatalogDatabase(db, catalogMigrationsBeforeWindow());

    sqlite.run(
      "insert into companies (id, name, name_norm, created_at) values ('company-1', 'Ferro Cloud', 'ferro cloud', ?)",
      [NOW],
    );

    for (const [id, ats] of [
      ["board-open", "greenhouse"],
      ["board-closed", "greenhouse"],
      ["board-unsupported", "smartrecruiters"],
    ] as const) {
      sqlite.run(
        "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values (?, 'company-1', ?, ?, 'us', 'active', 'v1_seed', ?)",
        [id, ats, id, NOW],
      );
    }

    const insertPosting = sqlite.prepare(
      `insert into postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
         first_seen_at, last_seen_at, closed_at, dedupe_key)
       values (?, ?, 'company-1', ?, ?, ?, ?, 'Engineer', 'engineer', ?, ?, ?, ?)`,
    );

    for (const [id, boardId, ats, closedAt] of [
      ["posting-open", "board-open", "greenhouse", null],
      ["posting-closed", "board-closed", "greenhouse", NOW],
      ["posting-unsupported", "board-unsupported", "smartrecruiters", null],
    ] as const) {
      const url = `https://example.test/${id}`;

      insertPosting.run(id, boardId, ats, id, url, url, NOW, NOW, closedAt, id);
    }

    migrateCatalogDatabase(db, "drizzle-catalog");

    const rows = z
      .array(
        z.object({
          applySupported: z.number(),
          closedAt: z.number().nullable(),
          id: z.string(),
          status: z.string(),
        }),
      )
      .parse(
        sqlite
          .query(
            "select id, apply_supported as applySupported, status, closed_at as closedAt from postings order by id",
          )
          .all(),
      );

    expect(rows).toEqual([
      { applySupported: 1, closedAt: NOW, id: "posting-closed", status: "closed" },
      { applySupported: 1, closedAt: null, id: "posting-open", status: "open" },
      { applySupported: 0, closedAt: null, id: "posting-unsupported", status: "open" },
    ]);
  } finally {
    sqlite.close();
  }
});
