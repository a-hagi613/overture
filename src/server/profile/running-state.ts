import { eq } from "drizzle-orm";

import type { PauseReason } from "../../shared/copy.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { profiles, users } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";

/** A hold the dispatcher can discover on its own and then record on the profile. */
export type RunningBlocker = "no_resume" | "no_mailbox";

type RunningStateResult = { changed: boolean; ok: true } | { ok: false; reason: PauseReason };

function stateOf(db: AppDatabase, userId: string) {
  const user = db
    .select({ suspendedAt: users.suspendedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  const profile = db
    .select({ pauseReason: profiles.pauseReason, running: profiles.running })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .get();

  return { profile, suspended: user === undefined || user.suspendedAt !== null };
}

function writeUserRunning(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  state: { pauseReason: "user" | null; running: boolean },
) {
  return db.transaction(() => {
    const { profile, suspended } = stateOf(db, userId);

    if (suspended) {
      return { ok: false, reason: "suspended" } satisfies RunningStateResult;
    }

    const current = profile?.pauseReason ?? null;

    if (current !== null && current !== "user") {
      return { ok: false, reason: current } satisfies RunningStateResult;
    }

    if (profile === undefined) {
      const at = new Date(clock.now());

      db.insert(profiles)
        .values({
          createdAt: at,
          languages: "[]",
          ...state,
          updatedAt: at,
          userId,
        })
        .run();

      return { changed: true, ok: true } satisfies RunningStateResult;
    }

    if (profile.running === state.running && current === state.pauseReason) {
      return { changed: false, ok: true } satisfies RunningStateResult;
    }

    db.update(profiles)
      .set({ ...state, updatedAt: new Date(clock.now()) })
      .where(eq(profiles.userId, userId))
      .run();

    return { changed: true, ok: true } satisfies RunningStateResult;
  });
}

/**
 * Starts sending for the person pressing Resume. Only the person's own pause or
 * no pause at all may be cleared; every other hold (setup, billing, a suspension)
 * keeps sending stopped and is returned so the caller can explain the fix.
 * @param db The application database.
 * @param clock The clock stamping the profile.
 * @param userId The person pressing Resume.
 * @returns Whether the profile changed, or the hold that still blocks sending.
 */
export function resumeByUser(db: AppDatabase, clock: Clock, userId: string) {
  return writeUserRunning(db, clock, userId, { pauseReason: null, running: true });
}

/**
 * Stops sending because the person pressed Pause. A billing, setup, suspension or
 * dispatcher hold is preserved instead of being replaced by the manual pause, so
 * pressing Pause never hides the real reason or its fix.
 * @param db The application database.
 * @param clock The clock stamping the profile.
 * @param userId The person pressing Pause.
 * @returns Whether the profile changed, or the hold that keeps sending stopped.
 */
export function pauseByUser(db: AppDatabase, clock: Clock, userId: string) {
  return writeUserRunning(db, clock, userId, { pauseReason: "user", running: false });
}

/**
 * Records a hold the dispatcher found on its own, such as a missing resume or
 * mailbox, so Home stops claiming auto-apply is active. A higher-priority hold is
 * kept, and a repeat tick changes nothing.
 * @param db The application database.
 * @param clock The clock stamping the profile and the event.
 * @param userId The person whose dispatch blocked.
 * @param reason The missing prerequisite.
 * @returns Whether the profile changed.
 */
export function pauseForBlocker(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  reason: RunningBlocker,
) {
  const changed = db.transaction(() => {
    const { profile, suspended } = stateOf(db, userId);

    if (suspended) {
      return false;
    }

    const current = profile?.pauseReason ?? null;

    if (current !== reason && current !== null && current !== "user") {
      return false;
    }

    if (current === reason && profile !== undefined && !profile.running) {
      return false;
    }

    const at = new Date(clock.now());

    if (profile === undefined) {
      db.insert(profiles)
        .values({
          createdAt: at,
          languages: "[]",
          pauseReason: reason,
          running: false,
          updatedAt: at,
          userId,
        })
        .run();
    } else {
      db.update(profiles)
        .set({ pauseReason: reason, running: false, updatedAt: at })
        .where(eq(profiles.userId, userId))
        .run();
    }

    return true;
  });

  if (changed) {
    publishEvent(
      db,
      clock,
      "home.updated",
      JSON.stringify({ pauseReason: reason, running: false }),
      userId,
    );
  }

  return { changed };
}

/**
 * Clears a dispatcher hold once its prerequisite is back, for example after a
 * resume upload or when forwarding becomes active. Only the same hold is cleared,
 * so a billing pause, a suspension or a manual pause stays as it is.
 * @param db The application database.
 * @param clock The clock stamping the profile and the event.
 * @param userId The person whose prerequisite returned.
 * @param reason The prerequisite that is no longer missing.
 * @returns Whether the profile changed.
 */
export function clearBlockerIfRecovered(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  reason: RunningBlocker,
) {
  const changed = db.transaction(() => {
    const { profile, suspended } = stateOf(db, userId);

    if (suspended || profile?.pauseReason !== reason) {
      return false;
    }

    db.update(profiles)
      .set({ pauseReason: null, running: true, updatedAt: new Date(clock.now()) })
      .where(eq(profiles.userId, userId))
      .run();

    return true;
  });

  if (changed) {
    publishEvent(
      db,
      clock,
      "home.updated",
      JSON.stringify({ pauseReason: null, running: true }),
      userId,
    );
  }

  return { changed };
}
