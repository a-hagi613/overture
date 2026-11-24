import { describe, expect, test } from "bun:test";

import type { AppDatabase } from "./db/client.ts";

import { openDatabase } from "./db/client.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { bgJobs, mailUsage, notifications, users } from "./db/schema.ts";
import { setKillSwitch, setSetting } from "./settings/index.ts";

Bun.env.BETTER_AUTH_SECRET ??= "admin-alerts-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "admin-alerts-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "admin-alerts-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const { acknowledgeAdminAlerts, readAdminAlerts, validateAdminSettingValue } =
  await import("./admin-alerts.ts");

const NOW = Date.UTC(2026, 10, 22, 14, 0, 0);
const clock = { now: () => NOW };

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");

  return { db, sqlite };
}

function seedUser(db: AppDatabase, id: string, role: "owner" | "user") {
  db.insert(users)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      role,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    })
    .run();
}

describe("readAdminAlerts", () => {
  test("returns owner alert notifications, active problem flags and launch readiness", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "owner-1", "owner");
    seedUser(db, "member-1", "user");

    db.insert(notifications)
      .values([
        {
          id: "notif-alert-1",
          userId: "owner-1",
          kind: "alert",
          title: "Overture alert: backup.lag",
          body: JSON.stringify({ lagSeconds: 420 }),
          url: "/",
          createdAt: NOW - 1000,
        },
        {
          id: "notif-other-kind",
          userId: "owner-1",
          kind: "recap",
          title: "Daily recap",
          body: "Ready",
          url: "/ready",
          createdAt: NOW,
        },
        {
          id: "notif-other-user",
          userId: "member-1",
          kind: "alert",
          title: "Should not leak",
          body: "{}",
          url: "/",
          createdAt: NOW,
        },
      ])
      .run();

    setKillSwitch(db, clock, "global", "all", true, "maintenance", "owner");
    setSetting(db, clock, "limits.daily_cap", "15", "owner-1");
    setSetting(db, clock, "browser.max_concurrent_sessions", "4", "owner-1");

    db.insert(bgJobs)
      .values({
        id: "dead-job-1",
        kind: "application.send",
        payload: "{}",
        runAt: NOW - 5000,
        status: "dead",
        createdAt: NOW - 5000,
        updatedAt: NOW - 1000,
      })
      .run();

    db.insert(mailUsage)
      .values({
        month: "2026-11",
        authSends: 100,
        systemSends: 100,
        noticeSends: 2100,
      })
      .run();

    const snapshot = readAdminAlerts({
      backupStatus: {
        replication: "ok",
        lagSeconds: 420,
        replicaTxid: "0000000000000001",
        readAgeSeconds: 5,
      },
      clock,
      db,
      ownerUserId: "owner-1",
      readinessEnv: {
        alertNtfyConfigured: true,
        cfAccessConfigured: true,
        publicSignupEnabled: true,
        stripeSecretKey: "sk_test_example",
        stripeWebhookSecret: "whsec_example",
      },
    });

    expect(snapshot.unreadCount).toBe(1);
    expect(snapshot.notifications.map((row) => row.id)).toStrictEqual(["notif-alert-1"]);
    expect(snapshot.notifications[0]?.detail).toStrictEqual({ lagSeconds: 420 });

    const codes = snapshot.problems.map((problem) => problem.code);

    expect(codes).toContain("kill_switch_active");
    expect(codes).toContain("dead_jobs");
    expect(codes).toContain("mail_cap_near");
    expect(codes).toContain("backup_lag");

    expect(snapshot.readiness.dailyCap).toBe(15);
    expect(snapshot.readiness.browserConcurrency).toBe(4);
    expect(snapshot.readiness.publicSignupEnabled).toBe(true);
    expect(snapshot.readiness.stripeMode).toBe("test");
    expect(snapshot.readiness.cfAccessConfigured).toBe(true);
    expect(snapshot.readiness.alertNtfyConfigured).toBe(true);

    sqlite.close();
  });

  test("acknowledges single and all unread owner alerts idempotently", () => {
    const { db, sqlite } = migrated();

    seedUser(db, "owner-1", "owner");

    db.insert(notifications)
      .values([
        {
          id: "alert-1",
          userId: "owner-1",
          kind: "alert",
          title: "Overture alert: disk",
          body: JSON.stringify({ usedRatio: 0.9 }),
          url: "/",
          createdAt: NOW - 2000,
        },
        {
          id: "alert-2",
          userId: "owner-1",
          kind: "alert",
          title: "Overture alert: health",
          body: JSON.stringify({ healthy: false }),
          url: "/",
          createdAt: NOW - 1000,
        },
      ])
      .run();

    const one = acknowledgeAdminAlerts(db, clock, "owner-1", "alert-1");

    expect(one).toStrictEqual({ acknowledged: 1, readAt: NOW });

    const repeat = acknowledgeAdminAlerts(db, clock, "owner-1", "alert-1");

    expect(repeat).toStrictEqual({ acknowledged: 0, readAt: NOW });

    const rest = acknowledgeAdminAlerts(db, clock, "owner-1");

    expect(rest).toStrictEqual({ acknowledged: 1, readAt: NOW });

    const after = readAdminAlerts({
      backupStatus: { replication: "unconfigured" },
      clock,
      db,
      ownerUserId: "owner-1",
      readinessEnv: {
        alertNtfyConfigured: false,
        cfAccessConfigured: false,
        publicSignupEnabled: false,
        stripeSecretKey: undefined,
        stripeWebhookSecret: undefined,
      },
    });

    expect(after.unreadCount).toBe(0);
    expect(after.problems.every((problem) => problem.code === "kill_switch_active")).toBe(true);
    expect(after.readiness.stripeMode).toBe("disabled");

    setKillSwitch(db, clock, "ats", "personio", false, "cleared", "owner");
    setKillSwitch(db, clock, "ats", "workable", false, "cleared", "owner");
    setSetting(db, clock, "browser.max_concurrent_sessions", "0", "owner-1");

    const cleared = readAdminAlerts({
      backupStatus: { replication: "unconfigured" },
      clock,
      db,
      ownerUserId: "owner-1",
      readinessEnv: {
        alertNtfyConfigured: false,
        cfAccessConfigured: false,
        publicSignupEnabled: false,
        stripeSecretKey: undefined,
        stripeWebhookSecret: undefined,
      },
    });

    expect(cleared.problems).toStrictEqual([]);
    expect(cleared.readiness.browserConcurrency).toBe(0);

    sqlite.close();
  });
});

describe("validateAdminSettingValue", () => {
  test("validates daily cap and browser concurrency bounds", () => {
    expect(validateAdminSettingValue("limits.daily_cap", "5")).toBe(true);
    expect(validateAdminSettingValue("limits.daily_cap", "100")).toBe(true);
    expect(validateAdminSettingValue("limits.daily_cap", "0")).toBe(false);
    expect(validateAdminSettingValue("limits.daily_cap", "101")).toBe(false);
    expect(validateAdminSettingValue("limits.daily_cap", "abc")).toBe(false);

    expect(validateAdminSettingValue("browser.max_concurrent_sessions", "0")).toBe(true);
    expect(validateAdminSettingValue("browser.max_concurrent_sessions", "1")).toBe(true);
    expect(validateAdminSettingValue("browser.max_concurrent_sessions", "20")).toBe(true);
    expect(validateAdminSettingValue("browser.max_concurrent_sessions", "-1")).toBe(false);
    expect(validateAdminSettingValue("browser.max_concurrent_sessions", "21")).toBe(false);

    expect(validateAdminSettingValue("limits.send_spacing_minutes", "20")).toBe(true);
  });

  test("validates the subscriber-scaled budget and alert share settings", () => {
    expect(validateAdminSettingValue("llm.cap_per_subscriber_day_usd", "0.30")).toBe(true);
    expect(validateAdminSettingValue("llm.cap_subscriber_user_day_usd", "0.25")).toBe(true);
    expect(validateAdminSettingValue("llm.cap_per_subscriber_day_usd", "a lot")).toBe(false);

    expect(validateAdminSettingValue("llm.spend_alert_ratio", "0.8")).toBe(true);
    expect(validateAdminSettingValue("llm.spend_alert_ratio", "0")).toBe(false);
    expect(validateAdminSettingValue("llm.spend_alert_ratio", "1.5")).toBe(false);

    expect(validateAdminSettingValue("mail.cap_per_subscriber", "250")).toBe(true);
    expect(validateAdminSettingValue("mail.cap_per_subscriber", "2.5")).toBe(false);

    expect(validateAdminSettingValue("mail.warning_share", "0.8")).toBe(true);
    expect(validateAdminSettingValue("mail.warning_share", "0")).toBe(false);
  });
});
