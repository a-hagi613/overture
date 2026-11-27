import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { applicationEvents, applications, users } from "../platform/db/schema.ts";
import { readApplicationTimeline } from "../applications/events.ts";

import { updatePreparableApplication } from "./preparable-status.ts";

const NOW = 1_795_000_000_000;
const USER = "prepare-user";
const APPLICATION = "prepare-application";

function database() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  const at = new Date(NOW);

  db.insert(users)
    .values({
      createdAt: at,
      email: "prepare@example.com",
      emailVerified: true,
      id: USER,
      name: "Prepare Owner",
      role: "user",
      updatedAt: at,
    })
    .run();

  db.insert(applications)
    .values({
      companyId: "co-1",
      companyName: "Northwind",
      companyNameNorm: "northwind",
      createdAt: NOW,
      id: APPLICATION,
      origin: "pick",
      postingId: "posting-1",
      postingTitle: "Engineer",
      postingUrl: "https://example.test/job-1",
      status: "preparing",
      updatedAt: NOW,
      userId: USER,
    })
    .run();

  return { db, sqlite };
}

describe("the preparation status guard", () => {
  test("an approved Application is never overwritten by a late preparation result", () => {
    const { db, sqlite } = database();

    db.update(applications)
      .set({ status: "approved" })
      .where(eq(applications.id, APPLICATION))
      .run();

    const changed = updatePreparableApplication(db, APPLICATION, {
      status: "ready",
      updatedAt: NOW + 1,
    });

    expect(changed).toBe(false);
    expect(
      db.select().from(applications).where(eq(applications.id, APPLICATION)).get()?.status,
    ).toBe("approved");

    sqlite.close();
  });

  test("a still-preparable Application takes the new status", () => {
    const { db, sqlite } = database();

    const changed = updatePreparableApplication(db, APPLICATION, {
      status: "ready",
      updatedAt: NOW + 1,
    });

    expect(changed).toBe(true);
    expect(
      db.select().from(applications).where(eq(applications.id, APPLICATION)).get()?.status,
    ).toBe("ready");
    expect(db.select().from(applicationEvents).all()).toHaveLength(0);

    sqlite.close();
  });

  test("a preparation outcome records why the status and stage moved", () => {
    const { db, sqlite } = database();
    const clock = { now: () => NOW + 2 };

    const changed = updatePreparableApplication(
      db,
      APPLICATION,
      { stage: "ready", status: "ready", updatedAt: NOW + 2 },
      { clock, reason: "prepared" },
    );

    expect(changed).toBe(true);
    expect(
      readApplicationTimeline(db, APPLICATION)
        .map((entry) => ({
          from: entry.fromValue,
          kind: entry.kind,
          reason: entry.reason,
          to: entry.toValue,
        }))
        .toSorted((left, right) => left.kind.localeCompare(right.kind)),
    ).toEqual([
      { from: null, kind: "stage", reason: "prepared", to: "ready" },
      { from: "preparing", kind: "status", reason: "prepared", to: "ready" },
    ]);

    sqlite.close();
  });
});
