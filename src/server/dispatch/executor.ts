import { and, desc, eq, sql } from "drizzle-orm";
import { chromium } from "playwright-core";
import { z } from "zod";

import type { Page } from "playwright-core";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ResumeService } from "../profile/resume.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { BrowserProviderRegistry, BrowserUsage, RemoteBrowser } from "./browser/provider.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";
import type { Outcomes } from "./outcomes.ts";

import { applications, attempts, postings, profiles } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { releaseForApplication, reserveForApplication } from "../billing/ledger.ts";
import { getSetting, isKillSwitchEnabled } from "../platform/settings/index.ts";
import { runGreenhouseAttempt } from "./ats/greenhouse.ts";
import {
  CODE_WAIT_TIMEOUT_MS,
  createCodeWait,
  markCodeConsumed,
  waitForCode,
} from "../inbox/waits.ts";
import { createNotification } from "../notify/notifications.ts";
import { copy } from "../../shared/copy.ts";
import { recordApplicationEvent } from "./outcomes.ts";

export const APPLICATION_SEND_JOB_KIND = "application.send";

export const DISPATCH_RECOVER_JOB_KIND = "dispatch.recover";

const ATTEMPT_LEASE_MS = 15 * 60_000;
const SESSION_TIMEOUT_MINUTES = 15;
const RECOVER_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 6 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const sendPayloadSchema = z.object({ applicationId: z.string().min(1) });

export interface DispatcherDeps {
  db: AppDatabase;
  clock: Clock;
  providers: BrowserProviderRegistry;
  hardTimeoutMs: number;
  preparation: PreparationService;
  resumes: ResumeService;
  personal: PersonalCrypto;
  mailboxes: ReturnType<typeof createMailboxService>;
  outcomes: Outcomes;
  proxyCountry: string;
  signal?: AbortSignal;
}

type AttemptRow = typeof attempts.$inferSelect;

const zeroUsage: BrowserUsage = { browserMs: 0, costMicros: 0, proxyBytes: 0 };

async function withDeadline<T extends { outcome: string }>(run: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<{ outcome: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ outcome: "timeout" });
    }, timeoutMs);
  });

  try {
    return await Promise.race([run, deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

const ATTEMPT_OUTCOMES = [
  ["blocked", "blocked"],
  ["captcha_blocked", "captcha_blocked"],
  ["code_timeout", "code_timeout"],
  ["fill_failed", "form_changed"],
  ["form_missing", "form_changed"],
  ["sent", "sent"],
  ["timeout", "timeout"],
  ["unconfirmed", "unconfirmed"],
  ["upload_failed", "upload_failed"],
  ["identity_mismatch", "identity_mismatch"],
] as const satisfies readonly (readonly [string, AttemptRow["outcome"]])[];

function outcomeOf(outcome: string) {
  return ATTEMPT_OUTCOMES.find(([name]) => name === outcome)?.[1] ?? "provider_error";
}

function settingNumber(db: AppDatabase, key: string, fallback: number) {
  const parsed = Number(getSetting(db, key));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function minutesOf(value: string) {
  const [hours, mins] = value.split(":").map(Number);

  return (hours ?? 0) * 60 + (mins ?? 0);
}

function sendWindow(db: AppDatabase) {
  const raw = getSetting(db, "limits.send_window");

  try {
    const parsed = z.object({ start: z.string(), end: z.string() }).parse(JSON.parse(raw ?? "{}"));

    return { end: minutesOf(parsed.end), start: minutesOf(parsed.start) };
  } catch {
    return { end: 20 * 60, start: 8 * 60 };
  }
}

function offsetOf(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(at));

  const values = new Map(parts.map((part) => [part.type, part.value]));

  const asUtc = Date.UTC(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day")),
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
  );

  return asUtc - Math.floor(at / 1000) * 1000;
}

function nextSendSlot(db: AppDatabase, userId: string, earliest: number) {
  const timezone =
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get()?.timezone ?? "UTC";

  let offset: number;

  try {
    offset = offsetOf(earliest, timezone);
  } catch {
    offset = 0;
  }

  const window = sendWindow(db);
  const local = earliest + offset;
  const minuteOfDay = (((local % DAY_MS) + DAY_MS) % DAY_MS) / 60_000;

  if (minuteOfDay >= window.start && minuteOfDay < window.end) {
    return earliest;
  }

  const dayStart = local - (((local % DAY_MS) + DAY_MS) % DAY_MS);

  const target =
    minuteOfDay < window.start
      ? dayStart + window.start * 60_000
      : dayStart + DAY_MS + window.start * 60_000;

  return target - offset;
}

export function createDispatcher(deps: DispatcherDeps) {
  const {
    db,
    clock,
    providers,
    hardTimeoutMs,
    preparation,
    resumes,
    personal,
    mailboxes,
    outcomes,
    proxyCountry,
    signal,
  } = deps;

  const activeAttempts = new Set<string>();

  function updateAttempt(attemptId: string, values: Partial<AttemptRow>) {
    db.update(attempts).set(values).where(eq(attempts.id, attemptId)).run();
  }

  function latestAttempt(applicationId: string) {
    return db
      .select()
      .from(attempts)
      .where(eq(attempts.applicationId, applicationId))
      .orderBy(desc(attempts.startedAt))
      .limit(1)
      .get();
  }

  function releaseAttempt(applicationId: string, userId: string, attemptId: string) {
    releaseForApplication(db, clock, {
      applicationId,
      idempotencyKey: `release:${attemptId}`,
      userId,
    });
  }

  function scheduleRetry(applicationId: string, userId: string, at: number) {
    const slot = nextSendSlot(db, userId, at + RETRY_DELAY_MS);

    db.update(applications)
      .set({ scheduledFor: slot, status: "ready", statusReason: null, updatedAt: clock.now() })
      .where(eq(applications.id, applicationId))
      .run();

    recordApplicationEvent(db, clock, {
      applicationId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "ready",
      source: "system",
    });

    return slot;
  }

  function requestInterrupt(applicationId: string, userId: string, at: number) {
    const slot = nextSendSlot(db, userId, at);

    db.update(applications)
      .set({
        attempts: sql`max(${applications.attempts} - 1, 0)`,
        scheduledFor: slot,
        status: "ready",
        statusReason: null,
        updatedAt: clock.now(),
      })
      .where(eq(applications.id, applicationId))
      .run();

    recordApplicationEvent(db, clock, {
      applicationId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "ready",
      source: "system",
    });

    return slot;
  }

  function finishBeforeSubmit(input: {
    applicationId: string;
    userId: string;
    attemptId: string;
    attempts: number;
    outcome: AttemptRow["outcome"];
    at: number;
  }) {
    const { applicationId, userId, attemptId, attempts: used, outcome, at } = input;

    releaseAttempt(applicationId, userId, attemptId);

    const maxAttempts = settingNumber(db, "limits.max_attempts", 2);

    if (used < maxAttempts) {
      scheduleRetry(applicationId, userId, at);

      return "retry" as const;
    }

    db.update(applications)
      .set({ stage: null, status: "failed", statusReason: outcome, updatedAt: at })
      .where(eq(applications.id, applicationId))
      .run();

    recordApplicationEvent(db, clock, {
      applicationId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "failed",
      source: "system",
    });
    recordApplicationEvent(db, clock, {
      applicationId,
      userId,
      kind: "stage",
      fromValue: "queued",
      toValue: null,
      source: "system",
    });

    return "failed" as const;
  }

  function switchedOffAtSend(applicationId: string, providerId: string) {
    const row = db
      .select({ ats: postings.ats, companyId: applications.companyId })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined) {
      return true;
    }

    return (
      isKillSwitchEnabled(db, "global", "all") ||
      isKillSwitchEnabled(db, "ats", row.ats) ||
      isKillSwitchEnabled(db, "employer", row.companyId) ||
      isKillSwitchEnabled(db, "provider", providerId)
    );
  }

  async function runAttempt(applicationId: string) {
    const provider = providers.pick();

    if (switchedOffAtSend(applicationId, provider.id)) {
      return false;
    }

    const at = clock.now();

    const claimed = db
      .update(applications)
      .set({
        attempts: sql`${applications.attempts} + 1`,
        status: "sending",
        statusReason: null,
        updatedAt: at,
      })
      .where(and(eq(applications.id, applicationId), eq(applications.status, "ready")))
      .returning({ attempts: applications.attempts, userId: applications.userId })
      .all()
      .at(0);

    if (claimed === undefined) {
      return false;
    }

    const attemptId = crypto.randomUUID();

    const reserved = reserveForApplication(db, clock, {
      applicationId,
      idempotencyKey: `reserve:${attemptId}`,
      userId: claimed.userId,
    });

    if (!reserved.reserved) {
      db.update(applications)
        .set({
          attempts: sql`max(${applications.attempts} - 1, 0)`,
          status: "ready",
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, applicationId))
        .run();

      return false;
    }

    db.insert(attempts)
      .values({
        applicationId,
        browserMs: null,
        captchaSeen: false,
        codeUsed: false,
        costMicros: null,
        endedAt: null,
        id: attemptId,
        leaseUntil: at + ATTEMPT_LEASE_MS,
        n: claimed.attempts,
        outcome: null,
        provider: provider.id,
        providerSessionId: null,
        proxyBytes: null,
        startedAt: at,
        submitClickedAt: null,
        submitResponseStatus: null,
        userId: claimed.userId,
      })
      .run();

    activeAttempts.add(attemptId);

    let browser: RemoteBrowser | null = null;
    let usage = zeroUsage;
    let outcome: AttemptRow["outcome"] = "provider_error";
    let shutdownActive = false;

    const isShuttingDown = () => shutdownActive;

    const closeOnAbort = () => {
      shutdownActive = true;

      if (browser === null) {
        return;
      }

      const target = browser;

      void (async () => {
        try {
          await target.close();
        } catch {
          usage = zeroUsage;
        }

        await provider.stop(target.sessionId).catch(() => undefined);
      })();
    };

    signal?.addEventListener("abort", closeOnAbort, { once: true });

    try {
      const plan = await preparation.sendPlanFor(applicationId);

      if (plan === null) {
        throw new Error("the send plan could not be built");
      }

      const resumeFile = plan.resume === null ? null : await resumes.currentFileBytes(plan.userId);

      if (resumeFile === null) {
        throw new Error("the resume file could not be read");
      }

      if (isShuttingDown()) {
        throw new Error("shutting down before the browser opened");
      }

      browser = await provider.open({
        attemptId,
        country: proxyCountry,
        profileId: await provider.ensureProfile(plan.userId, proxyCountry),
        timeoutMinutes: SESSION_TIMEOUT_MINUTES,
      });

      updateAttempt(attemptId, { providerSessionId: browser.sessionId });

      if (isShuttingDown()) {
        throw new Error("shutting down after the browser opened");
      }

      const cdp = await chromium.connectOverCDP(browser.cdpUrl);
      const context = cdp.contexts()[0] ?? (await cdp.newContext());
      const page: Page = context.pages()[0] ?? (await context.newPage());

      if (isShuttingDown()) {
        throw new Error("shutting down before the form loaded");
      }

      await context.route("**/*", async (route) => {
        const type = route.request().resourceType();

        if (type === "image" || type === "font" || type === "media") {
          await route.abort().catch(() => undefined);

          return;
        }

        await route.fallback();
      });

      const runPromise = runGreenhouseAttempt(
        page,
        {
          fields: plan.fields,
          identity: {
            boardToken: plan.boardToken,
            companyName: plan.companyName,
            jobId: plan.atsJobId,
            url: plan.postingUrl,
          },
          resume: {
            bytes: resumeFile.bytes,
            fieldName: null,
            filename: resumeFile.filename,
          },
        },
        {
          onCodeTyped: () => {
            updateAttempt(attemptId, { codeUsed: true });
          },
          onResponse: (status) => {
            if (status !== null && status >= 400 && status < 500) {
              updateAttempt(attemptId, { submitClickedAt: null, submitResponseStatus: status });
            } else {
              updateAttempt(attemptId, { submitResponseStatus: status });
            }
          },
          onWillSubmit: () => {
            updateAttempt(attemptId, { submitClickedAt: clock.now() });
          },
          requestCode: async () => {
            const mailbox = await mailboxes.ensureFor(claimed.userId);

            const wait = createCodeWait(db, clock, {
              attemptId,
              mailboxId: mailbox.id,
              userId: claimed.userId,
            });

            if (wait === undefined) {
              return null;
            }

            const resolved = await waitForCode(
              { db, clock, personal },
              {
                onAskToPaste: () => {
                  createNotification(db, clock, {
                    body: copy.notifications.codeWait.body(CODE_WAIT_TIMEOUT_MS / 60_000),
                    kind: copy.notifications.codeWait.kind,
                    title: copy.notifications.codeWait.title(plan.companyName),
                    url: copy.notifications.codeWait.url,
                    userId: claimed.userId,
                  });
                },
                waitId: wait.id,
              },
            );

            if (resolved === null) {
              return null;
            }

            if (resolved.messageId !== null) {
              markCodeConsumed(db, clock, resolved.messageId);
            }

            return resolved.code;
          },
        },
      );

      void Promise.allSettled([runPromise]);

      const run = await withDeadline(runPromise, hardTimeoutMs);

      outcome = outcomeOf(run.outcome);

      await cdp.close().catch(() => undefined);

      usage = await browser.close();
      await provider.stop(browser.sessionId).catch(() => undefined);
      browser = null;

      if (run.outcome === "sent") {
        const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();

        if (attempt !== undefined) {
          await outcomes.recordSent({
            applicationId,
            attempt,
            confirmedBy: "page",
            costMicros: usage.costMicros,
            markAttemptSent: true,
            plan,
          });
        }
      } else if (run.outcome === "identity_mismatch") {
        const reason = run.identityReason ?? "unreadable";

        releaseAttempt(applicationId, claimed.userId, attemptId);

        db.update(applications)
          .set({
            status: "skipped",
            statusReason: `posting_identity:${reason}`,
            updatedAt: clock.now(),
          })
          .where(eq(applications.id, applicationId))
          .run();

        recordApplicationEvent(db, clock, {
          applicationId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "skipped",
          source: "system",
        });

        updateAttempt(attemptId, {
          endedAt: clock.now(),
          errorCode: reason,
          outcome: "identity_mismatch",
        });
      } else {
        const current = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
        const submitted = current?.submitClickedAt ?? null;

        if (run.outcome === "unconfirmed" || submitted !== null) {
          db.update(applications)
            .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
            .where(eq(applications.id, applicationId))
            .run();

          updateAttempt(attemptId, { endedAt: clock.now(), outcome: outcomeOf(run.outcome) });
        } else {
          finishBeforeSubmit({
            applicationId,
            attempts: claimed.attempts,
            at: clock.now(),
            attemptId,
            outcome: outcomeOf(run.outcome),
            userId: claimed.userId,
          });

          updateAttempt(attemptId, {
            captchaSeen: run.outcome === "captcha_blocked",
            endedAt: clock.now(),
            outcome: outcomeOf(run.outcome),
          });
        }
      }
    } catch {
      const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
      const submitted = attempt?.submitClickedAt ?? null;

      if (submitted !== null) {
        db.update(applications)
          .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
          .where(eq(applications.id, applicationId))
          .run();

        updateAttempt(attemptId, {
          endedAt: clock.now(),
          outcome: isShuttingDown() ? "unconfirmed" : "crash",
        });
      } else if (isShuttingDown()) {
        requestInterrupt(applicationId, claimed.userId, clock.now());
        updateAttempt(attemptId, { endedAt: clock.now(), outcome: "interrupted" });
      } else {
        finishBeforeSubmit({
          applicationId,
          attempts: claimed.attempts,
          at: clock.now(),
          attemptId,
          outcome,
          userId: claimed.userId,
        });

        updateAttempt(attemptId, { endedAt: clock.now(), outcome });
      }
    } finally {
      signal?.removeEventListener("abort", closeOnAbort);
      activeAttempts.delete(attemptId);

      if (browser !== null) {
        try {
          usage = await browser.close();
        } catch {
          usage = zeroUsage;
        }

        await provider.stop(browser.sessionId).catch(() => undefined);
      }

      const finished = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();

      updateAttempt(attemptId, {
        browserMs: usage.browserMs,
        costMicros: usage.costMicros,
        endedAt: finished?.endedAt ?? clock.now(),
        outcome: finished?.outcome ?? outcome,
        proxyBytes: usage.proxyBytes,
      });
    }

    return true;
  }

  async function recover() {
    const confirming = await outcomes.expireConfirming();
    const sending = db.select().from(applications).where(eq(applications.status, "sending")).all();

    let confirmingCount = confirming.confirmed;
    const { expired } = confirming;
    let released = 0;

    for (const application of sending) {
      const attempt = latestAttempt(application.id);

      if (attempt !== undefined && activeAttempts.has(attempt.id)) {
        continue;
      }

      if (attempt !== undefined && attempt.submitClickedAt !== null) {
        db.update(applications)
          .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
          .where(eq(applications.id, application.id))
          .run();

        updateAttempt(attempt.id, {
          browserMs: attempt.browserMs ?? Math.max(0, clock.now() - attempt.startedAt),
          costMicros: attempt.costMicros ?? 0,
          endedAt: attempt.endedAt ?? clock.now(),
          outcome: attempt.outcome ?? "crash",
          proxyBytes: attempt.proxyBytes ?? 0,
        });

        confirmingCount += 1;

        continue;
      }

      if (attempt !== undefined) {
        releaseAttempt(application.id, application.userId, attempt.id);

        updateAttempt(attempt.id, {
          browserMs: attempt.browserMs ?? Math.max(0, clock.now() - attempt.startedAt),
          costMicros: attempt.costMicros ?? 0,
          endedAt: attempt.endedAt ?? clock.now(),
          outcome: "interrupted",
          proxyBytes: attempt.proxyBytes ?? 0,
        });
      }

      requestInterrupt(application.id, application.userId, clock.now());

      released += 1;
    }

    const open = (
      await Promise.all(
        providers.all().map(async (provider) => {
          const sessions = await provider.listOpen().catch(() => []);

          return sessions.map((session) => ({ provider, session }));
        }),
      )
    ).flat();

    const stopped = await Promise.all(
      open.map(async ({ provider, session }) => {
        if (activeAttempts.has(session.attemptId ?? "")) {
          return 0;
        }

        const attempt =
          session.attemptId === null
            ? undefined
            : db.select().from(attempts).where(eq(attempts.id, session.attemptId)).get();

        const application =
          attempt === undefined
            ? undefined
            : db
                .select()
                .from(applications)
                .where(eq(applications.id, attempt.applicationId))
                .get();

        if (attempt?.endedAt === null && application?.status === "sending") {
          return 0;
        }

        await provider.stop(session.sessionId).catch(() => undefined);

        return 1;
      }),
    );

    return {
      confirming: confirmingCount,
      expired,
      released,
      sessionsStopped: stopped.filter((count) => count === 1).length,
    };
  }

  function enqueueSend(applicationId: string, runAt?: number) {
    const job = enqueueJob(
      db,
      clock,
      APPLICATION_SEND_JOB_KIND,
      JSON.stringify({ applicationId }),
      {
        dedupeKey: `${APPLICATION_SEND_JOB_KIND}:${applicationId}`,
        maxAttempts: 1,
        ...(runAt !== undefined && { runAt }),
      },
    );

    return job.id;
  }

  function ensureRecoveryQueued() {
    const job = enqueueJob(db, clock, DISPATCH_RECOVER_JOB_KIND, "{}", {
      dedupeKey: DISPATCH_RECOVER_JOB_KIND,
      maxAttempts: 1,
      runAt: clock.now() + RECOVER_INTERVAL_MS,
    });

    return job.inserted;
  }

  return {
    ensureRecoveryQueued,
    enqueueSend,
    recover,
    runAttempt,
    sendNow: async (applicationId: string) => {
      const parsed = sendPayloadSchema.parse({ applicationId });

      return runAttempt(parsed.applicationId);
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
