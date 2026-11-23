import { describe, expect, test } from "bun:test";

import { openDatabase } from "../platform/db/client.ts";
import { migrateDatabase } from "../platform/db/migrate.ts";
import { consumeRateLimit } from "./rate-limit.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

describe("the auth attempt limiter", () => {
  test("allows the maximum inside one window and refuses the next attempt", () => {
    const { db, sqlite } = migrated();
    const clock = { now: () => NOW };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(consumeRateLimit(db, clock, "auth.link:user-a", 60_000, 3)).toBe(true);
    }

    expect(consumeRateLimit(db, clock, "auth.link:user-a", 60_000, 3)).toBe(false);

    sqlite.close();
  });

  test("a steady client keeps its first window instead of sliding into a lockout", () => {
    const { db, sqlite } = migrated();
    let now = NOW;
    const clock = { now: () => now };
    const gap = 50 * 60_000;

    for (let attempt = 0; attempt < 19; attempt += 1) {
      now = NOW + attempt * gap;

      expect(consumeRateLimit(db, clock, "auth.link:steady", 60 * 60_000, 10)).toBe(true);
    }

    sqlite.close();
  });

  test("a new window starts after the old one has passed", () => {
    const { db, sqlite } = migrated();
    let now = NOW;
    const clock = { now: () => now };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      consumeRateLimit(db, clock, "auth.link:user-a", 60_000, 3);
    }

    now = NOW + 60_000;

    expect(consumeRateLimit(db, clock, "auth.link:user-a", 60_000, 3)).toBe(true);

    sqlite.close();
  });
});
