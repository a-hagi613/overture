import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { jobPlaces, targets, users } from "../platform/db/schema.ts";
import { createJobStore } from "../jobs/store.ts";
import { promoteStoredTargetPlaces, rebuildStoredJobPlaces } from "./backfill.ts";

const NOW = 1_800_000_000_000;

function seeded() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: "owner@example.test",
      id: "user-1",
      name: "Owner",
      updatedAt: new Date(NOW),
    })
    .run();

  return db;
}

function insertTargets(
  db: ReturnType<typeof seeded>,
  locations: readonly string[],
  unresolved: readonly string[] = [],
) {
  db.insert(targets)
    .values({
      employmentTypes: "[]",
      locations: JSON.stringify(locations),
      roles: "[]",
      salaryCurrency: null,
      salaryFloorMinor: null,
      salaryPeriod: "year",
      seniorities: "[]",
      unresolvedLocations: JSON.stringify(unresolved),
      updatedAt: new Date(NOW),
      userId: "user-1",
      version: 1,
      workplaces: "[]",
    })
    .run();
}

function readTargets(db: ReturnType<typeof seeded>) {
  const row = db.select().from(targets).where(eq(targets.userId, "user-1")).get();

  return {
    locations: z.array(z.string()).parse(JSON.parse(row?.locations ?? "[]")),
    unresolved: z.array(z.string()).parse(JSON.parse(row?.unresolvedLocations ?? "[]")),
  };
}

describe("rebuilding job places after the migration", () => {
  test("a stored job gets its place ids back without a pull, once", () => {
    const db = seeded();

    createJobStore({ clock: { now: () => NOW }, db }).upsert(
      {
        apply_url: null,
        cities: ["Toronto"],
        closed_at: null,
        company: "Acme",
        company_slug: "acme",
        countries: ["ca"],
        created_at: "2026-11-20T09:00:00Z",
        description: null,
        enrichment: { category: "backend" },
        external_id: "acme:1",
        location: "Toronto, Canada",
        metros: null,
        posted_at: "2026-11-20T00:00:00Z",
        public_slug: "acme-1",
        reality: null,
        regions: ["north_america"],
        skills: null,
        source: "greenhouse",
        title: "Engineer",
        url: null,
        work_mode: "remote",
      },
      {
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        ats: "greenhouse",
        atsJobId: "1",
        boardToken: "acme",
        via: "direct",
      },
    );

    db.delete(jobPlaces).run();

    expect(rebuildStoredJobPlaces(db)).toBe(1);

    const placeIds = db
      .select()
      .from(jobPlaces)
      .all()
      .map((row) => row.placeId);

    expect(placeIds).toContain("city:ca:toronto");
    expect(placeIds).toContain("remote:country:ca");
    expect(rebuildStoredJobPlaces(db)).toBe(0);
  });
});

describe("promoting saved target locations", () => {
  test("converts every unambiguous value and keeps only truly ambiguous ones", () => {
    const db = seeded();

    insertTargets(db, ["Toronto, Canada", "Berlin", "Victoria", "Narnia"]);

    expect(promoteStoredTargetPlaces(db)).toBe(1);
    expect(readTargets(db)).toEqual({
      locations: ["city:ca:toronto", "city:de:berlin"],
      unresolved: ["Narnia", "Victoria"],
    });
  });

  test("is idempotent and never rewrites a settled row", () => {
    const db = seeded();

    insertTargets(db, ["city:ca:toronto"], ["Narnia"]);

    expect(promoteStoredTargetPlaces(db)).toBe(0);
    expect(readTargets(db)).toEqual({
      locations: ["city:ca:toronto"],
      unresolved: ["Narnia"],
    });
  });

  test("dismissing an unresolved value settles it", () => {
    const db = seeded();

    insertTargets(db, [], []);

    expect(promoteStoredTargetPlaces(db)).toBe(0);
    expect(readTargets(db)).toEqual({ locations: [], unresolved: [] });
  });
});
