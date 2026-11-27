import { describe, expect, test } from "bun:test";

import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { applications, matches, users } from "../platform/db/schema.ts";

import { matchesPageOf, reasonsOf } from "./matches-page.ts";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function freshDatabases() {
  const { db, sqlite } = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  db.insert(users)
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

  catalog.db
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: "northwind.example",
      id: "company-1",
      name: "Northwind Labs",
      nameNorm: "northwind labs",
    })
    .run();

  catalog.db
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "northwind",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();

  return { catalogDb: catalog.db, db, sqlite };
}

function addPosting(
  catalogDb: ReturnType<typeof freshDatabases>["catalogDb"],
  id: string,
  title: string,
  options: { postedAt?: number | null; status?: "open" | "closed" } = {},
) {
  catalogDb
    .insert(postings)
    .values({
      applyUrl: `https://northwind.example/${id}/apply`,
      applyUrlNorm: `https://northwind.example/${id}/apply`,
      ats: "greenhouse",
      atsJobId: id,
      boardId: "board-1",
      companyId: "company-1",
      dedupeKey: `greenhouse:${id}`,
      firstSeenAt: NOW,
      id,
      lastSeenAt: NOW,
      locationRaw: "Toronto, ON",
      postedAt: options.postedAt ?? null,
      status: options.status ?? "open",
      title,
      titleNorm: title.toLowerCase(),
      url: `https://northwind.example/${id}`,
    })
    .run();
}

function addApplication(
  db: ReturnType<typeof freshDatabases>["db"],
  id: string,
  postingId: string,
) {
  db.insert(applications)
    .values({
      companyId: "company-1",
      companyName: "Northwind Labs",
      companyNameNorm: "northwind labs",
      createdAt: NOW,
      id,
      origin: "manual",
      postingId,
      postingTitle: "Platform Engineer",
      postingUrl: "https://northwind.example/apply",
      status: "preparing",
      updatedAt: NOW,
      userId: "user-1",
    })
    .run();
}

describe("matchesPageOf", () => {
  test("orders by stored score, then newest posting, then job id", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "job-b", "Platform Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-a", "Backend Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-c", "DevOps Engineer", { postedAt: NOW - DAY });

    db.insert(matches)
      .values([
        { codeRank: 99.4, postingId: "job-c", score: 92, userId: "user-1" },
        { codeRank: 98.1, postingId: "job-b", score: 81, userId: "user-1" },
        { codeRank: 97.2, postingId: "job-a", score: 81, userId: "user-1" },
      ])
      .run();

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 10 });

    expect(page.items.map((row) => row.id)).toEqual(["job-c", "job-a", "job-b"]);
    expect(JSON.stringify(page)).not.toContain("99.4");
    expect(JSON.stringify(page)).not.toContain("codeRank");
  });

  test("leaves an unscored job as null and sorts it after every score", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "job-scored", "Platform Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-scoring", "Backend Engineer", { postedAt: NOW + DAY });

    db.insert(matches)
      .values([
        { codeRank: 99.9, postingId: "job-scoring", userId: "user-1" },
        { codeRank: 91.1, postingId: "job-scored", score: 64, userId: "user-1" },
      ])
      .run();

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 10 });

    expect(page.items.map((row) => row.id)).toEqual(["job-scored", "job-scoring"]);
    expect(page.items.map((row) => row.score)).toEqual([64, null]);
  });

  test("pages never repeat or skip a row and keep the order stable", () => {
    const { catalogDb, db } = freshDatabases();

    const ids = Array.from({ length: 7 }, (_, index) => `job-${String(index + 1)}`);

    for (const id of ids) {
      addPosting(catalogDb, id, `Engineer ${id}`, { postedAt: NOW });
    }

    db.insert(matches)
      .values(
        ids.map((id, index) => ({
          codeRank: 90 - index,
          postingId: id,
          score: 75,
          userId: "user-1",
        })),
      )
      .run();

    const first = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 3 });
    const second = matchesPageOf({ catalogDb, db }, "user-1", { page: 2, pageSize: 3 });
    const third = matchesPageOf({ catalogDb, db }, "user-1", { page: 3, pageSize: 3 });

    expect(first.totalPages).toBe(3);
    expect(first.total).toBe(7);
    expect([...first.items, ...second.items, ...third.items].map((row) => row.id)).toEqual(
      ids.toSorted(),
    );
  });

  test("clamps a page past the end to the last page instead of showing an empty list", () => {
    const { catalogDb, db } = freshDatabases();

    for (const id of ["job-1", "job-2", "job-3", "job-4"]) {
      addPosting(catalogDb, id, `Engineer ${id}`, { postedAt: NOW });
    }

    db.insert(matches)
      .values(
        ["job-1", "job-2", "job-3", "job-4"].map((id, index) => ({
          codeRank: 90 - index,
          postingId: id,
          score: 70,
          userId: "user-1",
        })),
      )
      .run();

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 9, pageSize: 3 });

    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items.map((row) => row.id)).toEqual(["job-4"]);
  });

  test("reports an application so the row can open it instead of applying again", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "job-picked", "Platform Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-new", "Backend Engineer", { postedAt: NOW });

    db.insert(matches)
      .values([
        { codeRank: 90, postingId: "job-picked", score: 88, userId: "user-1" },
        { codeRank: 89, postingId: "job-new", score: 70, userId: "user-1" },
      ])
      .run();

    addApplication(db, "application-1", "job-picked");

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 10 });

    expect(page.items.map((row) => [row.id, row.applicationId])).toEqual([
      ["job-picked", "application-1"],
      ["job-new", null],
    ]);
  });

  test("drops a closed posting from the page and its total", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "job-open", "Platform Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-closed", "Backend Engineer", {
      postedAt: NOW,
      status: "closed",
    });

    db.insert(matches)
      .values([
        { codeRank: 90, postingId: "job-open", score: 88, userId: "user-1" },
        { codeRank: 89, postingId: "job-closed", score: 86, userId: "user-1" },
      ])
      .run();

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 10 });

    expect(page.total).toBe(1);
    expect(page.items.map((row) => row.id)).toEqual(["job-open"]);
  });

  test("bands a stored score and leaves an unscored row without a band", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "job-strong", "Platform Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-good", "Backend Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-possible", "DevOps Engineer", { postedAt: NOW });
    addPosting(catalogDb, "job-scoring", "Data Engineer", { postedAt: NOW });

    db.insert(matches)
      .values([
        { codeRank: 94, postingId: "job-strong", score: 90, userId: "user-1" },
        { codeRank: 93, postingId: "job-good", score: 72, userId: "user-1" },
        { codeRank: 92, postingId: "job-possible", score: 55, userId: "user-1" },
        { codeRank: 91, postingId: "job-scoring", userId: "user-1" },
      ])
      .run();

    const page = matchesPageOf({ catalogDb, db }, "user-1", { page: 1, pageSize: 10 });

    expect(page.items.map((row) => row.band)).toEqual(["strong", "good", "possible", null]);
  });
});

describe("reasonsOf", () => {
  test("reads a stored JSON array of reasons", () => {
    expect(reasonsOf('["Same backend stack","Toronto role","Pay above target"]')).toEqual([
      "Same backend stack",
      "Toronto role",
      "Pay above target",
    ]);
  });

  test("splits a stored sentence string into at most three reasons", () => {
    expect(
      reasonsOf("Same backend stack. Toronto role. Pay above target. Employer replies fast."),
    ).toEqual(["Same backend stack.", "Toronto role.", "Pay above target."]);
  });

  test("returns no reasons for a job that has not been scored", () => {
    expect(reasonsOf(null)).toEqual([]);
    expect(reasonsOf("   ")).toEqual([]);
  });

  test("keeps a malformed stored value as one readable reason", () => {
    expect(reasonsOf("[not json")).toEqual(["[not json"]);
  });
});
