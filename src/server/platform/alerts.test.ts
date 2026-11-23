import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "./db/client.ts";

import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { events, users } from "./db/schema.ts";
import { subscribeToEvents } from "./sse/hub.ts";

Bun.env.BETTER_AUTH_SECRET ??= "alerts-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "alerts-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "alerts-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { raiseAlert } = await import("./alerts.ts");

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const clock = { now: () => NOW };

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function seedUser(db: AppDatabase, id: string, role: "owner" | "user") {
  db.insert(users)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("raising an alert", () => {
  test("the alert event goes to every owner and never to a regular user", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "owner-one", "owner");
    seedUser(db, "owner-two", "owner");
    seedUser(db, "member", "user");

    const ownerTopics: string[] = [];
    const memberTopics: string[] = [];

    const stopOwner = subscribeToEvents(db, {
      userId: "owner-one",
      lastSeq: 0,
      deliver: (row) => ownerTopics.push(row.topic),
    });

    const stopMember = subscribeToEvents(db, {
      userId: "member",
      lastSeq: 0,
      deliver: (row) => memberTopics.push(row.topic),
    });

    raiseAlert(db, clock, "llm.spend", { spent: 42 });

    const stopFlush = subscribeToEvents(db, {
      userId: "flush",
      lastSeq: 0,
      deliver: () => undefined,
    });

    stopFlush();
    stopOwner();
    stopMember();

    expect(ownerTopics).toContain("alert.raised");
    expect(memberTopics).toEqual([]);

    const rows = db.select().from(events).all();
    const alertRows = rows.filter((row) => row.topic === "alert.raised");

    expect(alertRows.map((row) => row.userId)).toEqual(["owner-one", "owner-two"]);
    expect(rows.some((row) => row.topic === "alert.raised" && row.userId === null)).toBe(false);

    sqlite.close();
  });

  test("a user with no owner role receives nothing even when no owner exists", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "member", "user");

    const topics: string[] = [];

    const stop = subscribeToEvents(db, {
      userId: "member",
      lastSeq: 0,
      deliver: (row) => topics.push(row.topic),
    });

    raiseAlert(db, clock, "health", { ok: false });

    stop();

    const rows = db.select().from(events).all();

    sqlite.close();

    expect(topics).toEqual([]);
    expect(rows).toEqual([]);
  });
});
