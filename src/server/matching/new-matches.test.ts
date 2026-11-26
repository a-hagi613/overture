import { describe, expect, test } from "bun:test";

import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { matches, users } from "../platform/db/schema.ts";

import { createApplication } from "./applications.ts";
import { newMatchesOf } from "./new-matches.ts";

const NOW = 1_800_000_000_000;

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
  status: "open" | "closed" = "open",
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
      status,
      title,
      titleNorm: title.toLowerCase(),
      url: `https://northwind.example/${id}`,
    })
    .run();
}

describe("newMatchesOf", () => {
  test("keeps code rank private and leaves an unscored match as null", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "posting-scored", "Platform Engineer");
    addPosting(catalogDb, "posting-scoring", "Site Reliability Engineer");

    db.insert(matches)
      .values([
        { codeRank: 94.6, postingId: "posting-scored", score: 88, userId: "user-1" },
        { codeRank: 91.2, postingId: "posting-scoring", userId: "user-1" },
      ])
      .run();

    const view = newMatchesOf({ catalogDb, db }, "user-1", 3);

    expect(view.total).toBe(2);
    expect(view.items).toEqual([
      {
        company: "Northwind Labs",
        id: "posting-scored",
        location: "Toronto, ON",
        score: 88,
        title: "Platform Engineer",
      },
      {
        company: "Northwind Labs",
        id: "posting-scoring",
        location: "Toronto, ON",
        score: null,
        title: "Site Reliability Engineer",
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("94.6");
    expect(JSON.stringify(view)).not.toContain("91.2");
  });

  test("hides matches the user already picked and keeps the total honest", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "posting-new", "Backend Engineer");
    addPosting(catalogDb, "posting-picked", "DevOps Engineer");

    db.insert(matches)
      .values([
        { codeRank: 90, postingId: "posting-new", userId: "user-1" },
        { codeRank: 89, postingId: "posting-picked", userId: "user-1" },
      ])
      .run();

    const applicationId = createApplication({ catalogDb, db }, NOW, {
      origin: "manual",
      postingId: "posting-picked",
      score: null,
      userId: "user-1",
    });

    expect(applicationId).not.toBeNull();

    const view = newMatchesOf({ catalogDb, db }, "user-1", 3);

    expect(view.total).toBe(1);
    expect(view.items.map((item) => item.id)).toEqual(["posting-new"]);
  });

  test("counts only matches whose posting is still open", () => {
    const { catalogDb, db } = freshDatabases();

    addPosting(catalogDb, "posting-open", "Platform Engineer");
    addPosting(catalogDb, "posting-closed", "DevOps Engineer", "closed");

    db.insert(matches)
      .values([
        { codeRank: 95, postingId: "posting-open", userId: "user-1" },
        { codeRank: 94, postingId: "posting-closed", userId: "user-1" },
      ])
      .run();

    const view = newMatchesOf({ catalogDb, db }, "user-1", 3);

    expect(view.total).toBe(1);
    expect(view.items.map((item) => item.id)).toEqual(["posting-open"]);
  });

  test("caps the rows it returns while the total counts every unpicked match", () => {
    const { catalogDb, db } = freshDatabases();

    for (const index of [1, 2, 3, 4]) {
      addPosting(catalogDb, `posting-${String(index)}`, `Engineer ${String(index)}`);
    }

    db.insert(matches)
      .values(
        [1, 2, 3, 4].map((index) => ({
          codeRank: 100 - index,
          postingId: `posting-${String(index)}`,
          userId: "user-1",
        })),
      )
      .run();

    const view = newMatchesOf({ catalogDb, db }, "user-1", 3);

    expect(view.total).toBe(4);
    expect(view.items.map((item) => item.id)).toEqual(["posting-1", "posting-2", "posting-3"]);
  });
});
