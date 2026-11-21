import { eq, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { killSwitches, settings } from "../db/schema.ts";

const SETTING_DEFAULTS = {
  "limits.daily_cap": "10",
  "limits.send_window": '{"start":"08:00","end":"20:00"}',
  "limits.send_spacing_minutes": "20",
  "limits.company_cooldown_days": "30",
  "limits.repost_guard_days": "60",
  "limits.crowd_per_posting": "20",
  "limits.crowd_per_employer_week": "50",
  "limits.ats_hourly.greenhouse": "120",
  "limits.ats_hourly.lever": "120",
  "limits.ats_hourly.ashby": "120",
  "limits.ats_hourly.personio": "120",
  "limits.max_attempts": "2",
  "limits.confirm_wait_hours": "24",
  "limits.reply_per_day": "20",
  "limits.timezone_change_days": "7",
  "match.auto_threshold_default": "60",
  "match.strong": "80",
  "prep.run_local_time": "07:00",
  "llm.cap_user_day_usd": "0.25",
  "llm.cap_global_day_usd": "10",
  "llm.cap_tagging_day_usd": "1",
  "browser.provider": "browser_use",
  "browser.concurrency": "10",
  "browser.max_concurrent_sessions": "3",
  "checkin.after_days": "21",
  "checkin.close_after_days": "45",
  "invite.grant_quantity": "300",
  "invite.grant_days": "30",
  "mail.monthly_cap": "2700",
  "mail.sign_in_reserve": "270",
  "jobs.poll_interval_ms": "15000",
  "jobs.batch_size": "10",
  "catalog.sweep_max_boards": "20",
  "backups.replica_read_interval_ms": "30000",
  "live_checks.mail_wait_minutes": "5",
} satisfies Record<string, string>;

export { SETTING_DEFAULTS };

export function getSetting(db: AppDatabase, key: string) {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  const defaults = new Map<string, string>(Object.entries(SETTING_DEFAULTS));

  return row?.value ?? defaults.get(key) ?? null;
}

export function setSetting(
  db: AppDatabase,
  clock: Clock,
  key: string,
  value: string,
  updatedBy: string,
) {
  db.insert(settings)
    .values({ key, value, updatedAt: clock.now(), updatedBy })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: clock.now(), updatedBy },
    })
    .run();
}

export function getAllSettings(db: AppDatabase) {
  const rows = db.select().from(settings).all();
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result: Record<string, string> = {};

  for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
    result[key] = stored.get(key) ?? def;
  }

  for (const [key, value] of stored) {
    result[key] = value;
  }

  return result;
}

export function isKillSwitchEnabled(
  db: AppDatabase,
  scope: "global" | "ats" | "employer" | "provider",
  key: string,
) {
  const row = db
    .select()
    .from(killSwitches)
    .where(sql`${killSwitches.scope} = ${scope} AND ${killSwitches.key} = ${key}`)
    .get();

  return row?.enabled === 1;
}

export function setKillSwitch(
  db: AppDatabase,
  clock: Clock,
  scope: "global" | "ats" | "employer" | "provider",
  key: string,
  enabled: boolean,
  reason: string,
  setBy: "auto" | "owner",
) {
  db.insert(killSwitches)
    .values({ scope, key, enabled: enabled ? 1 : 0, reason, setBy, setAt: clock.now() })
    .onConflictDoUpdate({
      target: [killSwitches.scope, killSwitches.key],
      set: { enabled: enabled ? 1 : 0, reason, setBy, setAt: clock.now() },
    })
    .run();
}

export function getAllKillSwitches(db: AppDatabase) {
  return db.select().from(killSwitches).all();
}
