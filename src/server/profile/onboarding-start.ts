import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { ensurePrepNextQueued } from "../pipeline/daily-prep.ts";
import { profiles } from "../platform/db/schema.ts";
import { ONBOARDING_STEP_COUNT } from "../../shared/onboarding.ts";

/**
 * Finish onboarding in one transaction: mark it done, clear the `onboarding` pause
 * reason (any other reason stays), start running and queue only the next staggered morning run.

 * The database is one synchronous connection, so the helpers that take `db` run inside the transaction too.
 * Pressing Start again changes nothing and queues nothing new.
 * @param db The application database.
 * @param clock The clock the timestamps and the schedule are read from.
 * @param userId The user pressing Start.
 * @returns Whether the pause was cleared by this call.
 */
export function startOnboarding(db: AppDatabase, clock: Clock, userId: string) {
  const at = new Date(clock.now());

  return db.transaction(() => {
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
      .where(and(eq(profiles.userId, userId), eq(profiles.pauseReason, "onboarding")))
      .returning({ userId: profiles.userId })
      .all();

    if (cleared.length > 0) {
      ensurePrepNextQueued(db, clock, userId);
    }

    return cleared.length > 0;
  });
}
