import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs, users } from "../platform/db/schema.ts";
import { createJobStore } from "../jobs/store.ts";
import { targetsInputSchema } from "../../shared/targets.ts";
import { countMatchingJobs, createTargetsService } from "./targets.ts";

const NOW = 1_800_000_000_000;

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function record(overrides: Partial<FreehireJobRecord>) {
  return {
    apply_url: null,
    cities: ["Toronto"],
    closed_at: null,
    company: "Acme",
    company_slug: "acme",
    countries: ["ca"],
    created_at: null,
    description: null,
    enrichment: { category: "backend" },
    external_id: "acme:1",
    location: "Toronto, Canada",
    metros: null,
    posted_at: null,
    public_slug: "backend-toronto",
    reality: null,
    regions: null,
    skills: null,
    source: "greenhouse",
    title: "Backend Engineer",
    url: null,
    work_mode: null,
    ...overrides,
  };
}

function store(db: ReturnType<typeof migrated>, job: FreehireJobRecord) {
  createJobStore({ clock: { now: () => NOW }, db }).upsert(job, {
    applyUrl: `https://jobs.example/${job.public_slug}`,
    ats: "greenhouse",
    atsJobId: job.external_id,
    boardToken: "acme",
    via: "direct",
  });
}

const targets = {
  unresolvedLocations: [],
  unresolvedRoles: [],
};

describe("countMatchingJobs", () => {
  test("a freehire category matches, and a title word matches independently", () => {
    const db = migrated();

    store(db, record({}));
    store(
      db,
      record({
        cities: ["Toronto"],
        enrichment: { category: "healthcare" },
        external_id: "clinic:2",
        public_slug: "registered-nurse-toronto",
        title: "Registered Nurse",
      }),
    );

    expect(
      countMatchingJobs(db, { ...targets, locations: ["city:ca:toronto"], roles: ["backend"] }),
    ).toBe(1);
    expect(
      countMatchingJobs(db, { ...targets, locations: ["city:ca:toronto"], roles: ["registered"] }),
    ).toBe(1);
    expect(
      countMatchingJobs(db, {
        ...targets,
        locations: ["city:ca:toronto"],
        roles: ["backend", "registered"],
      }),
    ).toBe(2);
  });

  test("a place outside the job's place ids never matches", () => {
    const db = migrated();

    store(db, record({}));

    expect(
      countMatchingJobs(db, { ...targets, locations: ["city:de:berlin"], roles: ["backend"] }),
    ).toBe(0);
    expect(
      countMatchingJobs(db, { ...targets, locations: ["country:ca"], roles: ["backend"] }),
    ).toBe(1);
  });

  test("a closed job is not counted", () => {
    const db = migrated();

    store(db, record({}));
    db.update(jobs).set({ status: "closed" }).where(eq(jobs.id, "backend-toronto")).run();

    expect(
      countMatchingJobs(db, { ...targets, locations: ["country:ca"], roles: ["backend"] }),
    ).toBe(0);
  });

  test("an empty role or place list is zero, never the whole catalogue", () => {
    const db = migrated();

    store(db, record({}));

    expect(countMatchingJobs(db, { ...targets, locations: ["country:ca"], roles: [] })).toBe(0);
    expect(countMatchingJobs(db, { ...targets, locations: [], roles: ["backend"] })).toBe(0);
  });

  test("a new job is counted on the next call, so the cache cannot outlive a write", () => {
    const db = migrated();

    store(db, record({}));

    expect(
      countMatchingJobs(db, { ...targets, locations: ["country:ca"], roles: ["backend"] }),
    ).toBe(1);

    store(
      db,
      record({
        cities: ["Berlin"],
        countries: ["de"],
        external_id: "acme:2",
        public_slug: "backend-berlin",
      }),
    );

    expect(
      countMatchingJobs(db, { ...targets, locations: ["country:ca"], roles: ["backend"] }),
    ).toBe(1);
    expect(
      countMatchingJobs(db, { ...targets, locations: ["country:de"], roles: ["backend"] }),
    ).toBe(1);
  });
});

describe("saved preferences", () => {
  test("roles, title words, places and unresolved legacy values round-trip", async () => {
    const db = migrated();
    const service = createTargetsService({ clock: { now: () => NOW }, db });

    db.insert(users)
      .values({
        createdAt: new Date(NOW),
        email: "targets@example.test",
        id: "user-1",
        name: "Targets",
        updatedAt: new Date(NOW),
      })
      .run();

    const input = {
      locations: ["city:ca:toronto"],
      roles: ["backend", "kindergarten"],
      unresolvedLocations: ["Victoria"],
      unresolvedRoles: ["Data & AI"],
    };

    await service.save("user-1", input);

    const read = await service.read("user-1");

    expect(read.targets).toEqual(input);
    expect(read.version).toBe(1);
  });

  test("a removed preference field is rejected rather than silently stored", () => {
    const db = migrated();

    db.insert(users)
      .values({
        createdAt: new Date(NOW),
        email: "targets-2@example.test",
        id: "user-2",
        name: "Targets",
        updatedAt: new Date(NOW),
      })
      .run();

    const removed = {
      locations: ["city:ca:toronto"],
      roles: ["backend"],
      workplaces: ["remote"],
    };

    expect(() => targetsInputSchema.parse(removed)).toThrow();
  });
});
