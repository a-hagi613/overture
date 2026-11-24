import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "./db/client.ts";
import type { BackupStatus } from "./ports/backup.ts";
import type { Clock } from "./ports/clock.ts";

import { buildCostSummary } from "../dispatch/report.ts";
import { BACKUP_LAG_CEILING_SECONDS } from "../live-checks/alerts.ts";
import { bgJobs, notifications } from "./db/schema.ts";
import { readMailSummary } from "./mail/budget.ts";
import { getAllKillSwitches, getSettingNumber } from "./settings/index.ts";

const ALERT_LIST_LIMIT = 50;
const MAIL_WARN_RATIO = 0.8;
const INTEGER_TEXT = /^\d+$/u;
const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/u;

const alertDetailSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export type AdminProblemSeverity = "critical" | "warning";

export type AdminProblemCode =
  | "kill_switch_active"
  | "dead_jobs"
  | "mail_cap_reached"
  | "mail_reserve_reached"
  | "mail_cap_near"
  | "backup_unavailable"
  | "backup_lag"
  | "health_degraded";

export interface AdminAlertProblem {
  id: string;
  code: AdminProblemCode;
  severity: AdminProblemSeverity;
  title: string;
  detail: string;
}

export interface AdminAlertNotification {
  id: string;
  title: string;
  body: string;
  detail: Record<string, string | number | boolean | null> | null;
  url: string;
  createdAt: number;
  readAt: number | null;
}

export type StripeMode = "live" | "test" | "disabled";

export interface LaunchReadiness {
  dailyCap: number;
  browserConcurrency: number;
  publicSignupEnabled: boolean;
  stripeMode: StripeMode;
  cfAccessConfigured: boolean;
  alertNtfyConfigured: boolean;
  costGate: {
    completed: number;
    costGateMet: boolean | null;
    costMicrosPerCompleted: number | null;
    costGateMicros: number;
  };
}

export interface AdminAlertsSnapshot {
  now: number;
  unreadCount: number;
  problems: AdminAlertProblem[];
  notifications: AdminAlertNotification[];
  readiness: LaunchReadiness;
}

export interface LaunchReadinessEnv {
  publicSignupEnabled: boolean;
  stripeSecretKey: string | undefined;
  stripeWebhookSecret: string | undefined;
  cfAccessConfigured: boolean;
  alertNtfyConfigured: boolean;
}

function parseNotificationDetail(body: string) {
  try {
    const parsed = alertDetailSchema.safeParse(JSON.parse(body));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function stripeModeOf(secretKey: string | undefined, webhookSecret: string | undefined) {
  if (secretKey === undefined || webhookSecret === undefined) {
    return "disabled" satisfies StripeMode;
  }

  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live" satisfies StripeMode;
  }

  return "test" satisfies StripeMode;
}

export function validateAdminSettingValue(key: string, value: string) {
  const trimmed = value.trim();

  if (key === "limits.daily_cap") {
    if (!INTEGER_TEXT.test(trimmed)) {
      return false;
    }

    const parsed = Number(trimmed);

    return parsed >= 1 && parsed <= 100;
  }

  if (key === "browser.max_concurrent_sessions") {
    if (!INTEGER_TEXT.test(trimmed)) {
      return false;
    }

    const parsed = Number(trimmed);

    return parsed >= 0 && parsed <= 20;
  }

  if (key === "limits.timezone_change_days") {
    if (!INTEGER_TEXT.test(trimmed)) {
      return false;
    }

    const parsed = Number(trimmed);

    return parsed >= 1 && parsed <= 365;
  }

  if (key === "llm.daily_spend_cap_micros" || key === "llm.monthly_spend_cap_micros") {
    return INTEGER_TEXT.test(trimmed);
  }

  if (key.startsWith("llm.cap_")) {
    return DECIMAL_TEXT.test(trimmed);
  }

  if (key === "llm.spend_alert_ratio" || key === "mail.warning_share") {
    return DECIMAL_TEXT.test(trimmed) && Number(trimmed) > 0 && Number(trimmed) <= 1;
  }

  if (key === "mail.cap_per_subscriber") {
    return INTEGER_TEXT.test(trimmed);
  }

  return trimmed.length > 0;
}

function activeProblemsOf(db: AppDatabase, now: number, backupStatus: BackupStatus) {
  const problems: AdminAlertProblem[] = [];

  try {
    db.run(sql`select 1`);
  } catch {
    problems.push({
      code: "health_degraded",
      detail: "The database health probe failed.",
      id: "health:db",
      severity: "critical",
      title: "Database health check failed",
    });
  }

  for (const row of getAllKillSwitches(db)) {
    if (row.enabled !== 1) {
      continue;
    }

    const scopeLabel = `${row.scope}/${row.key}`;

    problems.push({
      code: "kill_switch_active",
      detail: row.reason.length > 0 ? `${scopeLabel}: ${row.reason}` : scopeLabel,
      id: `kill_switch:${scopeLabel}`,
      severity: row.scope === "global" ? "critical" : "warning",
      title: `Kill switch active: ${scopeLabel}`,
    });
  }

  const deadJobs =
    db.select({ total: count() }).from(bgJobs).where(eq(bgJobs.status, "dead")).get()?.total ?? 0;

  if (deadJobs > 0) {
    problems.push({
      code: "dead_jobs",
      detail: `${String(deadJobs)} background jobs stopped after exhausting retries.`,
      id: "jobs:dead",
      severity: "critical",
      title: `${String(deadJobs)} dead background jobs`,
    });
  }

  const mail = readMailSummary(db, now);

  if (mail.refusedAt !== null) {
    problems.push({
      code: "mail_cap_reached",
      detail: `${String(mail.total)} of ${String(mail.cap)} emails sent in ${mail.month}.`,
      id: "mail:cap_reached",
      severity: "critical",
      title: "Monthly email cap reached",
    });
  } else if (mail.reserveRefusedAt !== null) {
    problems.push({
      code: "mail_reserve_reached",
      detail: `${String(mail.total)} of ${String(mail.cap)} emails sent; notices paused to keep ${String(mail.reserve)} for sign-in.`,
      id: "mail:reserve_reached",
      severity: "warning",
      title: "Email sign-in reserve in force",
    });
  } else if (mail.warnedAt !== null || (mail.cap > 0 && mail.total >= mail.cap * MAIL_WARN_RATIO)) {
    problems.push({
      code: "mail_cap_near",
      detail: `${String(mail.total)} of ${String(mail.cap)} emails sent in ${mail.month}.`,
      id: "mail:cap_near",
      severity: "warning",
      title: "Monthly email usage above 80%",
    });
  }

  if (backupStatus.replication === "unavailable") {
    problems.push({
      code: "backup_unavailable",
      detail: "Litestream replica status could not be read.",
      id: "backup:unavailable",
      severity: "critical",
      title: "Backup replication unavailable",
    });
  } else if (
    backupStatus.replication === "ok" &&
    backupStatus.lagSeconds > BACKUP_LAG_CEILING_SECONDS
  ) {
    problems.push({
      code: "backup_lag",
      detail: `Replica lags ${String(backupStatus.lagSeconds)}s (ceiling ${String(BACKUP_LAG_CEILING_SECONDS)}s).`,
      id: "backup:lag",
      severity: "warning",
      title: "Backup replication lag high",
    });
  }

  return problems;
}

export function readAdminAlerts(input: {
  db: AppDatabase;
  clock: Clock;
  ownerUserId: string;
  backupStatus: BackupStatus;
  readinessEnv: LaunchReadinessEnv;
}) {
  const { backupStatus, clock, db, ownerUserId, readinessEnv } = input;
  const now = clock.now();

  const rows = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, ownerUserId), eq(notifications.kind, "alert")))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(ALERT_LIST_LIMIT)
    .all();

  const unreadCount =
    db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ownerUserId),
          eq(notifications.kind, "alert"),
          isNull(notifications.readAt),
        ),
      )
      .get()?.total ?? 0;

  const cost = buildCostSummary(db, clock);

  const readiness: LaunchReadiness = {
    alertNtfyConfigured: readinessEnv.alertNtfyConfigured,
    browserConcurrency: getSettingNumber(db, "browser.max_concurrent_sessions", {
      integer: true,
      minimum: 0,
    }),
    cfAccessConfigured: readinessEnv.cfAccessConfigured,
    costGate: {
      completed: cost.completed,
      costGateMet: cost.costGateMet,
      costGateMicros: cost.costGateMicros,
      costMicrosPerCompleted: cost.costMicrosPerCompleted,
    },
    dailyCap: getSettingNumber(db, "limits.daily_cap", { integer: true, minimum: 1 }),
    publicSignupEnabled: readinessEnv.publicSignupEnabled,
    stripeMode: stripeModeOf(readinessEnv.stripeSecretKey, readinessEnv.stripeWebhookSecret),
  };

  return {
    notifications: rows.map((row) => ({
      body: row.body,
      createdAt: row.createdAt,
      detail: parseNotificationDetail(row.body),
      id: row.id,
      readAt: row.readAt?.getTime() ?? null,
      title: row.title,
      url: row.url,
    })),
    now,
    problems: activeProblemsOf(db, now, backupStatus),
    readiness,
    unreadCount,
  } satisfies AdminAlertsSnapshot;
}

export function acknowledgeAdminAlerts(
  db: AppDatabase,
  clock: Clock,
  ownerUserId: string,
  notificationId?: string,
) {
  const readAt = clock.now();

  const condition =
    notificationId === undefined
      ? and(
          eq(notifications.userId, ownerUserId),
          eq(notifications.kind, "alert"),
          isNull(notifications.readAt),
        )
      : and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, ownerUserId),
          eq(notifications.kind, "alert"),
          isNull(notifications.readAt),
        );

  const updated = db
    .update(notifications)
    .set({ readAt: new Date(readAt) })
    .where(condition)
    .returning({ id: notifications.id })
    .all();

  return { acknowledged: updated.length, readAt };
}
