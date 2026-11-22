import { expect, test } from "bun:test";

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isNotificationPreferenceKey,
  NOTIFICATION_KINDS,
  NOTIFICATION_PREFERENCE_KEYS,
  RECAP_EMAIL_PREFERENCE,
  RECAP_INCLUDE_YESTERDAY_PREFERENCE,
} from "./notifications.ts";

test("the recap switches are preferences but not push kinds", () => {
  expect(NOTIFICATION_PREFERENCE_KEYS).toContain(RECAP_EMAIL_PREFERENCE);
  expect(NOTIFICATION_PREFERENCE_KEYS).toContain(RECAP_INCLUDE_YESTERDAY_PREFERENCE);
  expect(NOTIFICATION_KINDS).not.toContain(RECAP_EMAIL_PREFERENCE);
  expect(NOTIFICATION_KINDS).not.toContain(RECAP_INCLUDE_YESTERDAY_PREFERENCE);
});

test("every preference starts on, including yesterday in the recap", () => {
  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    expect(DEFAULT_NOTIFICATION_PREFERENCES[key]).toBe(true);
  }
});

test("the new key is accepted by the preference guard", () => {
  expect(isNotificationPreferenceKey(RECAP_INCLUDE_YESTERDAY_PREFERENCE)).toBe(true);
  expect(isNotificationPreferenceKey("recap_include_everything")).toBe(false);
});
