import { and, eq, isNull, or } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { enqueueUserPull } from "../jobs/pull.ts";
import { profiles } from "../platform/db/schema.ts";
import { ONBOARDING_STEP_COUNT } from "../../shared/onboarding.ts";

/**
 * Finish onboarding in one transaction: mark it done, clear the `onboarding` pause
 * reason (any other reason stays) and switch the account on.

 * A profile with no pause reason is a new account that never received the
 * `onboarding` default, so it is switched on too; a manually paused account or a
 * real blocker is left alone.
 * The database is one synchronous connection, so the helpers that take `db` run inside the transaction too.
 * Pressing Start again changes nothing and queues nothing new.
 * @param db The application database.
 * @param clock The clock the timestamps are read from.
 * @param userId The user pressing Start.
 * @returns Whether the account was switched on by this call.
 */
export function startOnboarding(db: AppDatabase, clock: Clock, userId: string) {
  const at = new Date(clock.now());

  const clearedPause = db.transaction(() => {
    db.insert(profiles)
      .values({
        createdAt: at,
        onboardedAt: at,
        onboardingStep: ONBOARDING_STEP_COUNT,
        updatedAt: at,
        userId,
      })
      .onConflictDoUpdate({
        set: { onboardingStep: ONBOARDING_STEP_COUNT, updatedAt: at },
        target: profiles.userId,
      })
      .run();

    db.update(profiles)
      .set({ onboardedAt: at })
      .where(and(eq(profiles.userId, userId), isNull(profiles.onboardedAt)))
      .run();

    const cleared = db
      .update(profiles)
      .set({ pauseReason: null, running: true, updatedAt: at })
      .where(
        and(
          eq(profiles.userId, userId),
          or(isNull(profiles.pauseReason), eq(profiles.pauseReason, "onboarding")),
        ),
      )
      .returning({ userId: profiles.userId })
      .all();

    return cleared.length > 0;
  });

  enqueueUserPull(db, clock, userId);

  return clearedPause;
}
