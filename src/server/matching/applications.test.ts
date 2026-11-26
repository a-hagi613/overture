import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { applicationEvents, applications, users } from "../platform/db/schema.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";

import { createApplication, postingDisplayFor } from "./applications.ts";

const NOW = 1_800_000_000_000;

function freshCatalog() {
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
      domain: "ferro.example",
      id: "company-1",
      industry: "Software",
      name: "Ferro Cloud",
      nameNorm: "ferro cloud",
    })
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
  catalog.db
    .insert(postings)
    .values({
      applyUrl: "https://boards.example/jobs/1/apply",
      applyUrlNorm: "https://boards.example/jobs/1/apply",
      ats: "greenhouse",
      atsJobId: "job-1",
      boardId: "board-1",
      companyId: "company-1",
      dedupeKey: "greenhouse:job-1",
      firstSeenAt: NOW,
      id: "posting-1",
      lastSeenAt: NOW,
      locationRaw: "Remote — Canada",
      salaryCurrency: "CAD",
      salaryMaxMinor: 19_000_000,
      salaryMinMinor: 16_000_000,
      salaryPeriod: "year",
      title: "Senior Platform Engineer",
      titleNorm: "senior platform engineer",
      url: "https://boards.example/jobs/1",
    })
    .run();

  return { catalogDb: catalog.db, db, sqlite };
}

describe("creating an Application", () => {
  test("copies the Posting and Company display fields onto the row", () => {
    const { catalogDb, db, sqlite } = freshCatalog();

    const id = createApplication({ catalogDb, db }, NOW, {
      origin: "auto",
      postingId: "posting-1",
      score: 82,
      userId: "user-1",
    });

    expect(id).not.toBeNull();
    expect(
      db
        .select()
        .from(applications)
        .where(eq(applications.id, id ?? ""))
        .get(),
    ).toMatchObject({
      applyUrl: "https://boards.example/jobs/1/apply",
      ats: "greenhouse",
      companyDomain: "ferro.example",
      companyId: "company-1",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      locationRaw: "Remote — Canada",
      postingId: "posting-1",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/1",
      salaryCurrency: "CAD",
      salaryMaxMinor: 19_000_000,
      salaryMinMinor: 16_000_000,
      salaryPeriod: "year",
    });
    expect(db.select().from(applicationEvents).all()).toMatchObject([
      {
        applicationId: id,
        fromValue: null,
        kind: "stage",
        source: "system",
        toValue: "queued",
        userId: "user-1",
      },
    ]);

    sqlite.close();
  });

  test("keeps the snapshot after the catalog prunes its Posting and Company", () => {
    const { catalogDb, db, sqlite } = freshCatalog();

    const id = createApplication({ catalogDb, db }, NOW, {
      origin: "manual",
      postingId: "posting-1",
      score: null,
      userId: "user-1",
    });

    expect(postingDisplayFor(catalogDb, "posting-1")).toBeDefined();

    catalogDb.delete(companies).where(eq(companies.id, "company-1")).run();
    catalogDb.delete(postings).where(eq(postings.id, "posting-1")).run();

    expect(postingDisplayFor(catalogDb, "posting-1")).toBeUndefined();
    expect(
      db
        .select()
        .from(applications)
        .where(eq(applications.id, id ?? ""))
        .get(),
    ).toMatchObject({
      companyName: "Ferro Cloud",
      postingTitle: "Senior Platform Engineer",
    });

    sqlite.close();
  });

  test("creates nothing when the Posting has already left the catalog", () => {
    const { catalogDb, db, sqlite } = freshCatalog();

    expect(
      createApplication({ catalogDb, db }, NOW, {
        origin: "manual",
        postingId: "posting-gone",
        score: null,
        userId: "user-1",
      }),
    ).toBeNull();
    expect(db.select().from(applications).all()).toHaveLength(0);

    sqlite.close();
  });
});
