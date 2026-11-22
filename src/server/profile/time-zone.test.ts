import { describe, expect, test } from "bun:test";

import { profiles, users } from "../platform/db/schema.ts";
import { openCountingDatabase } from "../testing/query-counter.ts";
import { createTimeZoneService } from "./time-zone.ts";

const NOW = 1_795_000_000_000;
const USER = "zone-user";
const DAY_MS = 86_400_000;

function seeded(input: { pendingAt: number | null; pendingZone: string | null }) {
  const { counter, db } = openCountingDatabase();

  const at = new Date(NOW);

  db.insert(users)
    .values({
      id: USER,
      name: "Zone Owner",
      email: "zone@example.com",
      emailVerified: true,
      role: "owner",
      createdAt: at,
      updatedAt: at,
    })
    .run();

  db.insert(profiles)
    .values({
      userId: USER,
      running: true,
      languages: "[]",
      timezone: "UTC",
      pendingTimezone: input.pendingZone,
      pendingTimezoneAt: input.pendingAt === null ? null : new Date(input.pendingAt),
      createdAt: at,
      updatedAt: at,
    })
    .run();

  const clock = { now: () => NOW };

  return { counter, db, zones: createTimeZoneService({ clock, db }) };
}

describe("reading the current timezone", () => {
  test("does not write when no change is pending", async () => {
    const { counter, db, zones } = seeded({ pendingAt: null, pendingZone: null });

    counter.reset();

    expect((await zones.current(USER)).timezone).toBe("UTC");
    expect(counter.count()).toBe(1);
    expect(counter.queries().some((sql) => sql.startsWith("update"))).toBe(false);

    const [row] = db.select().from(profiles).all();

    expect(row?.timezone).toBe("UTC");
  });

  test("applies a change whose delay has passed and persists it", async () => {
    const { db, zones } = seeded({ pendingAt: NOW - DAY_MS, pendingZone: "America/Toronto" });

    expect(await zones.current(USER)).toMatchObject({
      pendingTimezone: null,
      timezone: "America/Toronto",
    });

    const [row] = db.select().from(profiles).all();

    expect(row?.timezone).toBe("America/Toronto");
    expect(row?.pendingTimezone).toBeNull();
  });

  test("keeps a change whose delay has not passed pending", async () => {
    const { counter, zones } = seeded({
      pendingAt: NOW + DAY_MS,
      pendingZone: "America/Toronto",
    });

    counter.reset();

    expect(await zones.current(USER)).toMatchObject({ timezone: "UTC" });
    expect(counter.count()).toBe(1);
  });
});
