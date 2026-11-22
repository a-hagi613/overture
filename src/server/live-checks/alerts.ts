import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { AlertKind } from "../platform/alerts.ts";
import type { LiveCheckResult } from "./types.ts";
import type { MailReplyCounts } from "../inbox/health.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { capMicros } from "../platform/llm/caps.ts";
import { llmSpendTodayMicros } from "../platform/llm/usage.ts";
import { unhandledRejectionCount } from "../platform/process-guard.ts";
import { catalogWorkerCrashCount } from "../catalog/worker-restarts.ts";
import { applications, attempts, bgJobs } from "../platform/db/schema.ts";

import {
  MAIL_DOMAIN_MIN_SENDS,
  MAIL_REPLY_FLOOR,
  MAIL_REPLY_MIN_SENDS,
  readMailReplyCounts,
} from "../inbox/health.ts";

export const ALERT_WINDOW_MS = 60 * 60_000;
export const ATS_SUCCESS_FLOOR = 0.7;
export const PROVIDER_SUCCESS_FLOOR = 0.6;
export const CODE_CHALLENGE_CEILING = 0.2;
export const QUEUE_AGE_CEILING_MS = 30 * 60_000;
export const SPEND_CEILING_RATIO = 0.8;
export const BACKUP_LAG_CEILING_SECONDS = 300;
export const DISK_CEILING_RATIO = 0.8;
export const MIN_ATTEMPTS_TO_JUDGE = 5;

const ATTEMPTED_EXCLUDED = new Set(["posting_closed", "duplicate", "needs_review"]);

export interface RateMetric {
  key: string;
  attempts: number;
  rate: number;
}

export interface AlertMetrics {
  atsSuccess: RateMetric[];
  providerSuccess: RateMetric[];
  codeChallenge: { attempted: number; codeRate: number; challengeRate: number };
  queueOldestAgeMs: number;
  llmSpend: { cap: string; spentMicros: number; capMicros: number }[];
  backupReplication: "unconfigured" | "unknown" | "unavailable" | "ok";
  backupLagSeconds: number;
  health: boolean;
  disk: { usedRatio: number; mount: string };
  unhandledRejections: number;
  catalogWorkerCrashes: number;
  mailHealth: MailReplyCounts;
}

function rateMetrics(rows: { key: string; outcome: string | null }[]) {
  const groups = new Map<string, { attempts: number; sent: number }>();

  for (const row of rows) {
    if (row.outcome === null || ATTEMPTED_EXCLUDED.has(row.outcome)) {
      continue;
    }

    const group = groups.get(row.key) ?? { attempts: 0, sent: 0 };

    group.attempts += 1;
    group.sent += row.outcome === "sent" ? 1 : 0;
    groups.set(row.key, group);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    attempts: group.attempts,
    rate: group.attempts === 0 ? 1 : group.sent / group.attempts,
  }));
}

export async function collectAlertMetrics(deps: {
  db: AppDatabase;
  clock: Clock;
  backupReplication: AlertMetrics["backupReplication"];
  backupLagSeconds: number;
  databasePath: string;
}) {
  const { db, clock } = deps;
  const since = clock.now() - ALERT_WINDOW_MS;

  const attemptRows = db
    .select({
      ats: applications.ats,
      captchaSeen: attempts.captchaSeen,
      codeUsed: attempts.codeUsed,
      outcome: attempts.outcome,
      provider: attempts.provider,
    })
    .from(attempts)
    .innerJoin(applications, eq(applications.id, attempts.applicationId))
    .where(gte(attempts.startedAt, since))
    .all();

  const attempted = attemptRows.filter(
    (row) => row.outcome !== null && !ATTEMPTED_EXCLUDED.has(row.outcome),
  );

  const oldestQueue = db
    .select({ oldest: sql<number | null>`min(${applications.scheduledFor})` })
    .from(applications)
    .where(
      and(
        eq(applications.status, "ready"),
        isNotNull(applications.scheduledFor),
        lte(applications.scheduledFor, clock.now()),
      ),
    )
    .get();

  const oldestJob = db
    .select({ oldest: sql<number | null>`min(${bgJobs.runAt})` })
    .from(bgJobs)
    .where(and(eq(bgJobs.status, "queued"), lte(bgJobs.runAt, clock.now())))
    .get();

  const oldest = Math.min(oldestQueue?.oldest ?? clock.now(), oldestJob?.oldest ?? clock.now());

  let health = true;

  try {
    db.run(sql`select 1`);
  } catch {
    health = false;
  }

  const mount = dirname(resolve(deps.databasePath));

  const fs = await statfs(mount).catch(() => null);

  const usedRatio = fs === null || fs.blocks === 0 ? 0 : 1 - fs.bavail / fs.blocks;

  return {
    atsSuccess: rateMetrics(
      attemptRows.flatMap((row) =>
        row.ats === null ? [] : [{ key: row.ats, outcome: row.outcome }],
      ),
    ),
    providerSuccess: rateMetrics(
      attemptRows.map((row) => ({ key: row.provider, outcome: row.outcome })),
    ),
    codeChallenge: {
      attempted: attempted.length,
      codeRate:
        attempted.length === 0
          ? 0
          : attempted.filter((row) => row.codeUsed).length / attempted.length,
      challengeRate:
        attempted.length === 0
          ? 0
          : attempted.filter((row) => row.captchaSeen).length / attempted.length,
    },
    queueOldestAgeMs: Math.max(0, clock.now() - oldest),
    llmSpend: [
      {
        cap: "global",
        spentMicros: llmSpendTodayMicros(db, clock.now(), null, null),
        capMicros: capMicros(db, "llm.cap_global_day_usd"),
      },
      {
        cap: "tagging",
        spentMicros: llmSpendTodayMicros(db, clock.now(), "tag_fallback", null),
        capMicros: capMicros(db, "llm.cap_tagging_day_usd"),
      },
    ],
    backupReplication: deps.backupReplication,
    backupLagSeconds: deps.backupLagSeconds,
    health,
    disk: { usedRatio, mount },
    unhandledRejections: unhandledRejectionCount(),
    catalogWorkerCrashes: catalogWorkerCrashCount(),
    mailHealth: readMailReplyCounts(db, clock),
  };
}

function result(
  check: string,
  ok: boolean,
  startedAt: number,
  durationMs: number,
  detail: Record<string, string | number | boolean | null>,
) {
  return { check, ok, startedAt, durationMs, detail } satisfies LiveCheckResult;
}

export function evaluateAlerts(db: AppDatabase, clock: Clock, metrics: AlertMetrics) {
  const startedAt = clock.now();
  const results: LiveCheckResult[] = [];
  const raised: AlertKind[] = [];

  const judge = (
    check: string,
    breached: boolean,
    kind: AlertKind,
    detail: Record<string, string | number | boolean | null>,
  ) => {
    if (breached) {
      raiseAlert(db, clock, kind, detail);
      raised.push(kind);
    }

    results.push(result(check, !breached, startedAt, clock.now() - startedAt, detail));
  };

  const judgedAts = metrics.atsSuccess.filter((entry) => entry.attempts >= MIN_ATTEMPTS_TO_JUDGE);

  const [worstAts] = judgedAts.toSorted((left, right) => left.rate - right.rate);

  judge(
    "alert.ats.success",
    worstAts !== undefined && worstAts.rate < ATS_SUCCESS_FLOOR,
    "ats.success",
    {
      ats: worstAts?.key ?? null,
      attempts: worstAts?.attempts ?? 0,
      floor: ATS_SUCCESS_FLOOR,
      rate: worstAts?.rate ?? null,
    },
  );

  const judgedProviders = metrics.providerSuccess.filter(
    (entry) => entry.attempts >= MIN_ATTEMPTS_TO_JUDGE,
  );

  const [worstProvider] = judgedProviders.toSorted((left, right) => left.rate - right.rate);

  judge(
    "alert.provider.success",
    worstProvider !== undefined && worstProvider.rate < PROVIDER_SUCCESS_FLOOR,
    "provider.success",
    {
      attempts: worstProvider?.attempts ?? 0,
      floor: PROVIDER_SUCCESS_FLOOR,
      provider: worstProvider?.key ?? null,
      rate: worstProvider?.rate ?? null,
    },
  );

  const codeChallengeBreached =
    metrics.codeChallenge.attempted >= MIN_ATTEMPTS_TO_JUDGE &&
    (metrics.codeChallenge.codeRate > CODE_CHALLENGE_CEILING ||
      metrics.codeChallenge.challengeRate > CODE_CHALLENGE_CEILING);

  judge("alert.code.challenge_rate", codeChallengeBreached, "code.challenge_rate", {
    attempted: metrics.codeChallenge.attempted,
    ceiling: CODE_CHALLENGE_CEILING,
    codeRate: metrics.codeChallenge.codeRate,
    challengeRate: metrics.codeChallenge.challengeRate,
  });

  judge("alert.queue.age", metrics.queueOldestAgeMs > QUEUE_AGE_CEILING_MS, "queue.age", {
    ageMs: metrics.queueOldestAgeMs,
    ceilingMs: QUEUE_AGE_CEILING_MS,
  });

  const overSpend = metrics.llmSpend.filter(
    (entry) => entry.capMicros > 0 && entry.spentMicros > entry.capMicros * SPEND_CEILING_RATIO,
  );

  const [firstOverSpend] = overSpend;

  judge("alert.llm.spend", overSpend.length > 0, "llm.spend", {
    cap: overSpend.map((entry) => entry.cap).join(","),
    ceilingRatio: SPEND_CEILING_RATIO,
    spentMicros: firstOverSpend?.spentMicros ?? 0,
    capMicros: firstOverSpend?.capMicros ?? 0,
  });

  judge("alert.backup.failure", metrics.backupReplication === "unavailable", "backup.failure", {
    replication: metrics.backupReplication,
  });

  judge("alert.backup.lag", metrics.backupLagSeconds > BACKUP_LAG_CEILING_SECONDS, "backup.lag", {
    ceilingSeconds: BACKUP_LAG_CEILING_SECONDS,
    lagSeconds: metrics.backupLagSeconds,
  });

  judge("alert.health", !metrics.health, "health", { healthy: metrics.health });

  judge("alert.disk", metrics.disk.usedRatio > DISK_CEILING_RATIO, "disk", {
    ceilingRatio: DISK_CEILING_RATIO,
    mount: metrics.disk.mount,
    usedRatio: metrics.disk.usedRatio,
  });

  judge("alert.process.unhandled", metrics.unhandledRejections > 0, "process.unhandled", {
    count: metrics.unhandledRejections,
  });

  judge("alert.catalog.worker", metrics.catalogWorkerCrashes > 0, "catalog.worker", {
    count: metrics.catalogWorkerCrashes,
  });

  const judgedEmployers = metrics.mailHealth.employers.filter(
    (entry) => entry.sent >= MAIL_REPLY_MIN_SENDS,
  );

  const breachingEmployers = judgedEmployers
    .filter((entry) => entry.replies / entry.sent < MAIL_REPLY_FLOOR)
    .toSorted((left, right) => left.replies / left.sent - right.replies / right.sent);

  const [worstEmployer] = breachingEmployers;

  judge("alert.mail.reply_rate", worstEmployer !== undefined, "mail.reply_rate", {
    companyId: worstEmployer?.key ?? null,
    employer: worstEmployer?.employer ?? null,
    employers: breachingEmployers.length,
    floor: MAIL_REPLY_FLOOR,
    minSends: MAIL_REPLY_MIN_SENDS,
    replies: worstEmployer?.replies ?? 0,
    sent: worstEmployer?.sent ?? 0,
  });

  const { domain } = metrics.mailHealth;
  const domainRate = domain.sent === 0 ? 1 : domain.replies / domain.sent;

  judge(
    "alert.mail.domain_reply_rate",
    domain.sent >= MAIL_DOMAIN_MIN_SENDS && domainRate < MAIL_REPLY_FLOOR,
    "mail.domain_reply_rate",
    {
      floor: MAIL_REPLY_FLOOR,
      minSends: MAIL_DOMAIN_MIN_SENDS,
      rate: domain.sent === 0 ? null : domainRate,
      replies: domain.replies,
      sent: domain.sent,
    },
  );

  return { results, raised };
}

export function drillAlertMetrics() {
  return {
    atsSuccess: [{ key: "greenhouse", attempts: 10, rate: 0.1 }],
    providerSuccess: [{ key: "browser_use", attempts: 10, rate: 0.1 }],
    codeChallenge: { attempted: 10, codeRate: 0.5, challengeRate: 0.5 },
    queueOldestAgeMs: 60 * 60_000,
    llmSpend: [{ cap: "global", spentMicros: 9_000_000, capMicros: 10_000_000 }],
    backupReplication: "unavailable",
    backupLagSeconds: 900,
    health: false,
    disk: { usedRatio: 0.95, mount: "/" },
    unhandledRejections: 3,
    catalogWorkerCrashes: 2,
    mailHealth: {
      domain: { replies: 0, sent: 24 },
      employers: [
        { employer: "Fixture Dynamics", key: "company-mail-drill", replies: 0, sent: 12 },
      ],
    },
  } satisfies AlertMetrics;
}

export function runAlertDrill(db: AppDatabase, clock: Clock) {
  return evaluateAlerts(db, clock, drillAlertMetrics());
}
