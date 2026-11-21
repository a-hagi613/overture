import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";
import { bgJobs, events } from "../db/schema.ts";
import { createClock } from "../ports/clock.ts";
import { DAY_MS, runRetention } from "./retention.ts";

function freshDatabase() {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return db;
}

function job(id: string, status: "queued" | "done" | "dead" | "running", updatedAt: number) {
  return {
    id,
    kind: "test",
    payload: "{}",
    runAt: updatedAt,
    status,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("runRetention", () => {
  test("removes events older than a day and keeps recent ones", async () => {
    const db = freshDatabase();
    const clock = createClock();
    const now = clock.now();

    db.insert(events)
      .values([
        { topic: "old", payload: "{}", createdAt: now - 2 * DAY_MS },
        { topic: "new", payload: "{}", createdAt: now - 1000 },
      ])
      .run();

    const result = await runRetention(db, clock);

    expect(result.events).toBe(1);
    expect(
      db
        .select()
        .from(events)
        .all()
        .map((row) => row.topic),
    ).toEqual(["new"]);
  });

  test("removes done jobs after 7 days and dead jobs after 30, never queued or running", async () => {
    const db = freshDatabase();
    const clock = createClock();
    const now = clock.now();
    const day = DAY_MS;

    db.insert(bgJobs)
      .values([
        job("done-old", "done", now - 8 * day),
        job("done-new", "done", now - 6 * day),
        job("dead-old", "dead", now - 31 * day),
        job("dead-new", "dead", now - 20 * day),
        job("queued-old", "queued", now - 90 * day),
        job("running-old", "running", now - 90 * day),
      ])
      .run();

    const result = await runRetention(db, clock);

    expect(result).toEqual({ events: 0, doneJobs: 1, deadJobs: 1 });

    expect(
      db
        .select({ id: bgJobs.id })
        .from(bgJobs)
        .orderBy(sql`id`)
        .all()
        .map((row) => row.id),
    ).toEqual(["dead-new", "done-new", "queued-old", "running-old"]);
  });

  test("deletes more rows than one chunk holds", async () => {
    const db = freshDatabase();
    const clock = createClock();
    const old = clock.now() - 2 * DAY_MS;

    db.insert(events)
      .values(Array.from({ length: 1200 }, () => ({ topic: "old", payload: "{}", createdAt: old })))
      .run();

    const result = await runRetention(db, clock);

    expect(result.events).toBe(1200);
    expect(db.select().from(events).all()).toHaveLength(0);
  });
});
