import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { waitlistEntries } from "../platform/db/schema.ts";
import {
  markWaitlistInvited,
  markWaitlistJoined,
  recordWaitlistEntry,
  waitlistCounts,
  waitlistEntriesFor,
} from "./store.ts";

const NOW = 1_800_000_000_000;

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function openTestDb() {
  const { db, sqlite } = openDatabase(":memory:");

  handles.push(sqlite);
  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function clockAt(at: number) {
  return { now: () => at };
}

function rows(sqlite: Database) {
  return sqlite.query("select * from waitlist_entries order by created_at").all();
}

describe("the waitlist store", () => {
  test("a first submission is stored pending with a normalized email", () => {
    const { db, sqlite } = openTestDb();

    const row = recordWaitlistEntry(db, clockAt(NOW), {
      email: "  Person@Example.COM ",
      targetLocation: " Montreal ",
      targetRole: " Designer ",
    });

    expect(row).toMatchObject({
      email: "person@example.com",
      status: "pending",
      targetLocation: "Montreal",
      targetRole: "Designer",
      createdAt: NOW,
      updatedAt: NOW,
      invitedAt: null,
    });
    expect(rows(sqlite)).toHaveLength(1);
  });

  test("a duplicate refreshes the answers without adding a row", () => {
    const { db, sqlite } = openTestDb();

    recordWaitlistEntry(db, clockAt(NOW), { email: "person@example.com", targetRole: "Designer" });

    const second = recordWaitlistEntry(db, clockAt(NOW + 1000), {
      email: "PERSON@example.com",
      targetLocation: "Lisbon",
      targetRole: "Engineer",
    });

    expect(second).toMatchObject({
      email: "person@example.com",
      status: "pending",
      targetLocation: "Lisbon",
      targetRole: "Engineer",
      createdAt: NOW,
      updatedAt: NOW + 1000,
    });
    expect(rows(sqlite)).toHaveLength(1);
  });

  test("a joined entry is never put back in the queue", () => {
    const { db } = openTestDb();

    recordWaitlistEntry(db, clockAt(NOW), { email: "person@example.com" });

    const [entry] = db.select().from(waitlistEntries).all();

    markWaitlistInvited(db, clockAt(NOW), entry?.id ?? "");
    markWaitlistJoined(db, clockAt(NOW + 5000), "person@example.com");

    const after = recordWaitlistEntry(db, clockAt(NOW + 10_000), {
      email: "person@example.com",
      targetRole: "Designer",
    });

    expect(after.status).toBe("joined");
    expect(after.targetRole).toBeNull();
  });

  test("joining an email that is not on the list does nothing", () => {
    const { db, sqlite } = openTestDb();

    markWaitlistJoined(db, clockAt(NOW), "stranger@example.com");

    expect(rows(sqlite)).toHaveLength(0);
  });

  test("an invite records its time and the counters split by status", () => {
    const { db } = openTestDb();

    recordWaitlistEntry(db, clockAt(NOW), { email: "one@example.com" });
    recordWaitlistEntry(db, clockAt(NOW + 1), { email: "two@example.com" });
    recordWaitlistEntry(db, clockAt(NOW + 2), { email: "three@example.com" });

    const rowsInOrder = db.select().from(waitlistEntries).all();
    const [first] = rowsInOrder;

    markWaitlistInvited(db, clockAt(NOW + 50), first?.id ?? "");

    expect(waitlistCounts(db)).toEqual({ all: 3, invited: 1, joined: 0, pending: 2 });

    const [invited] = db.select().from(waitlistEntries).all();

    expect(invited).toMatchObject({ status: "invited", invitedAt: NOW + 50, updatedAt: NOW + 50 });
  });

  test("the queue filters by status, searches role and location, and orders either way", () => {
    const { db } = openTestDb();

    recordWaitlistEntry(db, clockAt(NOW), {
      email: "first@example.com",
      targetLocation: "Berlin",
      targetRole: "Designer",
    });
    recordWaitlistEntry(db, clockAt(NOW + 1), {
      email: "second@example.com",
      targetLocation: "Toronto",
      targetRole: "Engineer",
    });

    expect(waitlistEntriesFor(db, { order: "newest", q: "berlin", status: "all" })).toHaveLength(1);
    expect(waitlistEntriesFor(db, { order: "newest", q: "engineer", status: "all" })).toHaveLength(
      1,
    );
    expect(
      waitlistEntriesFor(db, { order: "oldest", q: "", status: "pending" }).map((row) => row.email),
    ).toEqual(["first@example.com", "second@example.com"]);
    expect(waitlistEntriesFor(db, { order: "newest", q: "", status: "joined" })).toHaveLength(0);
  });
});
