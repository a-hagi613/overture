import { expect, test } from "bun:test";

import { openDatabase } from "../db/client.ts";
import { migrateDatabase } from "../db/migrate.ts";

import { getAllSettings, SETTING_DEFAULTS } from "./index.ts";

function freshDatabase() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

test("the admin settings screen reads the send-now defaults", () => {
  const { db, sqlite } = freshDatabase();

  try {
    const settings = getAllSettings(db);

    expect(settings["limits.send_spacing_minutes"]).toBe("5");
    expect(settings["limits.send_window"]).toBeUndefined();
    expect(settings["browser.max_concurrent_sessions"]).toBe("0");
    expect(settings["llm.cap_user_day_usd"]).toBe("0.10");
    expect(settings["llm.cap_onboarding_usd"]).toBe("0.50");
    expect(settings["llm.cap_global_day_usd"]).toBe("50");
    expect(settings["llm.cap_per_subscriber_day_usd"]).toBe("0.30");
    expect(settings["llm.cap_tagging_day_usd"]).toBe("5");
    expect(settings["mail.monthly_cap"]).toBe("2700");
    expect(settings["mail.cap_per_subscriber"]).toBe("250");
  } finally {
    sqlite.close();
  }
});

test("the safety guards stay in the settings registry", () => {
  expect(SETTING_DEFAULTS["limits.daily_cap"]).toBe("10");
  expect(SETTING_DEFAULTS["limits.max_attempts"]).toBe("2");
  expect(SETTING_DEFAULTS["limits.company_cooldown_days"]).toBe("30");
  expect(SETTING_DEFAULTS["limits.repost_guard_days"]).toBe("60");
  expect(SETTING_DEFAULTS["limits.confirm_wait_hours"]).toBe("24");
});
