import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { applicationsLeft } from "./ledger.ts";

/**
 * Whether a user may start paid work (an LLM call or a cloud browser session).
 *
 * Public sign-up turns the gate on even when billing is misconfigured, so an
 * account with no Applications left can never spend; invite-only mode with
 * billing off keeps M2's behaviour unchanged.
 */
export interface SpendGate {
  readonly gated: boolean;
  allows: (userId: string) => boolean;
}

export interface SpendGateDeps {
  db: AppDatabase;
  clock: Clock;
  /** Payments are configured, or public sign-up is on. */
  gated: boolean;
}

export function createSpendGate(deps: SpendGateDeps) {
  const gate: SpendGate = {
    gated: deps.gated,
    allows: (userId) => !deps.gated || applicationsLeft(deps.db, userId, deps.clock.now()) > 0,
  };

  return gate;
}

/** A gate that never blocks, for invite-only fixtures and unit tests. */
export const ungatedSpend: SpendGate = {
  gated: false,
  allows: () => true,
};
