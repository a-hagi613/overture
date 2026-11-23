import { describe, expect, test } from "bun:test";

import { eq } from "drizzle-orm";

import type { PauseReason } from "../../shared/copy.ts";
import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { events, profiles, users } from "../platform/db/schema.ts";

import {
  clearBlockerIfRecovered,
  pauseByUser,
  pauseForBlocker,
  resumeByUser,
} from "./running-state.ts";

const USER = "running-user";

const HIGHER_HOLDS = [
  "onboarding",
  "no_resume",
  "plan_ended",
  "payment_failed",
  "suspended",
  "no_mailbox",
] as const satisfies readonly PauseReason[];

function fresh(options: { pauseReason?: PauseReason | null; running?: boolean } = {}) {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const clock = createClock();
  const at = new Date(clock.now());

  db.insert(users)
    .values({
      createdAt: at,
      email: "running@example.com",
      emailVerified: true,
      id: USER,
      name: "Running Owner",
      role: "owner",
      updatedAt: at,
    })
    .run();

  if (options.pauseReason !== undefined || options.running !== undefined) {
    db.insert(profiles)
      .values({
        createdAt: at,
        languages: "[]",
        pauseReason: options.pauseReason ?? null,
        running: options.running ?? false,
        updatedAt: at,
        userId: USER,
      })
      .run();
  }

  return { clock, db, sqlite };
}

function profileOf(db: ReturnType<typeof fresh>["db"]) {
  return db.select().from(profiles).where(eq(profiles.userId, USER)).get();
}

function homeEvents(db: ReturnType<typeof fresh>["db"]) {
  return db.select().from(events).where(eq(events.topic, "home.updated")).all();
}

describe("Resume pressed by the person", () => {
  test("starts sending from no pause or a manual pause", () => {
    for (const pauseReason of [null, "user"] as const) {
      const { db, sqlite } = fresh({ pauseReason, running: false });

      expect(resumeByUser(db, createClock(), USER)).toEqual({ changed: true, ok: true });
      expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });

      sqlite.close();
    }
  });

  test("creates the profile for a person who has never had one", () => {
    const { db, sqlite } = fresh();

    expect(resumeByUser(db, createClock(), USER)).toEqual({ changed: true, ok: true });
    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });

    sqlite.close();
  });

  test("refuses every other hold and leaves it untouched", () => {
    for (const pauseReason of HIGHER_HOLDS) {
      const { db, sqlite } = fresh({ pauseReason, running: false });

      expect(resumeByUser(db, createClock(), USER)).toEqual({ ok: false, reason: pauseReason });
      expect(profileOf(db)).toMatchObject({ pauseReason, running: false });

      sqlite.close();
    }
  });

  test("refuses a suspended account even when its pause looks manual", () => {
    const { db, sqlite } = fresh({ pauseReason: "user", running: false });

    db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER)).run();

    expect(resumeByUser(db, createClock(), USER)).toEqual({ ok: false, reason: "suspended" });
    expect(profileOf(db)).toMatchObject({ pauseReason: "user", running: false });

    sqlite.close();
  });
});

describe("Pause pressed by the person", () => {
  test("stops sending from no pause or a manual pause", () => {
    for (const pauseReason of [null, "user"] as const) {
      const { db, sqlite } = fresh({ pauseReason, running: true });

      expect(pauseByUser(db, createClock(), USER)).toEqual({ changed: true, ok: true });
      expect(profileOf(db)).toMatchObject({ pauseReason: "user", running: false });

      sqlite.close();
    }
  });

  test("never replaces a billing, setup, suspension or blocker hold", () => {
    for (const pauseReason of HIGHER_HOLDS) {
      const { db, sqlite } = fresh({ pauseReason, running: false });

      expect(pauseByUser(db, createClock(), USER)).toEqual({ ok: false, reason: pauseReason });
      expect(profileOf(db)).toMatchObject({ pauseReason, running: false });

      sqlite.close();
    }
  });

  test("refuses a suspended account", () => {
    const { db, sqlite } = fresh({ pauseReason: null, running: true });

    db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER)).run();

    expect(pauseByUser(db, createClock(), USER)).toEqual({ ok: false, reason: "suspended" });
    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });

    sqlite.close();
  });
});

describe("A hold the dispatcher records", () => {
  test("pauses for a missing resume and repeats without another event", () => {
    const { clock, db, sqlite } = fresh({ pauseReason: null, running: true });

    expect(pauseForBlocker(db, clock, USER, "no_resume")).toEqual({ changed: true });
    expect(profileOf(db)).toMatchObject({ pauseReason: "no_resume", running: false });
    expect(homeEvents(db)).toHaveLength(1);

    expect(pauseForBlocker(db, clock, USER, "no_resume")).toEqual({ changed: false });
    expect(homeEvents(db)).toHaveLength(1);

    sqlite.close();
  });

  test("pauses for a missing mailbox from a manual pause", () => {
    const { clock, db, sqlite } = fresh({ pauseReason: "user", running: false });

    expect(pauseForBlocker(db, clock, USER, "no_mailbox")).toEqual({ changed: true });
    expect(profileOf(db)).toMatchObject({ pauseReason: "no_mailbox", running: false });

    sqlite.close();
  });

  test("never replaces a higher-priority hold or the other blocker", () => {
    for (const pauseReason of [
      "onboarding",
      "plan_ended",
      "payment_failed",
      "suspended",
      "no_resume",
    ] as const) {
      const { clock, db, sqlite } = fresh({ pauseReason, running: false });

      expect(pauseForBlocker(db, clock, USER, "no_mailbox")).toEqual({ changed: false });
      expect(profileOf(db)).toMatchObject({ pauseReason, running: false });

      sqlite.close();
    }
  });
});

describe("Clearing a dispatcher hold", () => {
  test("resumes only when the recovered prerequisite is the one holding", () => {
    const { clock, db, sqlite } = fresh({ pauseReason: "no_resume", running: false });

    expect(clearBlockerIfRecovered(db, clock, USER, "no_mailbox")).toEqual({ changed: false });
    expect(profileOf(db)).toMatchObject({ pauseReason: "no_resume", running: false });

    expect(clearBlockerIfRecovered(db, clock, USER, "no_resume")).toEqual({ changed: true });
    expect(profileOf(db)).toMatchObject({ pauseReason: null, running: true });
    expect(homeEvents(db)).toHaveLength(1);

    sqlite.close();
  });

  test("never clears a billing hold, a manual pause or a suspension", () => {
    for (const pauseReason of ["payment_failed", "plan_ended", "user"] as const) {
      const { clock, db, sqlite } = fresh({ pauseReason, running: false });

      expect(clearBlockerIfRecovered(db, clock, USER, "no_resume")).toEqual({ changed: false });
      expect(profileOf(db)).toMatchObject({ pauseReason, running: false });

      sqlite.close();
    }

    const { clock, db, sqlite } = fresh({ pauseReason: "no_resume", running: false });

    db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER)).run();

    expect(clearBlockerIfRecovered(db, clock, USER, "no_resume")).toEqual({ changed: false });
    expect(profileOf(db)).toMatchObject({ pauseReason: "no_resume", running: false });

    sqlite.close();
  });
});
