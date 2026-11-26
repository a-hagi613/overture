import { describe, expect, test } from "bun:test";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobs } from "../platform/db/schema.ts";
import { eq } from "drizzle-orm";
import { createJobStore } from "./store.ts";
import { createJobReader } from "./reader.ts";

const NOW = 1_800_000_000_000;

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

const record: (overrides?: Partial<FreehireJobRecord>) => FreehireJobRecord = (overrides = {}) => ({
  apply_url: null,
  cities: ["Toronto"],
  closed_at: null,
  company: "Acme",
  company_slug: "acme",
  countries: ["ca"],
  created_at: "2026-11-20T09:00:00Z",
  description: null,
  enrichment: { category: "backend" },
  external_id: "acme:123",
  location: "Toronto, Canada",
  metros: null,
  posted_at: "2026-11-20T00:00:00Z",
  public_slug: "senior-go-engineer-acme",
  reality: null,
  regions: null,
  skills: null,
  source: "greenhouse",
  title: "Senior Go Engineer",
  url: null,
  work_mode: null,
  ...overrides,
});

function storeJob(db: ReturnType<typeof migrated>, job: FreehireJobRecord) {
  createJobStore({ clock: { now: () => NOW }, db }).upsert(job, {
    applyUrl: "https://job-boards.greenhouse.io/acme/jobs/123",
    ats: "greenhouse",
    atsJobId: "123",
    boardToken: "acme",
    via: "direct",
  });
}

describe("the freehire-shaped job read", () => {
  test("filters by category and open status", () => {
    const db = migrated();

    storeJob(db, record());
    storeJob(db, record({ public_slug: "teacher", enrichment: { category: "education" } }));

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: ["backend"],
      cities: [],
      countries: [],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id)).toEqual(["senior-go-engineer-acme"]);
  });

  test("ORs a job's countries and cities, matching freehire's geography rule", () => {
    const db = migrated();

    storeJob(db, record());
    storeJob(
      db,
      record({
        cities: ["Berlin"],
        company: "Bright",
        company_slug: "bright",
        countries: ["de"],
        external_id: "bright:7",
        public_slug: "bright-engineer",
      }),
    );

    const reader = createJobReader(db);

    const rows = reader.forPreferences({
      categories: [],
      cities: ["Toronto"],
      countries: ["de"],
      regions: [],
      titleWords: [],
    });

    expect(rows.map((row) => row.id).toSorted()).toEqual([
      "bright-engineer",
      "senior-go-engineer-acme",
    ]);
  });

  test("never returns a job a failed pull left closed", () => {
    const db = migrated();
    const job = record();

    storeJob(db, job);
    db.update(jobs)
      .set({ closedAt: NOW, status: "closed" })
      .where(eq(jobs.id, job.public_slug))
      .run();

    const reader = createJobReader(db);

    expect(
      reader.forPreferences({
        categories: [],
        cities: [],
        countries: [],
        regions: [],
        titleWords: [],
      }),
    ).toHaveLength(0);
  });
});
