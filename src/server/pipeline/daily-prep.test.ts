import { afterAll, describe, expect, test } from "bun:test";

import { localPartsAt } from "../platform/local-time.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { bgJobs, profiles, users } from "../platform/db/schema.ts";
import { setSetting } from "../platform/settings/index.ts";

import {
  DEFAULT_PREP_RUN_MINUTES,
  PREP_DAILY_JOB_KIND,
  PREP_STAGGER_START_MINUTES,
  PREP_STAGGER_WINDOW_MINUTES,
  ensurePrepNextQueued,
  prepRunMinutesFor,
  stableSlotHash,
} from "./daily-prep.ts";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

const clock = { now: () => NOW };

const opened: ReturnType<typeof openDatabase>[] = [];

function freshDb(userId: string) {
  const openedDatabase = openDatabase(":memory:");

  opened.push(openedDatabase);

  migrateDatabase(openedDatabase.db, "drizzle");

  const at = new Date(NOW);

  openedDatabase.db
    .insert(users)
    .values({
      createdAt: at,
      email: `${userId}@example.test`,
      emailVerified: true,
      id: userId,
      name: userId,
      updatedAt: at,
    })
    .run();
  openedDatabase.db
    .insert(profiles)
    .values({ createdAt: at, timezone: "UTC", updatedAt: at, userId })
    .run();

  return openedDatabase.db;
}

function localMinutes(at: number) {
  const parts = localPartsAt(at, "UTC");

  return parts.hour * 60 + parts.minute;
}

afterAll(() => {
  for (const openedDatabase of opened) {
    openedDatabase.sqlite.close();
  }
});

describe("the prep staggering slot", () => {
  test("every user gets a stable FNV-1a slot inside 05:00-07:30", () => {
    const ids = Array.from({ length: 180 }, (_, index) => `user-${String(index)}`);
    const slots = new Set<number>();

    for (const id of ids) {
      const minutes = prepRunMinutesFor(id, null);

      slots.add(minutes);
      expect(minutes).toBeGreaterThanOrEqual(PREP_STAGGER_START_MINUTES);
      expect(minutes).toBeLessThan(PREP_STAGGER_START_MINUTES + PREP_STAGGER_WINDOW_MINUTES);
      expect(prepRunMinutesFor(id, null)).toBe(minutes);
    }

    expect(slots.size).toBeGreaterThan(80);
  });

  test("the hash is deterministic and non-negative", () => {
    expect(stableSlotHash("user-one")).toBe(stableSlotHash("user-one"));
    expect(stableSlotHash("user-one")).toBeGreaterThanOrEqual(0);
    expect(stableSlotHash("user-two")).not.toBe(stableSlotHash("user-one"));
  });

  test("a stored admin time overrides the stagger, and an invalid one keeps 07:00", () => {
    expect(prepRunMinutesFor("user-one", "06:15")).toBe(375);
    expect(prepRunMinutesFor("user-one", "not-a-time")).toBe(DEFAULT_PREP_RUN_MINUTES);
  });
});

describe("the queued prep run", () => {
  test("schedules the user's staggered slot when no admin time is stored", () => {
    const db = freshDb("user-staggered");
    const runAt = ensurePrepNextQueued(db, clock, "user-staggered");

    const job = db
      .select()
      .from(bgJobs)
      .all()
      .find((row) => row.kind === PREP_DAILY_JOB_KIND);

    expect(localMinutes(runAt)).toBe(prepRunMinutesFor("user-staggered", null));
    expect(runAt).toBeGreaterThan(NOW);
    expect(job?.runAt).toBe(runAt);
  });

  test("keeps the admin prep.run_local_time override for tests", () => {
    const db = freshDb("user-override");

    setSetting(db, clock, "prep.run_local_time", "06:45", "test");

    const runAt = ensurePrepNextQueued(db, clock, "user-override");

    expect(localMinutes(runAt)).toBe(6 * 60 + 45);
  });
});
