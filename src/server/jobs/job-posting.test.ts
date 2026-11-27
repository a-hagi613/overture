import { afterEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";

import { eq } from "drizzle-orm";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { companies, companyBoards, postings } from "../platform/db/catalog-schema.ts";
import { jobs } from "../platform/db/schema.ts";
import { closeJobPosting, jobPostingById, jobPostingsById } from "./job-posting.ts";

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

  return { catalogDb: catalog.db, db: app.db };
}

function jobValues(overrides: Partial<typeof jobs.$inferInsert> = {}) {
  return {
    applyUrl: "https://jobs.eu.lever.co/acme/123/apply",
    applyVia: "direct",
    atsJobId: "123",
    boardToken: "acme",
    cities: JSON.stringify(["Toronto"]),
    closedAt: null,
    company: "Acme",
    companyNorm: "acme",
    companySlug: "acme",
    countries: JSON.stringify(["ca"]),
    createdAt: NOW,
    dedupeKey: "acme|senior go engineer|toronto",
    description: "Build the payments platform.",
    descriptionHash: "hash-1",
    externalId: "acme:123",
    firstSeenAt: NOW,
    freehireSource: "lever",
    id: "senior-go-engineer-acme",
    language: "en",
    lastSeenAt: NOW,
    regions: JSON.stringify(["north_america"]),
    salaryCurrency: "CAD",
    salaryMax: 150_000,
    salaryMin: 120_000,
    salaryPeriod: "year" as const,
    source: "lever" as const,
    status: "open" as const,
    title: "Senior Go Engineer",
    titleNorm: "senior go engineer",
    updatedAt: NOW,
    url: "https://jobs.lever.co/acme/123",
    workMode: "remote" as const,
    ...overrides,
  } satisfies typeof jobs.$inferInsert;
}

function seedCatalogJob(
  catalogDb: ReturnType<typeof openCatalogDatabase>["db"],
  overrides: { description?: string; id?: string; region?: "us" | "eu" } = {},
) {
  const companyId = "company-catalog";
  const boardId = "board-catalog";
  const postingId = overrides.id ?? "catalog-posting";

  catalogDb
    .insert(companies)
    .values({
      createdAt: NOW,
      domain: "catalog.test",
      id: companyId,
      name: "Catalog Co",
      nameNorm: "catalog co",
    })
    .run();
  catalogDb
    .insert(companyBoards)
    .values({
      ats: "greenhouse",
      boardToken: "catalogco",
      companyId,
      createdAt: NOW,
      id: boardId,
      region: overrides.region ?? "us",
      source: "v1_seed",
    })
    .run();
  catalogDb
    .insert(postings)
    .values({
      applyUrlNorm: "https://boards.example/catalog",
      ats: "greenhouse",
      atsJobId: "catalog-job",
      boardId,
      city: "Ottawa",
      closedAt: null,
      companyId,
      countryCode: "CA",
      dedupeKey: "catalog:job",
      descriptionGz: gzipSync(Buffer.from(overrides.description ?? "Catalog description.", "utf8")),
      descriptionHash: "catalog-hash",
      employmentType: "full_time",
      firstSeenAt: NOW,
      id: postingId,
      language: "en",
      lastSeenAt: NOW,
      region: "Ontario",
      salaryCurrency: "CAD",
      salaryMaxMinor: 9_000_000,
      salaryMinMinor: 8_000_000,
      salaryPeriod: "year",
      status: "open",
      title: "Catalog Engineer",
      titleNorm: "catalog engineer",
      url: "https://boards.example/catalog",
      workplace: "hybrid",
    })
    .run();
}

describe("the jobs-first posting lookup", () => {
  test("maps a freehire job from app.sqlite while catalog.sqlite is completely empty", () => {
    const deps = openDatabases();

    deps.db.insert(jobs).values(jobValues()).run();

    const posting = jobPostingById(deps, "senior-go-engineer-acme");

    expect(posting).toEqual({
      applyUrl: "https://jobs.eu.lever.co/acme/123/apply",
      ats: "lever",
      atsJobId: "123",
      boardRegion: "eu",
      boardToken: "acme",
      city: "Toronto",
      closedAt: null,
      companyDomain: null,
      companyId: "acme",
      companyName: "Acme",
      companyNameNorm: "acme",
      countryCode: "CA",
      description: "Build the payments platform.",
      descriptionHash: "hash-1",
      employmentType: null,
      language: "en",
      locationRaw: null,
      open: true,
      origin: "jobs",
      postedAt: null,
      postingId: "senior-go-engineer-acme",
      questionsFetchedAt: null,
      region: "north_america",
      salaryCurrency: "CAD",
      salaryMaxMinor: 15_000_000,
      salaryMinMinor: 12_000_000,
      salaryPeriod: "year",
      title: "Senior Go Engineer",
      url: "https://jobs.lever.co/acme/123",
      workplace: "remote",
    });
  });

  test("keeps a freehire description as plain text instead of gunzipping it", () => {
    const deps = openDatabases();
    const plain = "Plain text that is not a gzip stream.";

    deps.db
      .insert(jobs)
      .values(jobValues({ description: plain }))
      .run();

    expect(jobPostingById(deps, "senior-go-engineer-acme")?.description).toBe(plain);
  });

  test("a closed freehire job is not open and keeps its close timestamp", () => {
    const deps = openDatabases();

    deps.db
      .insert(jobs)
      .values(jobValues({ closedAt: NOW + 1, status: "closed" }))
      .run();

    const posting = jobPostingById(deps, "senior-go-engineer-acme");

    expect(posting?.open).toBe(false);
    expect(posting?.closedAt).toBe(NOW + 1);
  });

  test("falls back to the catalog posting and gunzips its description", () => {
    const deps = openDatabases();

    seedCatalogJob(deps.catalogDb, { description: "Catalog description." });

    const posting = jobPostingById(deps, "catalog-posting");

    expect(posting).toMatchObject({
      ats: "greenhouse",
      atsJobId: "catalog-job",
      boardRegion: "us",
      boardToken: "catalogco",
      city: "Ottawa",
      companyDomain: "catalog.test",
      companyId: "company-catalog",
      companyName: "Catalog Co",
      companyNameNorm: "catalog co",
      countryCode: "CA",
      description: "Catalog description.",
      descriptionHash: "catalog-hash",
      employmentType: "full_time",
      origin: "catalog",
      region: "Ontario",
      salaryMaxMinor: 9_000_000,
      salaryMinMinor: 8_000_000,
      workplace: "hybrid",
    });
  });

  test("prefers the freehire job when the same id exists in both tables", () => {
    const deps = openDatabases();

    seedCatalogJob(deps.catalogDb, { id: "senior-go-engineer-acme" });
    deps.db.insert(jobs).values(jobValues()).run();

    expect(jobPostingById(deps, "senior-go-engineer-acme")?.origin).toBe("jobs");
  });

  test("resolves many ids at once and omits ids missing from both tables", () => {
    const deps = openDatabases();

    seedCatalogJob(deps.catalogDb);
    deps.db.insert(jobs).values(jobValues()).run();

    const resolved = jobPostingsById(deps, [
      "senior-go-engineer-acme",
      "catalog-posting",
      "missing-posting",
    ]);

    expect([...resolved.keys()]).toEqual(["senior-go-engineer-acme", "catalog-posting"]);
  });

  test("a US Lever board has no EU region", () => {
    const deps = openDatabases();

    deps.db
      .insert(jobs)
      .values(
        jobValues({
          applyUrl: "https://jobs.lever.co/acme/123/apply",
          url: "https://jobs.lever.co/acme/123",
        }),
      )
      .run();

    expect(jobPostingById(deps, "senior-go-engineer-acme")?.boardRegion).toBeNull();
  });
});

describe("closing a posting from liveness", () => {
  test("closes the freehire row and reports whether it was still open", () => {
    const deps = openDatabases();

    deps.db.insert(jobs).values(jobValues()).run();

    expect(closeJobPosting(deps, "senior-go-engineer-acme", NOW + 5)).toBe(true);

    const job = deps.db.select().from(jobs).where(eq(jobs.id, "senior-go-engineer-acme")).get();

    expect(job).toMatchObject({ closedAt: NOW + 5, status: "closed" });
    expect(closeJobPosting(deps, "senior-go-engineer-acme", NOW + 6)).toBe(false);
  });
});
