import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { rateLimits } from "../platform/db/schema.ts";

/**
 * Counts one use per key. The row is reset when its window has passed.
 * @param db The application database.
 * @param clock The injectable clock.
 * @param key The opaque bucket key, unique per limited subject and surface.
 * @param windowMs The width of the window.
 * @param max How many attempts fit in the window.
 * @returns Whether this attempt is inside the limit.
 */
export function consumeRateLimit(
  db: AppDatabase,
  clock: Clock,
  key: string,
  windowMs: number,
  max: number,
) {
  const now = clock.now();

  return db.transaction((tx) => {
    const row = tx.select().from(rateLimits).where(eq(rateLimits.key, key)).get();

    if (row === undefined) {
      tx.insert(rateLimits).values({ id: randomUUID(), key, count: 1, lastRequest: now }).run();

      return true;
    }

    if (now - row.lastRequest >= windowMs) {
      tx.update(rateLimits)
        .set({ count: 1, lastRequest: now })
        .where(eq(rateLimits.key, key))
        .run();

      return true;
    }

    if (row.count >= max) {
      return false;
    }

    tx.update(rateLimits)
      .set({ count: row.count + 1 })
      .where(eq(rateLimits.key, key))
      .run();

    return true;
  });
}
