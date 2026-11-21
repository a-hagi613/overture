import { createHmac, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { rateLimits } from "../platform/db/schema.ts";
import { normaliseEmail } from "./email.ts";

export type EmailRateLimitBucket = "sign-in" | "sign-up" | "reset";

/**
 * Counts one auth attempt per email address. The key is an HMAC so the table
 * never holds an address, and the row is reset when its window has passed.
 * @param db The application database.
 * @param clock The injectable clock.
 * @param secret The HMAC key (the auth secret).
 * @param bucket Which auth surface this limit belongs to.
 * @param email The address the attempt was made with.
 * @param windowMs The width of the window.
 * @param max How many attempts fit in the window.
 * @returns Whether this attempt is inside the limit.
 */
export function consumeEmailRateLimit(
  db: AppDatabase,
  clock: Clock,
  secret: string,
  bucket: EmailRateLimitBucket,
  email: string,
  windowMs: number,
  max: number,
) {
  const digest = createHmac("sha256", secret)
    .update(`auth-email:${bucket}:${normaliseEmail(email)}`)
    .digest("hex");

  const key = `auth-email:${bucket}:${digest}`;
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
      .set({ count: row.count + 1, lastRequest: now })
      .where(eq(rateLimits.key, key))
      .run();

    return true;
  });
}
