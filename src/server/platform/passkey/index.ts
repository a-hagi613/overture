import { eq } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { passkeyAssertions } from "../db/schema.ts";

export const PASSKEY_ASSERTION_WINDOW_MS = 12 * 60 * 60 * 1000;

export function recordPasskeyAssertion(db: AppDatabase, clock: Clock, userId: string) {
  db.insert(passkeyAssertions)
    .values({ userId, assertedAt: clock.now() })
    .onConflictDoUpdate({
      target: passkeyAssertions.userId,
      set: { assertedAt: clock.now() },
    })
    .run();
}

export function lastPasskeyAssertionAt(db: AppDatabase, userId: string) {
  const row = db.select().from(passkeyAssertions).where(eq(passkeyAssertions.userId, userId)).get();

  return row === undefined ? null : new Date(row.assertedAt);
}

export function hasRecentPasskeyAssertion(db: AppDatabase, clock: Clock, userId: string) {
  return passkeyAssertedWithin(db, clock, userId, PASSKEY_ASSERTION_WINDOW_MS);
}

export function passkeyAssertedWithin(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  windowMs: number,
) {
  const last = lastPasskeyAssertionAt(db, userId);

  if (last === null) {
    return false;
  }

  return clock.now() - last.getTime() < windowMs;
}
