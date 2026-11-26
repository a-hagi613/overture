import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { bgJobs, grants, users } from "../platform/db/schema.ts";
import {
  categoriesForRoles,
  isPaidUser,
  placesForLocations,
  preferencesChanged,
  pullPreferencesFor,
  queryKeyOf,
} from "./preferences.ts";
import { JOBS_PULL_USER_JOB_KIND, enqueueUserPull } from "./pull.ts";

const NOW = 1_800_000_000_000;

function migrated() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function seedUser(db: ReturnType<typeof migrated>, id: string) {
  db.insert(users)
    .values({
      createdAt: new Date(NOW),
      email: `${id}@example.test`,
      id,
      name: id,
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("preferences become a freehire search", () => {
  test("a taxonomy category reaches its freehire categories, and free text becomes a title word", () => {
    expect(categoriesForRoles(["software-it"])).toContain("backend");
    expect(categoriesForRoles(["education"])).toEqual(["education"]);
    expect(categoriesForRoles(["software-it", "Registered Nurse"])).toContain("healthcare");

    expect(pullPreferencesFor({ locations: [], roles: ["Night baker"] }).titleWords).toEqual([
      "Night baker",
    ]);
  });

  test("places resolve to countries and cities, and remote text still names its country", () => {
    expect(placesForLocations(["Toronto, Canada"])).toEqual({
      cities: ["Toronto"],
      countries: ["ca"],
      regions: [],
    });
    expect(placesForLocations(["Remote in Canada"]).countries).toEqual(["ca"]);
  });

  test("the group key is shared for the same roles and places and differs when either changes", () => {
    const first = pullPreferencesFor({ locations: ["Toronto, Canada"], roles: ["software-it"] });
    const same = pullPreferencesFor({ locations: ["Toronto, Canada"], roles: ["software-it"] });
    const otherRoles = pullPreferencesFor({ locations: ["Toronto, Canada"], roles: ["education"] });

    const otherPlaces = pullPreferencesFor({
      locations: ["Berlin, Germany"],
      roles: ["software-it"],
    });

    expect(queryKeyOf(first)).toBe(queryKeyOf(same));
    expect(queryKeyOf(first)).not.toBe(queryKeyOf(otherRoles));
    expect(queryKeyOf(first)).not.toBe(queryKeyOf(otherPlaces));
  });

  test("only a change to roles or places needs a new full pull", () => {
    const before = { locations: ["Toronto, Canada"], roles: ["software-it"] };

    expect(preferencesChanged(before, before)).toBe(false);
    expect(preferencesChanged(before, { ...before, roles: ["education"] })).toBe(true);
    expect(preferencesChanged(before, { ...before, locations: ["Berlin, Germany"] })).toBe(true);
  });
});

describe("paid versus trial", () => {
  test("an active period grant is paid, a trial grant is not", () => {
    const db = migrated();

    seedUser(db, "trial-user");
    seedUser(db, "paid-user");
    seedUser(db, "expired-user");

    db.insert(grants)
      .values([
        {
          createdAt: NOW,
          id: "trial-grant",
          quantity: 3,
          source: "trial",
          startsAt: NOW,
          userId: "trial-user",
        },
        {
          createdAt: NOW,
          expiresAt: NOW + 86_400_000,
          id: "period-grant",
          quantity: 50,
          source: "period",
          startsAt: NOW,
          userId: "paid-user",
        },
        {
          createdAt: NOW,
          expiresAt: NOW - 1,
          id: "expired-grant",
          quantity: 50,
          source: "period",
          startsAt: NOW - 86_400_000,
          userId: "expired-user",
        },
      ])
      .run();

    expect(isPaidUser(db, "paid-user", NOW)).toBe(true);
    expect(isPaidUser(db, "trial-user", NOW)).toBe(false);
    expect(isPaidUser(db, "expired-user", NOW)).toBe(false);
  });
});

describe("the immediate pull trigger", () => {
  test("queues one job per user even when onboarding finishes twice", () => {
    const db = migrated();
    const clock = { now: () => NOW };

    seedUser(db, "user-1");

    enqueueUserPull(db, clock, "user-1");
    enqueueUserPull(db, clock, "user-1");

    const queued = db.select().from(bgJobs).where(eq(bgJobs.kind, JOBS_PULL_USER_JOB_KIND)).all();

    expect(queued).toHaveLength(1);
    expect(queued[0]?.dedupeKey).toBe(`${JOBS_PULL_USER_JOB_KIND}:user-1`);
  });
});
