import { afterAll, describe, expect, test } from "bun:test";

import { migrateDatabase } from "../../platform/db/migrate.ts";
import { openDatabase } from "../../platform/db/client.ts";
import { setSetting } from "../../platform/settings/index.ts";
import {
  acquireBrowserSession,
  browserSessionAvailability,
  configureBrowserSessionLimitFromSetting,
  freeSendSlots,
} from "./session-slots.ts";

const NOW = Date.UTC(2026, 10, 22, 9, 0, 0);

const clock = { now: () => NOW };

function configured(limit: number) {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  setSetting(db, clock, "browser.max_concurrent_sessions", String(limit), "test");
  configureBrowserSessionLimitFromSetting(db);

  return db;
}

afterAll(() => {
  const { db } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  configureBrowserSessionLimitFromSetting(db);
});

describe("the browser session semaphore", () => {
  test("reads its limit from the one browser setting the dispatcher also uses", () => {
    configured(2);

    expect(browserSessionAvailability()).toEqual({
      active: 0,
      available: 2,
      limit: 2,
      waiting: 0,
    });
  });

  test("a waiting send holds no slot, counts as waiting, and leaves cleanly when interrupted", async () => {
    configured(1);

    const release = await acquireBrowserSession();

    expect(browserSessionAvailability()).toEqual({
      active: 1,
      available: 0,
      limit: 1,
      waiting: 0,
    });

    const controller = new AbortController();
    const waiting = acquireBrowserSession(controller.signal);

    expect(browserSessionAvailability().waiting).toBe(1);

    controller.abort();

    let interrupted: Error | null = null;

    try {
      await waiting;
    } catch (error) {
      interrupted = error instanceof Error ? error : new Error("a non-Error rejection");
    }

    expect(interrupted).toBeInstanceOf(Error);
    expect(interrupted).toHaveProperty("message", "the browser session slot wait was interrupted");
    expect(browserSessionAvailability()).toEqual({
      active: 1,
      available: 0,
      limit: 1,
      waiting: 0,
    });

    const next = acquireBrowserSession();
    const releases = [release];

    expect(browserSessionAvailability().waiting).toBe(1);

    release();

    releases.push(await next);
    expect(browserSessionAvailability().active).toBe(1);

    for (const releaseSlot of releases) {
      releaseSlot();
    }

    expect(browserSessionAvailability().active).toBe(0);
  });
});

describe("free send slots", () => {
  test("a slot held by a capture is not offered to a send", () => {
    const availability = { active: 3, available: 0, limit: 3, waiting: 0 };

    expect(freeSendSlots(0, availability)).toBe(0);
  });

  test("the smaller of the send cap and the real free sessions wins", () => {
    expect(freeSendSlots(0, { active: 1, available: 2, limit: 3, waiting: 0 })).toBe(2);
    expect(freeSendSlots(2, { active: 1, available: 2, limit: 3, waiting: 0 })).toBe(1);
    expect(freeSendSlots(4, { active: 0, available: 3, limit: 3, waiting: 0 })).toBe(0);
  });
});
