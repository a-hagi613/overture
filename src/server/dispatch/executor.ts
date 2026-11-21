import { createHash } from "node:crypto";

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { chromium } from "playwright-core";
import { z } from "zod";

import type { Page } from "playwright-core";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ResumeService } from "../profile/resume.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { LiveFormProblem } from "./forms/engine.ts";
import type {
  BrowserProviderRegistry,
  BrowserUsage,
  ProviderUnavailableReason,
  RemoteBrowser,
} from "./browser/provider.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";
import type { Outcomes } from "./outcomes.ts";

import { applications, attempts, postings, profiles } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { releaseForApplication, reserveForApplication } from "../billing/ledger.ts";
import { getSetting, isKillSwitchEnabled, setKillSwitch } from "../platform/settings/index.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { enqueueApplicationPrepare } from "../pipeline/prepare-jobs.ts";
import { stageForStatus } from "../pipeline/stage.ts";
import { ProviderUnavailableError } from "./browser/provider.ts";
import { applySendProxyTrim } from "./browser/proxy-trim.ts";
import { runAshbyAttempt } from "./ats/ashby.ts";
import type { AshbyRun } from "./ats/ashby.ts";
import { runGreenhouseAttempt } from "./ats/greenhouse.ts";
import type { GreenhouseRun } from "./ats/greenhouse.ts";
import { runLeverAttempt } from "./ats/lever.ts";
import type { LeverRun } from "./ats/lever.ts";
import {
  CODE_WAIT_TIMEOUT_MS,
  createCodeWait,
  markCodeConsumed,
  waitForCode,
} from "../inbox/waits.ts";
import { createNotification } from "../notify/notifications.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { copy } from "../../shared/copy.ts";
import { recordApplicationEvent } from "./outcomes.ts";
import { acquireBrowserSession } from "./browser/session-slots.ts";
import { nextSendSlot as nextSlotInWindow, parseSendWindow } from "./planning.ts";
import { openApprovedPlan } from "../pipeline/approved-plan.ts";

export const APPLICATION_SEND_JOB_KIND = "application.send";

export const DISPATCH_RECOVER_JOB_KIND = "dispatch.recover";

const ATTEMPT_LEASE_MS = 15 * 60_000;
const SESSION_TIMEOUT_MINUTES = 15;
const RECOVER_INTERVAL_MS = 60_000;
const RETRY_DELAY_MS = 6 * 60 * 60_000;
const USAGE_BACKFILL_WINDOW_MS = 24 * 60 * 60_000;

const PROVIDER_PAUSE_REASONS = {
  forbidden: "the provider answered 403 (forbidden)",
  no_credit: "the provider answered 402 (no credit)",
} satisfies Record<ProviderUnavailableReason, string>;

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

type AttemptRun = GreenhouseRun | LeverRun | AshbyRun;

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
  ["form_changed", "form_changed"],
  ["form_missing", "form_changed"],
  ["flagged_spam", "blocked"],
  ["needs_review", "needs_review"],
  ["sent", "sent"],
  ["timeout", "timeout"],
  ["unconfirmed", "unconfirmed"],
  ["upload_failed", "upload_failed"],
  ["identity_mismatch", "identity_mismatch"],
] as const satisfies readonly (readonly [string, AttemptRow["outcome"]])[];

function outcomeOf(outcome: string) {
  return ATTEMPT_OUTCOMES.find(([name]) => name === outcome)?.[1] ?? "provider_error";
}

function changeNotes(problems: readonly LiveFormProblem[]) {
  const notes = new Set<string>();

  for (const problem of problems) {
    switch (problem.kind) {
      case "unexpected_required": {
        notes.add("A new required question");
        break;
      }

      case "field_missing": {
        notes.add("A field was removed");
        break;
      }

      case "option_missing":
      case "option_not_selected": {
        notes.add(`The options for ${problem.label} changed`);
        break;
      }

      case "file_mismatch": {
        notes.add("Your resume changed");
        break;
      }

      default: {
        notes.add(`The answer for ${problem.label} changed`);
      }
    }
  }

  return [...notes];
}

function settingNumber(db: AppDatabase, key: string, fallback: number) {
  const parsed = Number(getSetting(db, key));

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sendWindow(db: AppDatabase) {
  return parseSendWindow(getSetting(db, "limits.send_window"));
}

function nextSendSlot(db: AppDatabase, userId: string, earliest: number) {
  const timezone =
    db
      .select({ timezone: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .get()?.timezone ?? "UTC";

  return nextSlotInWindow(earliest, timezone, sendWindow(db));
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

  function announce(applicationId: string, userId: string, status: string) {
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId, status }),
      userId,
    );
    publishEvent(db, clock, "home.updated", JSON.stringify({ applicationId }), userId);
  }

  function pauseProvider(providerId: string, reason: ProviderUnavailableReason) {
    if (isKillSwitchEnabled(db, "provider", providerId)) {
      return;
    }

    const detail = PROVIDER_PAUSE_REASONS[reason];

    setKillSwitch(db, clock, "provider", providerId, true, detail, "auto");
    raiseAlert(db, clock, "dispatch.kill_switch", {
      key: providerId,
      reason: detail,
      scope: "provider",
    });
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
      .set({
        scheduledFor: slot,
        stage: stageForStatus("approved"),
        status: "approved",
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
      toValue: "approved",
      source: "system",
    });

    announce(applicationId, userId, "approved");

    return slot;
  }

  function requestInterrupt(applicationId: string, userId: string, at: number) {
    const slot = nextSendSlot(db, userId, at);

    db.update(applications)
      .set({
        attempts: sql`max(${applications.attempts} - 1, 0)`,
        scheduledFor: slot,
        stage: stageForStatus("approved"),
        status: "approved",
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
      toValue: "approved",
      source: "system",
    });

    announce(applicationId, userId, "approved");

    return slot;
  }

  function finishBeforeSubmit(input: {
    applicationId: string;
    userId: string;
    attemptId: string;
    attempts: number;
    changes?: readonly string[];
    outcome: AttemptRow["outcome"];
    at: number;
  }) {
    const { applicationId, userId, attemptId, attempts: used, outcome, at } = input;

    releaseAttempt(applicationId, userId, attemptId);

    const maxAttempts = settingNumber(db, "limits.max_attempts", 2);

    if (used < maxAttempts && outcome === "form_changed") {
      const changes =
        input.changes === undefined || input.changes.length === 0
          ? ["The form changed"]
          : [...input.changes];

      db.update(applications)
        .set({
          approvedAt: null,
          approvedPlanEnc: null,
          approvedPlanSha256: null,
          changes: JSON.stringify(changes),
          scheduledFor: null,
          stage: stageForStatus("ready"),
          status: "ready",
          statusReason: null,
          updatedAt: at,
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

      enqueueApplicationPrepare(db, clock, applicationId);
      announce(applicationId, userId, "ready");

      return "retry" as const;
    }

    if (used < maxAttempts) {
      scheduleRetry(applicationId, userId, at);

      return "retry" as const;
    }

    db.update(applications)
      .set({
        approvedAt: null,
        approvedPlanEnc: null,
        approvedPlanSha256: null,
        scheduledFor: null,
        stage: null,
        status: "failed",
        statusReason: outcome,
        updatedAt: at,
      })
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

    announce(applicationId, userId, "failed");

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
      .where(and(eq(applications.id, applicationId), eq(applications.status, "approved")))
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
          status: "approved",
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
    let releaseSessionSlot: (() => void) | null = null;
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
      })();
    };

    signal?.addEventListener("abort", closeOnAbort, { once: true });

    try {
      const approved = await openApprovedPlan({
        applicationId,
        db,
        personal,
        userId: claimed.userId,
      }).catch(() => {
        outcome = "crash";

        return null;
      });

      if (approved === null || approved.plan.applicationId !== applicationId) {
        outcome = "crash";

        throw new Error("the approved plan is missing");
      }

      const { plan } = approved;

      let resumeBytes: Uint8Array<ArrayBuffer> | null = null;

      if (plan.resume !== null) {
        const resumeFile = await resumes.currentFileBytes(plan.userId);

        if (resumeFile === null) {
          outcome = "crash";

          throw new Error("the resume file could not be read");
        }

        const sha256 = createHash("sha256").update(resumeFile.bytes).digest("hex");

        if (sha256 !== plan.resume.sha256) {
          outcome = "crash";

          throw new Error("the resume differs from the approved plan");
        }

        resumeBytes = resumeFile.bytes;
      }

      if (isShuttingDown()) {
        throw new Error("shutting down before the browser opened");
      }

      releaseSessionSlot = await acquireBrowserSession(signal);

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

      await applySendProxyTrim(context);

      const attemptHooks = {
        onCodeTyped: () => {
          updateAttempt(attemptId, { codeUsed: true });
        },
        onResponse: (status: number | null) => {
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
      };

      const planForRun = {
        fields: plan.fields,
        identity: {
          ats: plan.ats,
          boardToken: plan.boardToken,
          companyName: plan.companyName,
          jobId: plan.atsJobId,
          url: plan.postingUrl,
        },
        resume:
          resumeBytes === null || plan.resume === null
            ? null
            : {
                bytes: resumeBytes,
                fieldName: null,
                filename: plan.resume.filename,
              },
      };

      const runPromise: Promise<AttemptRun> = (async () => {
        if (plan.ats === "greenhouse") {
          return runGreenhouseAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "lever") {
          return runLeverAttempt(page, planForRun, attemptHooks);
        }

        return runAshbyAttempt(page, planForRun, attemptHooks);
      })();

      void Promise.allSettled([runPromise]);

      const run = await withDeadline(runPromise, hardTimeoutMs);

      outcome = outcomeOf(run.outcome);

      await cdp.close().catch(() => undefined);

      usage = await browser.close();
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
            approvedAt: approved.approvedAt,
            approvedPlanSha256: approved.sha256,
          });
        }
      } else if (run.outcome === "identity_mismatch") {
        const reason = run.identityReason ?? "unreadable";

        releaseAttempt(applicationId, claimed.userId, attemptId);

        db.update(applications)
          .set({
            stage: null,
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
      } else if (run.outcome === "flagged_spam") {
        releaseAttempt(applicationId, claimed.userId, attemptId);

        db.update(applications)
          .set({
            stage: null,
            status: "failed",
            statusReason: "ats_flagged",
            updatedAt: clock.now(),
          })
          .where(eq(applications.id, applicationId))
          .run();

        recordApplicationEvent(db, clock, {
          applicationId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "failed",
          source: "system",
        });
        recordApplicationEvent(db, clock, {
          applicationId,
          userId: claimed.userId,
          kind: "stage",
          fromValue: "queued",
          toValue: null,
          source: "system",
        });

        updateAttempt(attemptId, {
          endedAt: clock.now(),
          errorCode: "ats_flagged",
          outcome: "blocked",
        });
      } else if (run.outcome === "needs_review") {
        releaseAttempt(applicationId, claimed.userId, attemptId);

        preparation.openAttemptReviews({
          applicationId,
          attemptId,
          fields: "unexpectedRequired" in run ? (run.unexpectedRequired ?? []) : [],
          userId: claimed.userId,
        });

        db.update(applications)
          .set({
            approvedAt: null,
            approvedPlanEnc: null,
            approvedPlanSha256: null,
            attempts: sql`max(${applications.attempts} - 1, 0)`,
            scheduledFor: null,
            stage: stageForStatus("needs_review"),
            status: "needs_review",
            statusReason: "unknown_question",
            updatedAt: clock.now(),
          })
          .where(eq(applications.id, applicationId))
          .run();

        recordApplicationEvent(db, clock, {
          applicationId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "needs_review",
          source: "system",
        });

        updateAttempt(attemptId, {
          endedAt: clock.now(),
          errorCode: "preflight:unknown_required",
          outcome: "needs_review",
        });
      } else {
        const current = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
        const submitted = current?.submitClickedAt ?? null;

        if (run.outcome === "unconfirmed" || submitted !== null) {
          db.update(applications)
            .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
            .where(eq(applications.id, applicationId))
            .run();

          announce(applicationId, claimed.userId, "confirming");
          updateAttempt(attemptId, { endedAt: clock.now(), outcome: outcomeOf(run.outcome) });
        } else {
          const preflight = "preflight" in run ? (run.preflight ?? []) : [];

          finishBeforeSubmit({
            applicationId,
            attempts: claimed.attempts,
            at: clock.now(),
            attemptId,
            ...(run.outcome === "form_changed" && { changes: changeNotes(preflight) }),
            outcome: outcomeOf(run.outcome),
            userId: claimed.userId,
          });

          updateAttempt(attemptId, {
            captchaSeen: run.outcome === "captcha_blocked",
            endedAt: clock.now(),
            errorCode:
              preflight.length === 0
                ? null
                : `preflight:${preflight
                    .map((problem) => `${problem.kind}:${problem.fieldName ?? problem.label}`)
                    .join(",")}`,
            outcome: outcomeOf(run.outcome),
          });
        }
      }
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        pauseProvider(error.providerId, error.reason);
      }

      const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();
      const submitted = attempt?.submitClickedAt ?? null;

      if (submitted !== null) {
        db.update(applications)
          .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
          .where(eq(applications.id, applicationId))
          .run();

        announce(applicationId, claimed.userId, "confirming");
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
        } catch (error) {
          if (error instanceof ProviderUnavailableError) {
            pauseProvider(error.providerId, error.reason);
          }

          usage = zeroUsage;
        }
      }

      if (releaseSessionSlot !== null) {
        releaseSessionSlot();
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

        announce(application.id, application.userId, "confirming");
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

    const pendingUsage = providers.all().flatMap((provider) =>
      db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.provider, provider.id),
            eq(attempts.costMicros, 0),
            isNotNull(attempts.endedAt),
            isNotNull(attempts.providerSessionId),
            gte(attempts.endedAt, clock.now() - USAGE_BACKFILL_WINDOW_MS),
          ),
        )
        .all()
        .map((attempt) => ({ attempt, provider })),
    );

    const filled = await Promise.all(
      pendingUsage.map(async ({ attempt, provider }) => {
        const sessionId = attempt.providerSessionId;

        if (sessionId === null) {
          return 0;
        }

        const reported = await provider.sessionUsage(sessionId).catch(() => null);

        if (reported?.status !== "stopped") {
          return 0;
        }

        if (reported.usage.costMicros === 0 && reported.usage.proxyBytes === 0) {
          return 0;
        }

        updateAttempt(attempt.id, {
          browserMs: reported.usage.browserMs,
          costMicros: reported.usage.costMicros,
          proxyBytes: reported.usage.proxyBytes,
        });

        return 1;
      }),
    );

    return {
      confirming: confirmingCount,
      expired,
      released,
      sessionsStopped: stopped.filter((count) => count === 1).length,
      usageBackfilled: filled.filter((count) => count === 1).length,
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
