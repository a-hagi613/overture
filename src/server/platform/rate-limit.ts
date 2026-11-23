import { eq } from "drizzle-orm";

import type { AppDatabase } from "./db/client.ts";

import { rateLimits } from "./db/schema.ts";

export interface FixedWindowLimit {
  /** The window a full count resets after, in milliseconds. */
  windowMs: number;
  /** The most requests one key may make inside a window. */
  max: number;
}

/**
 * Consumes one request from a fixed-window limit.
 * @param db The application database holding the shared `rate_limit` table.
 * @param key What the limit counts, such as `api.search:<userId>`.
 * @param now The current time in milliseconds.
 * @param limit The window and maximum.
 * @returns True when the request is allowed, false when the window is full.
 */
export function consumeRateLimit(
  db: AppDatabase,
  key: string,
  now: number,
  limit: FixedWindowLimit,
) {
  const row = db.select().from(rateLimits).where(eq(rateLimits.key, key)).get();

  if (row === undefined) {
    db.insert(rateLimits)
      .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoNothing()
      .run();

    return true;
  }

  if (now - row.lastRequest > limit.windowMs) {
    db.update(rateLimits)
      .set({ count: 1, lastRequest: now })
      .where(eq(rateLimits.id, row.id))
      .run();

    return true;
  }

  if (row.count >= limit.max) {
    return false;
  }

  db.update(rateLimits)
    .set({ count: row.count + 1, lastRequest: now })
    .where(eq(rateLimits.id, row.id))
    .run();

  return true;
}
