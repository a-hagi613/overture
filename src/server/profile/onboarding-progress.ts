import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles } from "../platform/db/schema.ts";
import { ONBOARDING_STEP_COUNT } from "../../shared/onboarding.ts";

export interface OnboardingProgress {
  step: number;
  onboardedAt: Date | null;
  pauseReason: string | null;
}

export function createOnboardingProgressService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  async function read(userId: string) {
    const row = await db
      .select({
        onboardingStep: profiles.onboardingStep,
        onboardedAt: profiles.onboardedAt,
        pauseReason: profiles.pauseReason,
      })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
      .then((rows) => rows.at(0));

    return {
      step: row?.onboardingStep ?? 1,
      onboardedAt: row?.onboardedAt ?? null,
      pauseReason: row?.pauseReason ?? "onboarding",
    } satisfies OnboardingProgress;
  }

  async function finish(userId: string, step: number) {
    const current = await read(userId);
    const at = new Date(clock.now());
    const finished = step >= ONBOARDING_STEP_COUNT;

    const next = finished
      ? ONBOARDING_STEP_COUNT
      : Math.min(ONBOARDING_STEP_COUNT, Math.max(current.step, step + 1));

    await db
      .insert(profiles)
      .values({
        userId,
        onboardingStep: next,
        onboardedAt: finished ? at : current.onboardedAt,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          onboardingStep: next,
          onboardedAt: finished ? (current.onboardedAt ?? at) : current.onboardedAt,
          updatedAt: at,
        },
      });

    return read(userId);
  }

  return { finish, read };
}

export type OnboardingProgressService = ReturnType<typeof createOnboardingProgressService>;
