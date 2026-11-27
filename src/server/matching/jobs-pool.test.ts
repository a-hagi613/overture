import { describe, expect, test } from "bun:test";

import type { TargetsInput } from "../../shared/targets.ts";

import { emptyTargets } from "../../shared/targets.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobPlaces, jobs } from "../platform/db/schema.ts";
import { createClock } from "../platform/ports/clock.ts";
import {
  createJobsPool,
  criteriaFor,
  filterPoolJobs,
  isNonJobTitle,
  languageAccepted,
} from "./jobs-pool.ts";
import type { JobPoolCriteria, PoolJob } from "./jobs-pool.ts";

const NOW = 1_800_000_000_000;

function targets(overrides: Partial<TargetsInput> = {}) {
  return {
    ...emptyTargets,
    locations: ["city:ca:toronto"],
    roles: ["backend"],
    ...overrides,
  } satisfies TargetsInput;
}

function criteria(overrides: Partial<JobPoolCriteria> = {}) {
  return {
    appliedJobIds: [],
    categories: ["backend"],
    cooldownEmployers: [],
    excludedEmployers: [],
    languages: ["en"],
    placeIds: ["country:ca", "city:ca:toronto"],
    titleWords: [],
    ...overrides,
  } satisfies JobPoolCriteria;
}

function job(overrides: Partial<PoolJob> = {}) {
  return {
    category: "backend",
    company: "Acme",
    companySlug: "acme",
    description: "Build Go services.",
    descriptionHash: "hash-1",
    id: "job-1",
    language: "en",
    locationRaw: "Toronto, Canada",
    placeIds: ["country:ca", "city:ca:toronto"],
    postedAt: NOW,
    title: "Backend Engineer",
    titleNorm: "backend engineer",
    workMode: "onsite",
    ...overrides,
  } satisfies PoolJob;
}

describe("the language rule", () => {
  test("passes an undetected posting and rejects one the candidate does not speak", () => {
    expect(languageAccepted(null, ["en"])).toBe(true);
    expect(languageAccepted("en", ["en"])).toBe(true);
    expect(languageAccepted("ja", ["en"])).toBe(false);
  });

  test("recognises obvious non-jobs by title", () => {
    expect(isNonJobTitle("Join our talent pool")).toBe(true);
    expect(isNonJobTitle("General Application")).toBe(true);
    expect(isNonJobTitle("Senior Backend Engineer")).toBe(false);
  });
});

describe("the code pool", () => {
  test("keeps a job in a target category and marks a directly named category exact", () => {
    const rows = filterPoolJobs([job()], criteria());

    expect(rows.map((row) => row.id)).toEqual(["job-1"]);
    expect(rows[0]?.exactRole).toBe(true);
  });

  test("reaches a taxonomy category only as category-only, and a title word as exact", () => {
    const categoryOnly = filterPoolJobs(
      [job({ category: "frontend", title: "Frontend Engineer", titleNorm: "frontend engineer" })],
      criteria({
        categories: ["backend", "frontend"],
        exactCategories: [],
        exactTitleWords: [],
        titleWords: [],
      }),
    );

    const titleWord = filterPoolJobs(
      [job({ category: null, title: "Nurse Practitioner", titleNorm: "nurse practitioner" })],
      criteria({
        categories: [],
        exactCategories: [],
        exactTitleWords: ["nurse"],
        titleWords: ["nurse"],
      }),
    );

    expect(categoryOnly.map((row) => row.exactRole)).toEqual([false]);
    expect(titleWord.map((row) => row.exactRole)).toEqual([true]);
  });

  test("drops a remote job scoped to another country and keeps the one scoped to the candidate's", () => {
    const criteriaValue = criteria({ placeIds: ["remote:country:ca"] });

    const spain = job({
      id: "spain",
      locationRaw: "Remote Spain",
      placeIds: ["remote:country:es"],
      workMode: "remote",
    });

    const canada = job({
      id: "canada",
      locationRaw: "Remote Canada",
      placeIds: ["remote:country:ca"],
      workMode: "remote",
    });

    expect(filterPoolJobs([spain, canada], criteriaValue).map((row) => row.id)).toEqual(["canada"]);
  });

  test("matches a worldwide remote job only when the candidate asked for worldwide remote", () => {
    const worldwide = job({
      id: "worldwide",
      locationRaw: "Remote",
      placeIds: ["remote:worldwide"],
      workMode: "remote",
    });

    expect(filterPoolJobs([worldwide], criteria())).toHaveLength(0);
    expect(
      filterPoolJobs([worldwide], criteria({ placeIds: ["remote:worldwide"] })).map(
        (row) => row.id,
      ),
    ).toEqual(["worldwide"]);
  });

  test("drops an excluded employer, a cooldown employer, an applied job and an obvious non-job", () => {
    const rows = filterPoolJobs(
      [
        job({ id: "excluded", company: "Northwind Labs" }),
        job({ id: "cooldown", company: "Cedar Health" }),
        job({ id: "applied" }),
        job({ id: "not-a-job", title: "Talent Pool", titleNorm: "talent pool" }),
      ],
      criteria({
        appliedJobIds: ["applied"],
        cooldownEmployers: ["cedar health"],
        excludedEmployers: ["northwind labs"],
      }),
    );

    expect(rows).toHaveLength(0);
  });

  test("orders exact roles first, then newest, then id, so the scoring order is stable", () => {
    const rows = filterPoolJobs(
      [
        job({ category: "frontend", id: "category-new", postedAt: NOW + 10 }),
        job({ id: "exact-old", postedAt: NOW }),
        job({ id: "exact-new", postedAt: NOW + 5 }),
      ],
      criteria({ categories: ["backend", "frontend"], exactCategories: ["backend"] }),
    );

    expect(rows.map((row) => row.id)).toEqual(["exact-new", "exact-old", "category-new"]);
  });
});

describe("criteria from saved targets", () => {
  test("reads places, roles and worldwide remote intent", () => {
    const value = criteriaFor({
      appliedJobIds: [],
      cooldownEmployers: [],
      excludedEmployers: [],
      languages: ["en"],
      targets: targets({
        locations: ["country:ca", "remote:worldwide"],
        roles: ["backend", "Kubernetes"],
      }),
    });

    expect(value.categories).toEqual(["backend"]);
    expect(value.titleWords).toEqual(["kubernetes"]);
    expect(value.placeIds).toEqual(["country:ca", "remote:worldwide"]);
  });
});

describe("the jobs reader", () => {
  test("reads job places and returns only open jobs in the pool", () => {
    const { db, sqlite } = openDatabase(":memory:");

    migrateDatabase(db, "drizzle");

    const values = {
      applyUrl: "https://acme.example/apply",
      applyVia: "direct" as const,
      atsJobId: "123",
      boardToken: "acme",
      category: "backend",
      cities: '["toronto"]',
      company: "Acme",
      companyNorm: "acme",
      companySlug: "acme",
      countries: '["ca"]',
      createdAt: NOW,
      dedupeKey: "acme|backend engineer|toronto",
      description: "Build Go services.",
      descriptionHash: "hash-1",
      externalId: "acme:123",
      firstSeenAt: NOW,
      freehireSource: "greenhouse",
      id: "job-1",
      lastSeenAt: NOW,
      postedAt: NOW,
      source: "greenhouse" as const,
      status: "open" as const,
      title: "Backend Engineer",
      titleNorm: "backend engineer",
      updatedAt: NOW,
    };

    db.insert(jobs)
      .values([
        values,
        { ...values, externalId: "acme:456", id: "job-closed", status: "closed" as const },
      ])
      .run();
    db.insert(jobPlaces)
      .values([
        { jobId: "job-1", kind: "country", placeId: "country:ca" },
        { jobId: "job-1", kind: "city", placeId: "city:ca:toronto" },
      ])
      .run();

    const pool = createJobsPool({ clock: createClock(), db });

    expect(pool.read("user-1", targets(), ["en"]).jobs.map((row) => row.id)).toEqual(["job-1"]);

    sqlite.close();
  });
});
