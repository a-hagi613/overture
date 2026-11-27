import { afterEach, describe, expect, test } from "bun:test";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { jobs } from "../platform/db/schema.ts";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SECRET ??= "turnstile-secret";

Bun.env.TURNSTILE_SITE_KEY ??= "turnstile-site";

Bun.env.BETTER_AUTH_SECRET ??= "app-test-secret-value-1234";

Bun.env.MASTER_KEY_V1 ??= Buffer.from(new Uint8Array(32).fill(1)).toString("base64");

const { postingDetailOf } = await import("./matching.ts");
const { applicationWorkplaceOf } = await import("./applications.ts");

const NOW = 1_796_000_000_000;

const openHandles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of openHandles.splice(0)) {
    handle.close();
  }
});

function openDatabases() {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  openHandles.push(app.sqlite, catalog.sqlite);
  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  return { catalog, catalogDb: catalog.db, db: app.db };
}

function seedJob(db: ReturnType<typeof openDatabase>["db"]) {
  db.insert(jobs)
    .values({
      applyUrl: "https://jobs.lever.co/acme/123/apply",
      applyVia: "direct",
      atsJobId: "123",
      boardToken: "acme",
      cities: JSON.stringify(["Toronto"]),
      company: "Acme",
      companyNorm: "acme",
      companySlug: "acme",
      countries: JSON.stringify(["ca"]),
      createdAt: NOW,
      dedupeKey: "acme|senior go engineer",
      description: "Build the payments platform.",
      employmentType: "full_time",
      externalId: "acme:123",
      firstSeenAt: NOW,
      freehireSource: "lever",
      id: "posting-job",
      lastSeenAt: NOW,
      postedAt: NOW - 1000,
      salaryCurrency: "CAD",
      salaryMax: 150_000,
      salaryMin: 120_000,
      salaryPeriod: "year",
      source: "lever",
      title: "Senior Go Engineer",
      titleNorm: "senior go engineer",
      updatedAt: NOW,
      url: "https://jobs.lever.co/acme/123",
      workMode: "remote",
    })
    .run();
}

function seedCatalog(catalog: ReturnType<typeof openCatalogDatabase>["db"]) {
  catalog
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: "catalog.test",
      id: "company-1",
      name: "Catalog Co",
      nameNorm: "catalog co",
    })
    .run();
  catalog
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "catalogco",
      companyId: "company-1",
      createdAt: NOW,
      id: "board-1",
      source: "v1_seed",
    })
    .run();
  catalog
    .insert(postings)
    .values({
      applyUrlNorm: "https://boards.example/catalog",
      ats: "greenhouse",
      atsJobId: "catalog-job",
      boardId: "board-1",
      companyId: "company-1",
      dedupeKey: "catalog:job",
      firstSeenAt: NOW,
      id: "posting-catalog",
      lastSeenAt: NOW,
      salaryCurrency: "CAD",
      salaryMaxMinor: 9_000_000,
      salaryMinMinor: 8_000_000,
      salaryPeriod: "year",
      title: "Catalog Engineer",
      titleNorm: "catalog engineer",
      url: "https://boards.example/catalog",
      workplace: "hybrid",
    })
    .run();
}

describe("GET /postings/:id posting detail", () => {
  test("reads a freehire job with catalog.sqlite completely empty", () => {
    const deps = openDatabases();

    seedJob(deps.db);

    expect(postingDetailOf(deps, "posting-job")).toEqual({
      applyUrl: "https://jobs.lever.co/acme/123/apply",
      companyId: "acme",
      employmentType: "full_time",
      id: "posting-job",
      locationRaw: null,
      postedAt: NOW - 1000,
      salaryCurrency: "CAD",
      salaryMaxMinor: 15_000_000,
      salaryMinMinor: 12_000_000,
      salaryPeriod: "year",
      title: "Senior Go Engineer",
      url: "https://jobs.lever.co/acme/123",
      workplace: "remote",
    });
  });

  test("falls back to the catalog posting for a pre-cutover id", () => {
    const deps = openDatabases();

    seedCatalog(deps.catalogDb);

    expect(postingDetailOf(deps, "posting-catalog")).toMatchObject({
      companyId: "company-1",
      id: "posting-catalog",
      salaryMinMinor: 8_000_000,
      title: "Catalog Engineer",
      workplace: "hybrid",
    });
  });

  test("a missing posting stays a 404", () => {
    const deps = openDatabases();

    expect(postingDetailOf(deps, "missing")).toBeNull();
  });
});

describe("GET /applications/:id workplace", () => {
  test("reads the freehire job's work mode first", () => {
    const deps = openDatabases();

    seedJob(deps.db);

    expect(applicationWorkplaceOf(deps, "posting-job")).toBe("remote");
  });

  test("falls back to the catalog workplace", () => {
    const deps = openDatabases();

    seedCatalog(deps.catalogDb);

    expect(applicationWorkplaceOf(deps, "posting-catalog")).toBe("hybrid");
  });

  test("an unknown or missing posting has no workplace", () => {
    const deps = openDatabases();

    seedCatalog(deps.catalogDb);
    deps.catalogDb.update(postings).set({ workplace: "unknown" }).run();

    expect(applicationWorkplaceOf(deps, "posting-catalog")).toBeNull();
    expect(applicationWorkplaceOf(deps, "missing")).toBeNull();
  });
});
