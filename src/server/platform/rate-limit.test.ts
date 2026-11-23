import { describe, expect, test } from "bun:test";

import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { consumeRateLimit } from "./rate-limit.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const LIMIT = { windowMs: 60_000, max: 60 } as const;

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

describe("a fixed-window per-key rate limit", () => {
  test("allows the maximum and refuses the next request in the same window", () => {
    const { db, sqlite } = migrated();

    for (let request = 0; request < LIMIT.max; request += 1) {
      expect(consumeRateLimit(db, "api.search:user-a", NOW, LIMIT)).toBe(true);
    }

    expect(consumeRateLimit(db, "api.search:user-a", NOW, LIMIT)).toBe(false);

    sqlite.close();
  });

  test("counts each key on its own", () => {
    const { db, sqlite } = migrated();

    for (let request = 0; request < LIMIT.max; request += 1) {
      consumeRateLimit(db, "api.search:user-a", NOW, LIMIT);
    }

    expect(consumeRateLimit(db, "api.search:user-a", NOW, LIMIT)).toBe(false);
    expect(consumeRateLimit(db, "api.search:user-b", NOW, LIMIT)).toBe(true);

    sqlite.close();
  });

  test("resets once the window has passed", () => {
    const { db, sqlite } = migrated();

    for (let request = 0; request < LIMIT.max; request += 1) {
      consumeRateLimit(db, "api.search:user-a", NOW, LIMIT);
    }

    expect(consumeRateLimit(db, "api.search:user-a", NOW + LIMIT.windowMs + 1, LIMIT)).toBe(true);

    sqlite.close();
  });

  test("a steady client can never slide its own window into a lockout", () => {
    const { db, sqlite } = migrated();
    const hourly = { windowMs: 60 * 60_000, max: 10 } as const;
    const gap = 50 * 60_000;

    for (let request = 0; request < 19; request += 1) {
      expect(consumeRateLimit(db, "api.search:steady", NOW + request * gap, hourly)).toBe(true);
    }

    sqlite.close();
  });
});
