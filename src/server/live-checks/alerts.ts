import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { and, count, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { AlertKind } from "../platform/alerts.ts";
import type { LiveCheckResult } from "./types.ts";
import type { MailReplyCounts } from "../inbox/health.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { capMicros, llmDayBudget, llmSpendAlertRatio } from "../platform/llm/budget.ts";
import { llmSpendTodayMicros } from "../platform/llm/usage.ts";
import { unhandledRejectionCount } from "../platform/process-guard.ts";
import { catalogWorkerCrashCount } from "../catalog/worker-restarts.ts";
import { LLM_SCHEMA_REJECTION_TOPIC } from "../platform/llm/schema-rejections.ts";
import {
  applications,
  attempts,
  bgJobs,
  events,
  llmUsage,
  matches,
  messages,
} from "../platform/db/schema.ts";

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
export const BACKUP_LAG_CEILING_SECONDS = 300;
export const DISK_CEILING_RATIO = 0.8;
export const MIN_ATTEMPTS_TO_JUDGE = 5;
export const CONFIRMING_STUCK_CEILING_MS = 26 * 60 * 60_000;
export const COST_PER_SENT_CEILING_MICROS = 30_000;
export const UNSCORED_BACKLOG_CEILING = 2_000;
export const MAIL_FORWARDING_CEILING = 1;
export const LLM_SCHEMA_REJECTION_CEILING = 0.05;

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
  llmSpend: { cap: string; spentMicros: number; capMicros: number; subscribers: number }[];
  backupReplication: "unconfigured" | "unknown" | "unavailable" | "ok";
  backupLagSeconds: number;
  health: boolean;
  disk: { usedRatio: number; mount: string };
  unhandledRejections: number;
  catalogWorkerCrashes: number;
  mailHealth: MailReplyCounts;
  confirmingStuck: { applications: number; oldestAgeMs: number };
  costPerSent: { applications: number; costMicros: number | null };
  unscoredBacklog: number;
  mailForwarding: { bouncedOut: number; failedOut: number; failedAuthIn: number };
  llmSchemaRejection: { accepted: number; rejected: number; rate: number | null };
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

function readMailForwarding(db: AppDatabase, since: number) {
  const sinceDate = new Date(since);

  const outbound = db
    .select({
      bounced: sql<number>`coalesce(sum(case when ${messages.outStatus} = 'bounced' then 1 else 0 end), 0)`,
      failed: sql<number>`coalesce(sum(case when ${messages.outStatus} = 'failed' then 1 else 0 end), 0)`,
    })
    .from(messages)
    .where(and(eq(messages.direction, "out"), gte(messages.createdAt, sinceDate)))
    .get();

  const inboundFailed = db
    .select({ total: count() })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "in"),
        eq(messages.auth, "fail"),
        gte(messages.createdAt, sinceDate),
      ),
    )
    .get();

  return {
    bouncedOut: outbound?.bounced ?? 0,
    failedAuthIn: inboundFailed?.total ?? 0,
    failedOut: outbound?.failed ?? 0,
  };
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

  const globalBudget = llmDayBudget(db, clock.now());

  let health = true;

  try {
    db.run(sql`select 1`);
  } catch {
    health = false;
  }

  const mount = dirname(resolve(deps.databasePath));

  const fs = await statfs(mount).catch(() => null);

  const usedRatio = fs === null || fs.blocks === 0 ? 0 : 1 - fs.bavail / fs.blocks;

  const stuck = db
    .select({
      applications: count(),
      oldest: sql<number | null>`min(${applications.updatedAt})`,
    })
    .from(applications)
    .where(
      and(
        eq(applications.status, "confirming"),
        lte(applications.updatedAt, clock.now() - CONFIRMING_STUCK_CEILING_MS),
      ),
    )
    .get();

  const sentCost = db
    .select({
      applications: count(),
      costMicros: sql<number>`coalesce(sum(${applications.browserCostMicros} + ${applications.retryCostMicros} + ${applications.llmCostMicros}), 0)`,
    })
    .from(applications)
    .where(
      and(
        eq(applications.status, "sent"),
        isNotNull(applications.sentAt),
        gte(applications.sentAt, since),
        isNotNull(applications.costRecordedAt),
      ),
    )
    .get();

  const unscored = db.select({ total: count() }).from(matches).where(isNull(matches.score)).get();

  const rejectedRows = db
    .select({ total: count() })
    .from(events)
    .where(and(eq(events.topic, LLM_SCHEMA_REJECTION_TOPIC), gte(events.createdAt, since)))
    .get();

  const acceptedRows = db
    .select({ total: count() })
    .from(llmUsage)
    .where(gte(llmUsage.createdAt, since))
    .get();

  const rejected = rejectedRows?.total ?? 0;
  const accepted = acceptedRows?.total ?? 0;
  const mailForwarding = readMailForwarding(db, since);

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
        capMicros: globalBudget.budgetMicros,
        subscribers: globalBudget.subscribers,
      },
      {
        cap: "tagging",
        spentMicros: llmSpendTodayMicros(db, clock.now(), "tag_fallback", null),
        capMicros: capMicros(db, "llm.cap_tagging_day_usd"),
        subscribers: 0,
      },
    ],
    backupReplication: deps.backupReplication,
    backupLagSeconds: deps.backupLagSeconds,
    health,
    disk: { usedRatio, mount },
    unhandledRejections: unhandledRejectionCount(),
    catalogWorkerCrashes: catalogWorkerCrashCount(),
    mailHealth: readMailReplyCounts(db, clock),
    confirmingStuck: {
      applications: stuck?.applications ?? 0,
      oldestAgeMs:
        stuck?.oldest === null || stuck?.oldest === undefined
          ? 0
          : Math.max(0, clock.now() - stuck.oldest),
    },
    costPerSent: {
      applications: sentCost?.applications ?? 0,
      costMicros:
        sentCost === undefined || sentCost.applications === 0
          ? null
          : Math.round(sentCost.costMicros / sentCost.applications),
    },
    unscoredBacklog: unscored?.total ?? 0,
    mailForwarding,
    llmSchemaRejection: {
      accepted,
      rejected,
      rate: accepted + rejected === 0 ? null : rejected / (accepted + rejected),
    },
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
      failureRate: worstAts === undefined ? null : 1 - worstAts.rate,
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

  const spendCeilingRatio = llmSpendAlertRatio(db);

  const overSpend = metrics.llmSpend.filter(
    (entry) => entry.capMicros > 0 && entry.spentMicros >= entry.capMicros * spendCeilingRatio,
  );

  const [firstOverSpend] = overSpend;

  judge("alert.llm.spend", overSpend.length > 0, "llm.spend", {
    cap: overSpend.map((entry) => entry.cap).join(","),
    ceilingRatio: spendCeilingRatio,
    spentMicros: firstOverSpend?.spentMicros ?? 0,
    capMicros: firstOverSpend?.capMicros ?? 0,
    subscribers: firstOverSpend?.subscribers ?? 0,
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

  judge(
    "alert.confirming.stuck",
    metrics.confirmingStuck.applications > 0,
    "application.confirming_stuck",
    {
      applications: metrics.confirmingStuck.applications,
      ceilingMs: CONFIRMING_STUCK_CEILING_MS,
      oldestAgeMs: metrics.confirmingStuck.oldestAgeMs,
    },
  );

  judge(
    "alert.application.cost",
    metrics.costPerSent.applications >= MIN_ATTEMPTS_TO_JUDGE &&
      metrics.costPerSent.costMicros !== null &&
      metrics.costPerSent.costMicros > COST_PER_SENT_CEILING_MICROS,
    "application.cost",
    {
      applications: metrics.costPerSent.applications,
      ceilingMicros: COST_PER_SENT_CEILING_MICROS,
      costMicros: metrics.costPerSent.costMicros,
    },
  );

  judge(
    "alert.match.unscored",
    metrics.unscoredBacklog > UNSCORED_BACKLOG_CEILING,
    "match.unscored",
    { backlog: metrics.unscoredBacklog, ceiling: UNSCORED_BACKLOG_CEILING },
  );

  const forwardingProblems =
    metrics.mailForwarding.bouncedOut +
    metrics.mailForwarding.failedOut +
    metrics.mailForwarding.failedAuthIn;

  judge("alert.mail.forwarding", forwardingProblems >= MAIL_FORWARDING_CEILING, "mail.forwarding", {
    bouncedOut: metrics.mailForwarding.bouncedOut,
    ceiling: MAIL_FORWARDING_CEILING,
    failedAuthIn: metrics.mailForwarding.failedAuthIn,
    failedOut: metrics.mailForwarding.failedOut,
  });

  const schemaSamples = metrics.llmSchemaRejection.accepted + metrics.llmSchemaRejection.rejected;

  judge(
    "alert.llm.schema_rejection",
    schemaSamples >= MIN_ATTEMPTS_TO_JUDGE &&
      metrics.llmSchemaRejection.rate !== null &&
      metrics.llmSchemaRejection.rate > LLM_SCHEMA_REJECTION_CEILING,
    "llm.schema_rejection",
    {
      accepted: metrics.llmSchemaRejection.accepted,
      ceiling: LLM_SCHEMA_REJECTION_CEILING,
      rate: metrics.llmSchemaRejection.rate,
      rejected: metrics.llmSchemaRejection.rejected,
    },
  );

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
    llmSpend: [{ cap: "global", spentMicros: 9_000_000, capMicros: 10_000_000, subscribers: 0 }],
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
    confirmingStuck: { applications: 1, oldestAgeMs: 48 * 60 * 60_000 },
    costPerSent: { applications: 10, costMicros: 900_000 },
    unscoredBacklog: UNSCORED_BACKLOG_CEILING + 1,
    mailForwarding: { bouncedOut: 2, failedAuthIn: 1, failedOut: 1 },
    llmSchemaRejection: { accepted: 80, rate: 0.2, rejected: 20 },
  } satisfies AlertMetrics;
}

export function runAlertDrill(db: AppDatabase, clock: Clock) {
  return evaluateAlerts(db, clock, drillAlertMetrics());
}
