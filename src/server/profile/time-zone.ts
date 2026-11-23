import { and, eq, isNotNull, lte, sql } from "drizzle-orm";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles } from "../platform/db/schema.ts";
import { getSettingNumber } from "../platform/settings/index.ts";

const DAY_MS = 24 * 60 * 60_000;

/**
 * The timezone a schedule should use right now: a pending change applies once
 * its delay has passed.
 * @param db The application database.
 * @param userId The user whose profile is read.
 * @param now The current time.
 * @returns The effective IANA timezone, UTC when the profile has none.
 */
export function effectiveTimeZone(db: DatabaseWriter, userId: string, now: number) {
  const row = db
    .select({
      pendingTimezone: profiles.pendingTimezone,
      pendingTimezoneAt: profiles.pendingTimezoneAt,
      timezone: profiles.timezone,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();

  if (row === undefined) {
    return "UTC";
  }

  if (
    row.pendingTimezone !== null &&
    row.pendingTimezoneAt !== null &&
    row.pendingTimezoneAt.getTime() <= now
  ) {
    return row.pendingTimezone;
  }

  return row.timezone ?? "UTC";
}

export function createTimeZoneService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  async function current(userId: string) {
    const row = (
      await db
        .select({
          timezone: profiles.timezone,
          pendingTimezone: profiles.pendingTimezone,
          pendingTimezoneAt: profiles.pendingTimezoneAt,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1)
    ).at(0);

    if (row === undefined) {
      return { timezone: null, pendingTimezone: null, pendingTimezoneAt: null };
    }

    const due =
      row.pendingTimezone !== null &&
      row.pendingTimezoneAt !== null &&
      row.pendingTimezoneAt.getTime() <= clock.now();

    if (!due) {
      return {
        timezone: row.timezone ?? null,
        pendingTimezone: row.pendingTimezone ?? null,
        pendingTimezoneAt: row.pendingTimezoneAt?.toISOString() ?? null,
      };
    }

    await db
      .update(profiles)
      .set({
        timezone: sql`${profiles.pendingTimezone}`,
        pendingTimezone: null,
        pendingTimezoneAt: null,
      })
      .where(
        and(
          eq(profiles.userId, userId),
          isNotNull(profiles.pendingTimezoneAt),
          lte(profiles.pendingTimezoneAt, new Date(clock.now())),
        ),
      );

    return { timezone: row.pendingTimezone, pendingTimezone: null, pendingTimezoneAt: null };
  }

  async function plan(userId: string, timezone: string) {
    const state = await current(userId);

    if (state.timezone === null) {
      return { timezone, pendingTimezone: null, pendingTimezoneAt: null };
    }

    if (state.timezone === timezone) {
      return { timezone: state.timezone, pendingTimezone: null, pendingTimezoneAt: null };
    }

    if (state.pendingTimezone === timezone && state.pendingTimezoneAt !== null) {
      return {
        timezone: state.timezone,
        pendingTimezone: state.pendingTimezone,
        pendingTimezoneAt: new Date(state.pendingTimezoneAt),
      };
    }

    const windowDays = getSettingNumber(db, "limits.timezone_change_days", {
      fallback: 7,
      integer: true,
      minimum: 1,
    });

    return {
      timezone: state.timezone,
      pendingTimezone: timezone,
      pendingTimezoneAt: new Date(clock.now() + windowDays * DAY_MS),
    };
  }

  return { current, plan };
}
