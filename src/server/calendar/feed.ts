import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { calendarFeedTokens } from "../platform/db/schema.ts";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface FeedStatus {
  enabled: boolean;
  createdAt: number | null;
  rotatedAt: number | null;
}

/**
 * A new feed URL token. Only its hash is stored, so the value is shown once, when it is issued.
 * @returns A fresh token, 256 bits from the system CSPRNG.
 */
export function newFeedToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * The stored form of a feed token. A token has 256 bits of entropy, so a fast hash is enough: a lookup by hash
 * cannot be brute-forced, and no salt is needed for a value that is never compared to a guessable input.
 * @param token The plaintext token from the URL.
 * @returns The lowercase hex SHA-256 digest.
 */
export function feedTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Whether a string has the shape of a feed token, before any database lookup.
 * @param value The candidate from the URL path.
 * @returns True when the value is 43 base64url characters.
 */
export function isPlausibleFeedToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

/**
 * The Settings view of a user's feed. It never includes the token itself.
 * @param db The database.
 * @param userId The signed-in user.
 * @returns Whether the feed is on, and when it was issued and last rotated.
 */
export function feedStatusOf(db: AppDatabase, userId: string) {
  const row = db
    .select({ createdAt: calendarFeedTokens.createdAt, rotatedAt: calendarFeedTokens.rotatedAt })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.userId, userId))
    .get();

  if (row === undefined) {
    return { createdAt: null, enabled: false, rotatedAt: null };
  }

  return { createdAt: row.createdAt, enabled: true, rotatedAt: row.rotatedAt };
}

/**
 * Turns the feed on, or rotates it when it is already on. Either way the previous token stops working at once,
 * because the stored hash is replaced.
 * @param db The database.
 * @param clock The clock that stamps the issue time.
 * @param userId The signed-in user.
 * @returns The new plaintext token (shown once) and the updated status.
 */
export function issueFeedToken(db: AppDatabase, clock: Clock, userId: string) {
  const token = newFeedToken();
  const tokenHash = feedTokenHash(token);
  const now = clock.now();

  const existing = db
    .select({ id: calendarFeedTokens.id, createdAt: calendarFeedTokens.createdAt })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.userId, userId))
    .get();

  if (existing === undefined) {
    db.insert(calendarFeedTokens)
      .values({
        createdAt: now,
        id: randomUUID(),
        rotatedAt: now,
        tokenHash,
        userId,
      })
      .run();
  } else {
    db.update(calendarFeedTokens)
      .set({ rotatedAt: now, tokenHash })
      .where(eq(calendarFeedTokens.id, existing.id))
      .run();
  }

  return {
    status: {
      createdAt: existing?.createdAt ?? now,
      enabled: true,
      rotatedAt: now,
    } satisfies FeedStatus,
    token,
  };
}

/**
 * Turns the feed off. The URL stops working at once; turning it on again issues a new token.
 * @param db The database.
 * @param userId The signed-in user.
 */
export function revokeFeedToken(db: AppDatabase, userId: string) {
  db.delete(calendarFeedTokens).where(eq(calendarFeedTokens.userId, userId)).run();
}

/**
 * Finds the owner of a feed URL token.
 * @param db The database.
 * @param token The plaintext token from the URL.
 * @returns The user id, or null when the shape is wrong, the token is unknown or the feed was turned off.
 */
export function userIdForFeedToken(db: AppDatabase, token: string) {
  if (!isPlausibleFeedToken(token)) {
    return null;
  }

  const row = db
    .select({ userId: calendarFeedTokens.userId })
    .from(calendarFeedTokens)
    .where(eq(calendarFeedTokens.tokenHash, feedTokenHash(token)))
    .get();

  return row?.userId ?? null;
}
