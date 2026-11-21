import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { BackupMonitor } from "../platform/ports/backup.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { BrowserProviderRegistry } from "../dispatch/browser/provider.ts";
import type { LiveCheckGroup, LiveCheckResult } from "./types.ts";

import { enqueueJob } from "../platform/jobs/queue.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { nextUtcMidnight } from "../platform/llm/caps.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { collectAlertMetrics, evaluateAlerts } from "./alerts.ts";
import { runFormsCheck } from "./forms.ts";
import { runLlmCheck } from "./llm.ts";
import { resolveDueLiveCheckMail, resolveLiveCheckMail, sendLiveCheckMail } from "./mail.ts";
import { runStorageCheck } from "./r2.ts";
import { latestLiveCheckAt, recordLiveCheckResult } from "./store.ts";
import { LIVE_CHECK_GROUPS, failedResult } from "./types.ts";

export const LIVE_CHECK_JOB_KIND = "live.check";

export { LIVE_CHECK_MAIL_JOB_KIND } from "./mail.ts";

const FIRST_RUN_DELAY_MS = 5 * 60_000;
const DAILY_DEDUPE_KEY = "live.check.daily";

const payloadSchema = z.object({
  groups: z.array(z.enum(LIVE_CHECK_GROUPS)).optional(),
});

const mailPayloadSchema = z.object({ mailId: z.string().min(1) });

export interface LiveCheckDeps {
  db: AppDatabase;
  clock: Clock;
  objects: ObjectStore;
  llm: LlmPort;
  mail: MailSender;
  mailAddress: string;
  providers: BrowserProviderRegistry | null;
  backups: BackupMonitor;
  databasePath: string;
}

async function runGroup(
  deps: LiveCheckDeps,
  group: LiveCheckGroup,
  run: () => Promise<LiveCheckResult[]>,
) {
  try {
    return await run();
  } catch (error) {
    return [
      failedResult(group, deps.clock.now(), error instanceof Error ? error.message : String(error)),
    ];
  }
}

function backupLag(status: ReturnType<BackupMonitor["status"]>) {
  return "lagSeconds" in status ? status.lagSeconds : 0;
}

export async function runLiveChecks(deps: LiveCheckDeps, payload: string) {
  const parsed = payloadSchema.parse(JSON.parse(payload));
  const groups = parsed.groups ?? [...LIVE_CHECK_GROUPS];
  const runId = crypto.randomUUID();
  const results: LiveCheckResult[] = [];
  const mailDeps = { db: deps.db, clock: deps.clock, mail: deps.mail, address: deps.mailAddress };

  const runGroupAt: (index: number) => Promise<void> = async (index) => {
    const group = groups[index];

    if (group === undefined) {
      return;
    }

    if (group === "forms") {
      results.push(
        ...(await runGroup(
          deps,
          group,
          async () =>
            await runFormsCheck({
              db: deps.db,
              clock: deps.clock,
              objects: deps.objects,
              providers: deps.providers,
            }),
        )),
      );
    }

    if (group === "llm") {
      results.push(
        ...(await runGroup(
          deps,
          group,
          async () =>
            await runLlmCheck({ clock: deps.clock, llm: deps.llm, objects: deps.objects }),
        )),
      );
    }

    if (group === "r2") {
      results.push(
        ...(await runGroup(deps, group, async () => [
          await runStorageCheck({ clock: deps.clock, objects: deps.objects }),
        ])),
      );
    }

    if (group === "mail") {
      results.push(
        ...(await runGroup(deps, group, async () => {
          const overdue = resolveDueLiveCheckMail(mailDeps);
          const sent = await sendLiveCheckMail(mailDeps);

          return [...overdue, sent.result];
        })),
      );
    }

    if (group === "alerts") {
      results.push(
        ...(await runGroup(deps, group, async () => {
          const status = deps.backups.status();

          const metrics = await collectAlertMetrics({
            backupLagSeconds: backupLag(status),
            backupReplication: status.replication,
            clock: deps.clock,
            databasePath: deps.databasePath,
            db: deps.db,
          });

          return evaluateAlerts(deps.db, deps.clock, metrics).results;
        })),
      );
    }

    await runGroupAt(index + 1);
  };

  await runGroupAt(0);

  for (const result of results) {
    recordLiveCheckResult(deps.db, deps.clock, runId, result);

    if (!result.ok && !result.check.startsWith("alert.")) {
      raiseAlert(deps.db, deps.clock, "live.check.failure", {
        check: result.check,
        error: result.detail.error ?? "failed",
        runId,
      });
    }
  }

  return { results, runId };
}

export async function runLiveCheckMailJob(deps: LiveCheckDeps, payload: string) {
  const { mailId } = mailPayloadSchema.parse(JSON.parse(payload));

  const result = await Promise.resolve(
    resolveLiveCheckMail(
      { db: deps.db, clock: deps.clock, mail: deps.mail, address: deps.mailAddress },
      mailId,
    ),
  );

  if (result === null) {
    return null;
  }

  const runId = crypto.randomUUID();

  recordLiveCheckResult(deps.db, deps.clock, runId, result);

  if (!result.ok) {
    raiseAlert(deps.db, deps.clock, "live.check.failure", {
      check: result.check,
      error: result.detail.error ?? "failed",
      runId,
    });
  }

  return result;
}

export function scheduleDailyLiveCheck(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, LIVE_CHECK_JOB_KIND, "{}", {
    dedupeKey: DAILY_DEDUPE_KEY,
    maxAttempts: 1,
    runAt: nextUtcMidnight(clock.now()),
  });
}

export function ensureLiveCheckQueued(db: AppDatabase, clock: Clock) {
  const active = db
    .select({ id: bgJobs.id })
    .from(bgJobs)
    .where(and(eq(bgJobs.kind, LIVE_CHECK_JOB_KIND), inArray(bgJobs.status, ["queued", "running"])))
    .limit(1)
    .get();

  if (active !== undefined) {
    return false;
  }

  const firstRun = latestLiveCheckAt(db) === null;

  const job = enqueueJob(db, clock, LIVE_CHECK_JOB_KIND, "{}", {
    dedupeKey: DAILY_DEDUPE_KEY,
    maxAttempts: 1,
    runAt: firstRun ? clock.now() + FIRST_RUN_DELAY_MS : nextUtcMidnight(clock.now()),
  });

  return job.inserted;
}

export function enqueueLiveCheckNow(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, LIVE_CHECK_JOB_KIND, "{}", { maxAttempts: 1 });
}
