import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../db/client.ts";

import { openCatalogDatabase, openDatabase } from "../db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../db/migrate.ts";
import { applications, bgJobs, users } from "../db/schema.ts";
import {
  companies,
  companyBoards,
  postingQuestions,
  postingTags,
  postings,
} from "../db/catalog-schema.ts";
import { runRetention } from "./retention.ts";

const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;

const clock = { now: () => NOW };

const countSchema = z.object({ total: z.number() });
const rowidSchema = z.object({ rowid: z.number() });

const openHandles: Database[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
});

function fresh() {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  openHandles.push(app.sqlite, catalog.sqlite);

  app.db
    .insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "retention@example.test",
      emailVerified: true,
      id: "user-1",
      name: "Retention",
      role: "owner",
      updatedAt: new Date(NOW),
    })
    .run();

  catalog.db
    .insert(companies)
    .values({ createdAt: NOW, id: "company-1", name: "Ferro Cloud", nameNorm: "ferro cloud" })
    .run();
  catalog.db
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "ferro",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();

  return { app: app.db, appSqlite: app.sqlite, catalog: catalog.db, catalogSqlite: catalog.sqlite };
}

function seedPosting(
  catalog: CatalogDatabase,
  posting: {
    readonly closedAt: number | null;
    readonly description?: boolean;
    readonly id: string;
  },
) {
  catalog
    .insert(postings)
    .values({
      applyUrlNorm: `https://boards.example/jobs/${posting.id}`,
      ats: "greenhouse",
      atsJobId: posting.id,
      boardId: "board-1",
      closedAt: posting.closedAt,
      companyId: "company-1",
      dedupeKey: `greenhouse:${posting.id}`,
      descriptionGz:
        posting.description === false ? null : Buffer.from(`${posting.id} description`),
      descriptionHash: `hash-${posting.id}`,
      firstSeenAt: NOW - 120 * DAY_MS,
      id: posting.id,
      lastSeenAt: NOW - 60 * DAY_MS,
      title: `Engineer ${posting.id}`,
      titleNorm: `engineer ${posting.id}`,
      url: `https://boards.example/jobs/${posting.id}`,
    })
    .run();
}

function seedTagsAndQuestions(catalog: CatalogDatabase, postingId: string) {
  catalog
    .insert(postingTags)
    .values({ dimension: "role", postingId, source: "rules", value: "engineering" })
    .run();
  catalog
    .insert(postingQuestions)
    .values({ fieldName: "phone", position: 0, postingId, questionId: "question-1" })
    .run();
}

function postingRow(catalog: CatalogDatabase, id: string) {
  return catalog.select().from(postings).where(eq(postings.id, id)).get();
}

function countRows(sqlite: Database, statement: string, binding: string | number) {
  return countSchema.parse(sqlite.query(statement).get(binding)).total;
}

function descriptionsRemaining(catalog: CatalogDatabase, ids: readonly string[]) {
  return ids.filter((id) => (postingRow(catalog, id)?.descriptionGz ?? null) !== null).length;
}

function seedApplication(
  app: AppDatabase,
  application: {
    readonly id: string;
    readonly postingId: string;
    readonly status: "approved" | "sent";
  },
) {
  app
    .insert(applications)
    .values({
      applyUrl: `https://boards.example/jobs/${application.postingId}/apply`,
      ats: "greenhouse",
      companyDomain: "ferro.example",
      companyId: "company-1",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      createdAt: NOW,
      id: application.id,
      locationRaw: "Remote — Canada",
      origin: "auto",
      postingId: application.postingId,
      postingTitle: `Engineer ${application.postingId}`,
      postingUrl: `https://boards.example/jobs/${application.postingId}`,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
      status: application.status,
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();
}

describe("pruning the catalog by age", () => {
  test("nulls a description only once its Posting has been closed 30 days", async () => {
    const { app, catalog } = fresh();

    seedPosting(catalog, { closedAt: NOW - 31 * DAY_MS, id: "old" });
    seedPosting(catalog, { closedAt: NOW - 31 * DAY_MS, description: false, id: "old-empty" });
    seedPosting(catalog, { closedAt: NOW - 29 * DAY_MS, id: "recent" });
    seedPosting(catalog, { closedAt: null, id: "open" });

    const summary = await runRetention(app, catalog, clock);

    expect(summary.descriptionsNulled).toBe(1);
    expect(summary.descriptionsCapped).toBe(false);
    expect(postingRow(catalog, "old")?.descriptionGz).toBeNull();
    expect(postingRow(catalog, "old")?.descriptionHash).toBe("hash-old");
    expect(postingRow(catalog, "old")?.title).toBe("Engineer old");
    expect(postingRow(catalog, "recent")?.descriptionGz).not.toBeNull();
    expect(postingRow(catalog, "open")?.descriptionGz).not.toBeNull();
  });

  test("deletes a Posting in the deletion window instead of only nulling its description", async () => {
    const { app, catalog } = fresh();

    seedPosting(catalog, { closedAt: NOW - 91 * DAY_MS, id: "ancient" });

    const summary = await runRetention(app, catalog, clock);

    expect(summary.descriptionsNulled).toBe(0);
    expect(summary.postingsDeleted).toBe(1);
    expect(postingRow(catalog, "ancient")).toBeUndefined();
  });

  test("deletes a Posting only once it has been closed 90 days, with its tags, questions and FTS entry", async () => {
    const { app, catalog, catalogSqlite } = fresh();

    seedPosting(catalog, { closedAt: NOW - 91 * DAY_MS, id: "ancient" });
    seedPosting(catalog, { closedAt: NOW - 89 * DAY_MS, id: "recent-closed" });
    seedTagsAndQuestions(catalog, "ancient");
    seedTagsAndQuestions(catalog, "recent-closed");

    const { rowid } = rowidSchema.parse(
      catalogSqlite.query("select rowid from postings where id = 'ancient'").get(),
    );

    catalogSqlite.run(
      "insert into postings_fts (rowid, title, company, location, department) values (?, 'Engineer ancient', 'Ferro Cloud', null, null)",
      [rowid],
    );

    const summary = await runRetention(app, catalog, clock);

    expect(summary.postingsDeleted).toBe(1);
    expect(postingRow(catalog, "ancient")).toBeUndefined();
    expect(
      countRows(
        catalogSqlite,
        "select count(*) as total from posting_tags where posting_id = ?",
        "ancient",
      ),
    ).toBe(0);
    expect(
      countRows(
        catalogSqlite,
        "select count(*) as total from posting_questions where posting_id = ?",
        "ancient",
      ),
    ).toBe(0);
    expect(
      countRows(catalogSqlite, "select count(*) as total from postings_fts where rowid = ?", rowid),
    ).toBe(0);
    expect(postingRow(catalog, "recent-closed")).toBeDefined();
    expect(
      countRows(
        catalogSqlite,
        "select count(*) as total from posting_tags where posting_id = ?",
        "recent-closed",
      ),
    ).toBe(1);
  });
});

describe("bounded catalog pruning", () => {
  test("nulling stops at the per-run chunk cap and resumes on the next run", async () => {
    const { app, catalog } = fresh();
    const ids = ["a", "b", "c", "d", "e"];

    for (const id of ids) {
      seedPosting(catalog, { closedAt: NOW - 31 * DAY_MS, id });
    }

    const first = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 2 });

    expect(first.descriptionsNulled).toBe(4);
    expect(first.descriptionsCapped).toBe(true);
    expect(descriptionsRemaining(catalog, ids)).toBe(1);

    const second = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 2 });

    expect(second.descriptionsNulled).toBe(1);
    expect(second.descriptionsCapped).toBe(false);
    expect(descriptionsRemaining(catalog, ids)).toBe(0);
  });

  test("deleting stops at the per-run chunk cap without touching recent or open Postings", async () => {
    const { app, catalog } = fresh();
    const ids = ["a", "b", "c", "d", "e"];

    for (const id of ids) {
      seedPosting(catalog, { closedAt: NOW - 91 * DAY_MS, id });
    }

    seedPosting(catalog, { closedAt: NOW - 89 * DAY_MS, id: "recent-closed" });
    seedPosting(catalog, { closedAt: null, id: "open" });

    const first = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 2 });

    expect(first.postingsDeleted).toBe(4);
    expect(first.postingsCapped).toBe(true);
    expect(ids.filter((id) => postingRow(catalog, id) !== undefined)).toHaveLength(1);

    const second = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 2 });

    expect(second.postingsDeleted).toBe(1);
    expect(second.postingsCapped).toBe(false);

    const third = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 2 });

    expect(third.postingsDeleted).toBe(0);
    expect(third.postingsCapped).toBe(false);
    expect(postingRow(catalog, "recent-closed")).toBeDefined();
    expect(postingRow(catalog, "open")).toBeDefined();
  });
});

describe("held postings never stall catalog cleanup", () => {
  test("the keyset cursor moves past the oldest held Postings and deletes later ones", async () => {
    const { app, catalog } = fresh();

    seedPosting(catalog, { closedAt: NOW - 100 * DAY_MS, id: "held-a" });
    seedPosting(catalog, { closedAt: NOW - 100 * DAY_MS, id: "held-b" });
    seedPosting(catalog, { closedAt: NOW - 95 * DAY_MS, id: "gone-a" });
    seedPosting(catalog, { closedAt: NOW - 95 * DAY_MS, id: "gone-b" });

    seedApplication(app, { id: "application-a", postingId: "held-a", status: "approved" });
    seedApplication(app, { id: "application-b", postingId: "held-b", status: "approved" });

    const summary = await runRetention(app, catalog, clock, { chunkRows: 2, maxChunks: 4 });

    expect(summary.postingsDeleted).toBe(2);
    expect(summary.postingsHeld).toBe(2);
    expect(summary.postingsCapped).toBe(false);
    expect(postingRow(catalog, "held-a")).toBeDefined();
    expect(postingRow(catalog, "held-b")).toBeDefined();
    expect(postingRow(catalog, "gone-a")).toBeUndefined();
    expect(postingRow(catalog, "gone-b")).toBeUndefined();
  });
});

describe("finished job retention", () => {
  test("deletes an admin-cancelled failed job but keeps a genuine failure", async () => {
    const { app, catalog } = fresh();

    app
      .insert(bgJobs)
      .values([
        {
          attempts: 1,
          createdAt: NOW - 20 * DAY_MS,
          id: "job-cancelled",
          kind: "application.send",
          lastError: "Cancelled from the admin jobs page.",
          maxAttempts: 1,
          payload: "{}",
          runAt: NOW - 20 * DAY_MS,
          status: "failed",
          updatedAt: NOW - 20 * DAY_MS,
        },
        {
          attempts: 1,
          createdAt: NOW - 20 * DAY_MS,
          id: "job-failed",
          kind: "application.send",
          lastError: "the form changed",
          maxAttempts: 1,
          payload: "{}",
          runAt: NOW - 20 * DAY_MS,
          status: "failed",
          updatedAt: NOW - 20 * DAY_MS,
        },
      ])
      .run();

    const summary = await runRetention(app, catalog, clock);

    expect(summary.cancelledJobs).toBe(1);
    expect(
      app
        .select({ id: bgJobs.id })
        .from(bgJobs)
        .all()
        .map((row) => row.id),
    ).toEqual(["job-failed"]);
  });
});

describe("the two files stay apart", () => {
  test("pruning a Posting leaves every Application row and its snapshot untouched", async () => {
    const { app, appSqlite, catalog } = fresh();

    seedPosting(catalog, { closedAt: NOW - 91 * DAY_MS, id: "ancient" });
    seedApplication(app, { id: "application-1", postingId: "ancient", status: "sent" });

    const before = appSqlite.query("select * from applications order by id").all();

    const summary = await runRetention(app, catalog, clock);

    expect(summary.postingsDeleted).toBe(1);
    expect(postingRow(catalog, "ancient")).toBeUndefined();
    expect(appSqlite.query("select * from applications order by id").all()).toEqual(before);
    expect(
      appSqlite
        .query(
          "select company_name as company, location_raw as location, posting_title as title from applications",
        )
        .get(),
    ).toEqual({ company: "Ferro Cloud", location: "Remote — Canada", title: "Engineer ancient" });
  });

  test("a Posting with an unsent Application is held until the Application is skipped", async () => {
    const { app, catalog } = fresh();

    seedPosting(catalog, { closedAt: NOW - 91 * DAY_MS, id: "ancient" });
    seedApplication(app, { id: "application-1", postingId: "ancient", status: "approved" });

    const held = await runRetention(app, catalog, clock);

    expect(held.postingsDeleted).toBe(0);
    expect(held.postingsHeld).toBe(1);
    expect(postingRow(catalog, "ancient")).toBeDefined();

    app
      .update(applications)
      .set({ status: "skipped" })
      .where(eq(applications.id, "application-1"))
      .run();

    const released = await runRetention(app, catalog, clock);

    expect(released.postingsDeleted).toBe(1);
    expect(released.postingsHeld).toBe(0);
    expect(postingRow(catalog, "ancient")).toBeUndefined();
    expect(app.select({ id: applications.id }).from(applications).all()).toHaveLength(1);
  });
});
