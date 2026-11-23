import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "../db/client.ts";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { events } from "../db/schema.ts";
import { subscribeToEvents } from "./hub.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function publish(db: AppDatabase, topic: string, userId: string | null) {
  db.insert(events).values({ userId, topic, payload: "{}", createdAt: NOW }).run();
}

describe("subscribing to the event hub", () => {
  test("a subscriber only receives the rows addressed to them", () => {
    const { db, sqlite } = migrated();

    publish(db, "mine.first", "user-a");
    publish(db, "theirs", "user-b");
    publish(db, "unscoped", null);

    const topics: string[] = [];

    const unsubscribe = subscribeToEvents(db, {
      userId: "user-a",
      lastSeq: 0,
      deliver: (row) => topics.push(row.topic),
    });

    unsubscribe();
    sqlite.close();

    expect(topics).toEqual(["mine.first"]);
  });

  test("an unscoped row never reaches a subscriber", () => {
    const { db, sqlite } = migrated();

    publish(db, "unscoped.one", null);
    publish(db, "unscoped.two", null);

    const topics: string[] = [];

    const unsubscribe = subscribeToEvents(db, {
      userId: "user-a",
      lastSeq: 0,
      deliver: (row) => topics.push(row.topic),
    });

    unsubscribe();
    sqlite.close();

    expect(topics).toEqual([]);
  });

  test("replay from zero is capped to the newest rows", () => {
    const { db, sqlite } = migrated();

    for (let index = 1; index <= 500; index += 1) {
      publish(db, `row-${String(index)}`, "user-a");
    }

    const topics: string[] = [];

    const unsubscribe = subscribeToEvents(db, {
      userId: "user-a",
      lastSeq: 0,
      deliver: (row) => topics.push(row.topic),
    });

    unsubscribe();
    sqlite.close();

    expect(topics).toHaveLength(200);
    expect(topics[0]).toBe("row-301");
    expect(topics.at(-1)).toBe("row-500");
  });

  test("replay from a very old cursor is capped to the newest rows", () => {
    const { db, sqlite } = migrated();

    for (let index = 1; index <= 500; index += 1) {
      publish(db, `row-${String(index)}`, "user-a");
    }

    const topics: string[] = [];

    const unsubscribe = subscribeToEvents(db, {
      userId: "user-a",
      lastSeq: 1,
      deliver: (row) => topics.push(row.topic),
    });

    unsubscribe();
    sqlite.close();

    expect(topics).toHaveLength(200);
    expect(topics[0]).toBe("row-301");
  });

  test("a cursor inside the replay window resumes exactly after it", () => {
    const { db, sqlite } = migrated();

    for (let index = 1; index <= 500; index += 1) {
      publish(db, `row-${String(index)}`, "user-a");
    }

    const topics: string[] = [];

    const unsubscribe = subscribeToEvents(db, {
      userId: "user-a",
      lastSeq: 490,
      deliver: (row) => topics.push(row.topic),
    });

    unsubscribe();
    sqlite.close();

    expect(topics).toEqual([
      "row-491",
      "row-492",
      "row-493",
      "row-494",
      "row-495",
      "row-496",
      "row-497",
      "row-498",
      "row-499",
      "row-500",
    ]);
  });
});
