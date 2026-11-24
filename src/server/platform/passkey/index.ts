import { eq } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { passkeyAssertions } from "../db/schema.ts";

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
