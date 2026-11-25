import { and, count, countDistinct, eq, gt, inArray, isNotNull, ne, sql, sum } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { MetricsRecorder } from "./metrics.ts";

import { onlineUserIds } from "../../auth/presence.ts";
import {
  applications,
  attempts,
  ledger,
  llmUsage,
  matches,
  profiles,
  sessions,
  users,
} from "../db/schema.ts";
import { logError } from "../log.ts";
import { measureSqliteQuery } from "./sqlite-metrics.ts";
import { defaultMetrics } from "./metrics.ts";

export const PRODUCT_STATS_INTERVAL_MS = 60_000;

const APPLICATION_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "approved",
  "sending",
  "confirming",
  "sent",
  "failed",
  "skipped",
  "withdrawn",
] as const;

const CREDIT_ACCOUNTS = ["available", "reserved", "used", "expired"] as const;

function userCounts(db: AppDatabase, now: number) {
  const people = db
    .select({
      total: count(),
      verified: sql<number>`coalesce(sum(case when ${users.emailVerified} then 1 else 0 end), 0)`,
    })
    .from(users)
    .where(ne(users.role, "demo"))
    .get() ?? { total: 0, verified: 0 };

  const profileRow = db
    .select({
      onboarded: sql<number>`coalesce(sum(case when ${profiles.onboardedAt} is not null then 1 else 0 end), 0)`,
      running: sql<number>`coalesce(sum(case when ${profiles.running} then 1 else 0 end), 0)`,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(ne(users.role, "demo"))
    .get() ?? { onboarded: 0, running: 0 };

  const signedIn =
    db
      .select({ total: countDistinct(sessions.userId) })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(gt(sessions.expiresAt, new Date(now)), ne(users.role, "demo")))
      .get()?.total ?? 0;

  const seen = onlineUserIds(now);

  const online =
    seen.length === 0
      ? 0
      : (db
          .select({ total: count() })
          .from(users)
          .where(and(inArray(users.id, seen), ne(users.role, "demo")))
          .get()?.total ?? 0);

  return {
    online,
    onboarded: profileRow.onboarded,
    running: profileRow.running,
    signed_in: signedIn,
    total: people.total,
    verified: people.verified,
  };
}

function applicationCounts(db: AppDatabase) {
  const counts: Record<string, number> = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, 0]),
  );

  for (const row of db
    .select({ status: applications.status, total: count() })
    .from(applications)
    .groupBy(applications.status)
    .all()) {
    counts[row.status] = row.total;
  }

  return counts;
}

function matchQueueCounts(db: AppDatabase) {
  const pooled = db.select({ total: count() }).from(matches).get()?.total ?? 0;

  const scored =
    db.select({ total: count() }).from(matches).where(isNotNull(matches.score)).get()?.total ?? 0;

  return { pooled, scored };
}

function creditBalances(db: AppDatabase) {
  const balances: Record<string, number> = Object.fromEntries(
    CREDIT_ACCOUNTS.map((account) => [account, 0]),
  );

  const credited = db
    .select({ account: ledger.creditAccount, total: sum(ledger.amount) })
    .from(ledger)
    .groupBy(ledger.creditAccount)
    .all();

  const debited = db
    .select({ account: ledger.debitAccount, total: sum(ledger.amount) })
    .from(ledger)
    .groupBy(ledger.debitAccount)
    .all();

  for (const row of credited) {
    if (row.account in balances) {
      balances[row.account] = (balances[row.account] ?? 0) + Number(row.total ?? 0);
    }
  }

  for (const row of debited) {
    if (row.account in balances) {
      balances[row.account] = (balances[row.account] ?? 0) - Number(row.total ?? 0);
    }
  }

  return balances;
}

function spendUsd(db: AppDatabase) {
  const llm =
    db
      .select({ total: sum(llmUsage.costMicros) })
      .from(llmUsage)
      .get()?.total ?? 0;

  const browser =
    db
      .select({ total: sum(attempts.costMicros) })
      .from(attempts)
      .get()?.total ?? 0;

  return { browser: Number(browser) / 1_000_000, llm: Number(llm) / 1_000_000 };
}

/**
 * Reads people, applications, the match queue, credits and spend from the database into the
 * product gauges Grafana charts.
 * @param db The application database.
 * @param now The current instant.
 * @param recorder The metrics recorder (tests pass their own).
 */
export function sampleProductStats(
  db: AppDatabase,
  now: number,
  recorder: MetricsRecorder = defaultMetrics(),
) {
  measureSqliteQuery("app", "select", () => {
    recorder.setProductGauge("users", userCounts(db, now));
    recorder.setProductGauge("productApplications", applicationCounts(db));
    recorder.setProductGauge("matchQueue", matchQueueCounts(db));
    recorder.setProductGauge("credits", creditBalances(db));
    recorder.setProductGauge("spendUsd", spendUsd(db));
  });
}

/**
 * Samples the product gauges now and then every minute until stopped.
 * @param db The application database.
 * @param clock The clock samples are dated with.
 * @returns A function that stops the sampler.
 */
export function startProductStatsSampler(db: AppDatabase, clock: Clock) {
  const sample = () => {
    try {
      sampleProductStats(db, clock.now());
    } catch (error) {
      logError("metrics.product_stats", error);
    }
  };

  sample();

  const timer = setInterval(sample, PRODUCT_STATS_INTERVAL_MS);

  timer.unref();

  return () => {
    clearInterval(timer);
  };
}
