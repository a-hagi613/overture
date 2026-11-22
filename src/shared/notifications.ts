/**
 * What the app tells a user about, in the order Settings lists it (#228). One
 * entry per kind of push and in-app list row; `recap_email` is the separate
 * switch for the one Recap email (SPEC §15.1).
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

export const RECAP_EMAIL_PREFERENCE = "recap_email";

/**
 * Whether the Recap also lists yesterday's sends and replies. The board draws
 * it under the recap switch; the digest always summarises yesterday unless the
 * user turns this off (SPEC §15.1).
 */
export const RECAP_INCLUDE_YESTERDAY_PREFERENCE = "recap_include_yesterday";

export const NOTIFICATION_PREFERENCE_KEYS = [
  ...NOTIFICATION_KINDS,
  RECAP_EMAIL_PREFERENCE,
  RECAP_INCLUDE_YESTERDAY_PREFERENCE,
] as const;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

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
  recap_email: true,
  recap_include_yesterday: true,
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
