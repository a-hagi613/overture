import { eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  notificationPreferencesKey,
} from "../../shared/notifications.ts";
import type { NotificationPreferenceKey } from "../../shared/notifications.ts";
import { settings } from "../platform/db/schema.ts";

const storedSchema = z.partialRecord(z.enum(NOTIFICATION_PREFERENCE_KEYS), z.boolean());

function storedPreferences(db: AppDatabase, userId: string) {
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, notificationPreferencesKey(userId)))
    .get();

  if (row === undefined) {
    return {};
  }

  try {
    const parsed = storedSchema.safeParse(JSON.parse(row.value));

    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Every notification kind and the Recap email switch for one user. A kind with
 * no stored row is on, so a new user hears about everything until they turn it
 * off (SPEC §15.1).
 * @param db The application database.
 * @param userId The signed-in user.
 * @returns The user's preferences, keyed by preference kind.
 */
export function readNotificationPreferences(db: AppDatabase, userId: string) {
  const stored = storedPreferences(db, userId);

  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...stored };
}

/**
 * Whether one kind of push or list row may be delivered to the user.
 * @param db The application database.
 * @param userId The user the notification is for.
 * @param key The notification kind, or `recap_email`.
 * @returns True unless the user turned that kind off.
 */
export function notificationPreferenceEnabled(
  db: AppDatabase,
  userId: string,
  key: NotificationPreferenceKey,
) {
  const preferences = readNotificationPreferences(db, userId);

  return preferences[key];
}

/**
 * Persist one switch. Only the user's own row is written, so one user can never
 * change another's preferences.
 * @param db The application database.
 * @param clock The clock the row is stamped from.
 * @param userId The signed-in user, never taken from the request body.
 * @param key The kind to change.
 * @param enabled Whether it should be delivered.
 * @returns The user's preferences after the change.
 */
export function setNotificationPreference(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  key: NotificationPreferenceKey,
  enabled: boolean,
) {
  const next = { ...storedPreferences(db, userId), [key]: enabled };
  const now = clock.now();

  db.insert(settings)
    .values({
      key: notificationPreferencesKey(userId),
      updatedAt: now,
      updatedBy: userId,
      value: JSON.stringify(next),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { updatedAt: now, updatedBy: userId, value: JSON.stringify(next) },
    })
    .run();

  return readNotificationPreferences(db, userId);
}
