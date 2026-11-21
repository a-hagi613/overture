import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { raiseAlert } from "../platform/alerts.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { applications, attempts, companies, postings } from "../platform/db/schema.ts";
import { isKillSwitchEnabled, setKillSwitch } from "../platform/settings/index.ts";

export const DISPATCH_WATCH_JOB_KIND = "dispatch.watch";

const WATCH_INTERVAL_MS = 10 * 60_000;

export const ATS_SWITCH_WINDOW = 50;
export const PROVIDER_SWITCH_WINDOW = 20;
export const EMPLOYER_BLOCK_STREAK = 3;
export const ATS_SUCCESS_FLOOR = 0.6;
export const PROVIDER_SUCCESS_FLOOR = 0.5;

const BLOCKED_OUTCOMES = new Set<string>(["blocked", "captcha_blocked"]);

const SAMPLE_OUTCOMES = new Set<string>([
  "sent",
  "unconfirmed",
  "captcha_blocked",
  "code_timeout",
  "form_changed",
  "blocked",
  "upload_failed",
  "provider_error",
  "timeout",
  "crash",
]);

interface AttemptScope {
  ats: "greenhouse" | "lever" | "ashby" | "personio";
  provider: "browser_use" | "kernel" | "local";
  companyId: string;
  companyName: string;
  outcome: string;
}

function successRate(rows: readonly AttemptScope[]) {
  const sent = rows.filter((row) => row.outcome === "sent").length;

  return rows.length === 0 ? 1 : sent / rows.length;
}

function latestPerScope(rows: readonly AttemptScope[], keyOf: (row: AttemptScope) => string) {
  const grouped = new Map<string, AttemptScope[]>();

  for (const row of rows) {
    if (!SAMPLE_OUTCOMES.has(row.outcome)) {
      continue;
    }

    const key = keyOf(row);

    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return grouped;
}

export function evaluateKillSwitches(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  const rows = db
    .select({
      ats: postings.ats,
      companyId: applications.companyId,
      companyName: companies.name,
      outcome: attempts.outcome,
      provider: attempts.provider,
    })
    .from(attempts)
    .innerJoin(applications, eq(applications.id, attempts.applicationId))
    .innerJoin(postings, eq(postings.id, applications.postingId))
    .innerJoin(companies, eq(companies.id, applications.companyId))
    .where(and(isNotNull(attempts.outcome), isNotNull(attempts.endedAt)))
    .orderBy(desc(attempts.startedAt))
    .all()
    .flatMap((row) =>
      row.outcome === null
        ? []
        : [
            {
              ats: row.ats,
              companyId: row.companyId,
              companyName: row.companyName,
              outcome: row.outcome,
              provider: row.provider,
            } satisfies AttemptScope,
          ],
    );

  const tripped: { key: string; scope: "ats" | "employer" | "provider" }[] = [];

  function trip(
    scope: "ats" | "employer" | "provider",
    key: string,
    reason: string,
    detail: Record<string, string | number>,
  ) {
    if (isKillSwitchEnabled(db, scope, key)) {
      return;
    }

    setKillSwitch(db, clock, scope, key, true, reason, "auto");
    raiseAlert(db, clock, "dispatch.kill_switch", { key, scope, ...detail });
    tripped.push({ key, scope });
  }

  for (const [ats, group] of latestPerScope(rows, (row) => row.ats)) {
    const window = group.slice(0, ATS_SWITCH_WINDOW);

    if (window.length < ATS_SWITCH_WINDOW) {
      continue;
    }

    const rate = successRate(window);

    if (rate < ATS_SUCCESS_FLOOR) {
      trip("ats", ats, `success rate ${rate.toFixed(2)} over the last ${String(window.length)}`, {
        attempts: window.length,
        successRate: rate,
      });
    }
  }

  for (const [provider, group] of latestPerScope(rows, (row) => row.provider)) {
    const window = group.slice(0, PROVIDER_SWITCH_WINDOW);

    if (window.length < PROVIDER_SWITCH_WINDOW) {
      continue;
    }

    const rate = successRate(window);

    if (rate < PROVIDER_SUCCESS_FLOOR) {
      trip(
        "provider",
        provider,
        `success rate ${rate.toFixed(2)} over the last ${String(window.length)}`,
        { attempts: window.length, successRate: rate },
      );
    }
  }

  for (const [companyId, group] of latestPerScope(rows, (row) => row.companyId)) {
    const streak = group.slice(0, EMPLOYER_BLOCK_STREAK);

    if (
      streak.length === EMPLOYER_BLOCK_STREAK &&
      streak.every((row) => BLOCKED_OUTCOMES.has(row.outcome))
    ) {
      trip("employer", companyId, `blocked ${String(EMPLOYER_BLOCK_STREAK)} times in a row`, {
        attempts: streak.length,
        company: streak[0]?.companyName ?? "",
      });
    }
  }

  return { tripped };
}

export function ensureWatchQueued(db: AppDatabase, clock: Clock) {
  const job = enqueueJob(db, clock, DISPATCH_WATCH_JOB_KIND, "{}", {
    dedupeKey: DISPATCH_WATCH_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + WATCH_INTERVAL_MS,
  });

  return job.inserted;
}

export function runKillSwitchWatch(deps: { db: AppDatabase; clock: Clock }) {
  const report = evaluateKillSwitches(deps);

  ensureWatchQueued(deps.db, deps.clock);

  return report;
}
