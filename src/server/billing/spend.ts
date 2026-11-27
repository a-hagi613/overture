import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { profiles, users } from "../platform/db/schema.ts";
import { applicationsLeft } from "./ledger.ts";

/**
 * Whether a user may start paid work (an LLM call or a cloud browser session).
 *
 * Public sign-up turns the gate on even when billing is misconfigured, so an
 * account with no Applications left can never spend; invite-only mode with
 * billing off keeps M2's behaviour unchanged.
 *
 * The one exception is the work a person does *before* setup ends: reading the
 * resume and scoring the first matches happen before a plan exists, so the gate
 * must not need an Application. Those calls are still bounded by the onboarding
 * cap (`llm.cap_onboarding_usd`), and `allowsOnboarding` refuses the moment
 * setup is finished.
 */
export interface SpendGate {
  readonly gated: boolean;
  allows: (userId: string) => boolean;
  allowsOnboarding: (userId: string) => boolean;
}

export interface SpendGateDeps {
  db: AppDatabase;
  clock: Clock;
  /** Payments are configured, or public sign-up is on. */
  gated: boolean;
}

function isOnboarding(db: AppDatabase, userId: string) {
  const row = db
    .select({ onboardedAt: profiles.onboardedAt, role: users.role })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .get();

  if (row === undefined || row.role === "owner" || row.role === "demo") {
    return false;
  }

  return row.onboardedAt === null;
}

export function createSpendGate(deps: SpendGateDeps) {
  const { db, clock } = deps;

  const gate: SpendGate = {
    gated: deps.gated,
    allows: (userId) => !deps.gated || applicationsLeft(db, userId, clock.now()) > 0,
    allowsOnboarding: (userId) =>
      !deps.gated || applicationsLeft(db, userId, clock.now()) > 0 || isOnboarding(db, userId),
  };

  return gate;
}

/** A gate that never blocks, for invite-only fixtures and unit tests. */
export const ungatedSpend: SpendGate = {
  allows: () => true,
  allowsOnboarding: () => true,
  gated: false,
};
