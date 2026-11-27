/**
 * What the app tells a user about, in the order Settings lists it (#228). One
 * entry per kind of push and in-app list row (SPEC §15.1).
 */
export const NOTIFICATION_KINDS = [
  "ready",
  "review",
  "reply",
  "interview",
  "offer",
  "stage_move",
  "code_wait",
  "paused",
  "failed",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_PREFERENCE_KEYS = NOTIFICATION_KINDS;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

/**
 * How long one kind collects events before the row stands on its own. A burst
 * inside the window updates the row already there, so a form that asks sixteen
 * questions raises one notice rather than sixteen (#705).
 */
export const NOTIFICATION_BATCH_WINDOW_MS = 2 * 60_000;

/**
 * Every kind starts on, so a new user hears about each event until they turn
 * it off (SPEC §15.1).
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  code_wait: true,
  failed: true,
  interview: true,
  offer: true,
  paused: true,
  ready: true,
  reply: true,
  review: true,
  stage_move: true,
};

export function isNotificationPreferenceKey(value: string): value is NotificationPreferenceKey {
  const keys: readonly string[] = NOTIFICATION_PREFERENCE_KEYS;

  return keys.includes(value);
}

export function isNotificationKind(value: string): value is NotificationKind {
  const kinds: readonly string[] = NOTIFICATION_KINDS;

  return kinds.includes(value);
}

/**
 * The `settings` row prefix a user's preferences live under, one JSON row per
 * user. It keeps per-user data out of the global settings read path, which
 * never returns a key with this prefix (there is no free migration slot for a
 * dedicated table while #303, #323 and the security finding hold 0040-0042).
 */
export const NOTIFICATION_PREFERENCES_KEY_PREFIX = "notify.preferences.";

export function notificationPreferencesKey(userId: string) {
  return `${NOTIFICATION_PREFERENCES_KEY_PREFIX}${userId}`;
}
