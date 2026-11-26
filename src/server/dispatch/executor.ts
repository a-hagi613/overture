import { createHash } from "node:crypto";

import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { chromium } from "playwright-core";
import { z } from "zod";

import type { Page } from "playwright-core";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ResumeService } from "../profile/resume.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PlanCacheAts } from "../pipeline/plan-cache.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { FormScope, LiveFormProblem } from "./forms/engine.ts";
import type { SendPlanField } from "../pipeline/send-plan.ts";
import type {
  BrowserProvider,
  BrowserProviderRegistry,
  BrowserUsage,
  ProviderUnavailableReason,
  RemoteBrowser,
} from "./browser/provider.ts";
import type { createMailboxService } from "../inbox/mailboxes.ts";
import type { MailSender } from "../platform/mail/port.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { Outcomes } from "./outcomes.ts";

import { applications, attempts, profiles, users } from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import {
  dailyUsageSince,
  releaseForApplication,
  reserveForApplication,
} from "../billing/ledger.ts";
import { getSetting, isKillSwitchEnabled, setKillSwitch } from "../platform/settings/index.ts";
import { raiseAlert } from "../platform/alerts.ts";
import { logError } from "../platform/log.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { localDayStart } from "../platform/local-time.ts";
import { enqueueApplicationPrepare } from "../pipeline/prepare-jobs.ts";
import { stageForStatus } from "../pipeline/stage.ts";
import { ProviderUnavailableError, browserModeForAttempt } from "./browser/provider.ts";
import { applySendProxyTrim } from "./browser/proxy-trim.ts";
import { recordApplicationVariableCosts } from "./application-cost.ts";
import { defaultMetrics } from "../platform/telemetry/metrics.ts";
import { runAshbyAttempt } from "./ats/ashby.ts";
import type { AshbyRun } from "./ats/ashby.ts";
import { runGreenhouseAttempt } from "./ats/greenhouse.ts";
import type { GreenhouseRun } from "./ats/greenhouse.ts";
import { runLeverAttempt } from "./ats/lever.ts";
import type { LeverRun } from "./ats/lever.ts";
import { runWorkableAttempt } from "./ats/workable.ts";
import type { WorkableRun } from "./ats/workable.ts";
import { runPersonioAttempt } from "./ats/personio.ts";
import type { PersonioRun } from "./ats/personio.ts";
import { runBreezyAttempt } from "./ats/breezy.ts";
import { runSoftgardenAttempt } from "./ats/softgarden.ts";
import { runClearCompanyAttempt } from "./ats/clearcompany.ts";
import { runJoinComAttempt } from "./ats/join-com.ts";
import { runPinpointAttempt } from "./ats/pinpoint.ts";
import { runTeamtailorAttempt } from "./ats/teamtailor.ts";
import { runZohoRecruitAttempt } from "./ats/zoho-recruit.ts";
import { runBambooHRAttempt } from "./ats/bamboohr.ts";
import { runRecruiteeAttempt } from "./ats/recruitee.ts";
import { runHireologyAttempt } from "./ats/hireology.ts";
import { runSmartRecruitersAttempt } from "./ats/smartrecruiters.ts";
import { runPaylocityAttempt } from "./ats/paylocity.ts";
import { runManatalAttempt } from "./ats/manatal.ts";
import { runCareerplugAttempt } from "./ats/careerplug.ts";
import { runJazzhrAttempt } from "./ats/jazzhr.ts";
import type { HostedRun } from "./ats/hosted.ts";
import { LOGIN_WALL_REASON } from "../pipeline/login-wall.ts";
import type { BrowserFormHooks, BrowserFormPlan, BrowserFormRun } from "./ats/browser-form.ts";
import type { BatchFourAts, WaveTwoAts } from "../../shared/ats.ts";
import { isBatchFourAts, isWaveTwoAts } from "../../shared/ats.ts";
import { runHiringthingAttempt } from "./ats/hiringthing.ts";
import { runRipplingAttempt } from "./ats/rippling.ts";
import { runGemAttempt } from "./ats/gem.ts";
import { runIsolvedHireAttempt } from "./ats/isolved-hire.ts";
import { runApplicantProAttempt } from "./ats/applicantpro.ts";
import { runCatsoneAttempt } from "./ats/catsone.ts";
import { runOnlyfyAttempt } from "./ats/onlyfy.ts";
import { runVarbiAttempt } from "./ats/varbi.ts";
import { runHerpAttempt } from "./ats/herp.ts";
import { runJobviteAttempt } from "./ats/jobvite.ts";
import {
  CODE_WAIT_TIMEOUT_MS,
  createCodeWait,
  markCodeConsumed,
  waitForCode,
} from "../inbox/waits.ts";
import { codeWaitAskDelayMs } from "../../shared/code-wait.ts";
import { createNotification } from "../notify/notifications.ts";
import { sendCodeWaitEmailFallback } from "../notify/code-wait-email.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { copy } from "../../shared/copy.ts";
import { recordApplicationEvent } from "./outcomes.ts";
import { acquireBrowserSession } from "./browser/session-slots.ts";
import { nextSendSlot as nextSlotInWindow, parseSendWindow, planningWindow } from "./planning.ts";
import { openApprovedPlan } from "../pipeline/approved-plan.ts";
import { createPlanCache } from "../pipeline/plan-cache.ts";
import { createFormSelfHealer, planFieldSignature } from "./forms/self-heal.ts";
import { recordPostingFailure } from "../matching/posting-flags.ts";
import { captureSubmitScreenshot } from "../applications/screenshots.ts";

class ReservationRefusedError extends Error {
  constructor() {
    super("no application credit is available");
    this.name = "ReservationRefusedError";
  }
}

export const APPLICATION_SEND_JOB_KIND = "application.send";

export const DISPATCH_RECOVER_JOB_KIND = "dispatch.recover";

const ATTEMPT_LEASE_MS = 15 * 60_000;
const SESSION_TIMEOUT_MINUTES = 12;
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
  llm: LlmPort;
  providers: BrowserProviderRegistry;
  hardTimeoutMs: number;
  preparation: PreparationService;
  resumes: ResumeService;
  personal: PersonalCrypto;
  mailboxes: ReturnType<typeof createMailboxService>;
  outcomes: Outcomes;
  mail: MailSender;
  objects?: ObjectStore;
  appOrigin: string;
  proxyCountry: string;
  signal?: AbortSignal;
  codeWaitSignal?: AbortSignal;
}

type AttemptRow = typeof attempts.$inferSelect;

type AttemptRun =
  | GreenhouseRun
  | LeverRun
  | AshbyRun
  | WorkableRun
  | PersonioRun
  | BrowserFormRun
  | HostedRun;

const BATCH_4_RUNNERS: Record<
  BatchFourAts,
  (page: Page, plan: BrowserFormPlan, hooks: BrowserFormHooks) => Promise<BrowserFormRun>
> = {
  applicantpro: runApplicantProAttempt,
  catsone: runCatsoneAttempt,
  gem: runGemAttempt,
  hiringthing: runHiringthingAttempt,
  isolved_hire: runIsolvedHireAttempt,
  onlyfy: runOnlyfyAttempt,
  rippling: runRipplingAttempt,
  varbi: runVarbiAttempt,
};

const WAVE_2_RUNNERS: Record<
  WaveTwoAts,
  (page: Page, plan: BrowserFormPlan, hooks: BrowserFormHooks) => Promise<BrowserFormRun>
> = {
  herp: runHerpAttempt,
  jobvite: runJobviteAttempt,
};

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
  ["login_wall", "blocked"],
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

function combineSignals(first?: AbortSignal, second?: AbortSignal) {
  if (first === undefined) {
    return second;
  }

  if (second === undefined) {
    return first;
  }

  return AbortSignal.any([first, second]);
}

export function createDispatcher(deps: DispatcherDeps) {
  const {
    db,
    clock,
    llm,
    providers,
    hardTimeoutMs,
    preparation,
    resumes,
    personal,
    mailboxes,
    outcomes,
    mail,
    objects,
    appOrigin,
    proxyCountry,
    signal,
  } = deps;

  const codeWaitSignal = combineSignals(signal, deps.codeWaitSignal);

  const formSelfHealer = createFormSelfHealer({
    cache: createPlanCache({ clock, db }),
    clock,
    db,
    llm,
  });

  const activeAttempts = new Set<string>();
  const activeAttemptRuns = new Set<Promise<boolean>>();

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

  function previousOutcome(applicationId: string, attemptId: string) {
    const row = db
      .select({ outcome: attempts.outcome })
      .from(attempts)
      .where(
        and(
          eq(attempts.applicationId, applicationId),
          ne(attempts.id, attemptId),
          isNotNull(attempts.outcome),
        ),
      )
      .orderBy(desc(attempts.startedAt))
      .limit(1)
      .get();

    return row?.outcome ?? null;
  }

  function releaseAttempt(applicationId: string, userId: string, attemptId: string) {
    releaseForApplication(db, clock, {
      applicationId,
      idempotencyKey: `release:${attemptId}`,
      userId,
    });
  }

  function scheduleRetry(applicationId: string, userId: string, at: number, attemptId: string) {
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
      attemptId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "approved",
      reason: "retry_scheduled",
      source: "system",
    });

    announce(applicationId, userId, "approved");

    return slot;
  }

  function requestInterrupt(
    applicationId: string,
    userId: string,
    at: number,
    attemptId: string,
    reason: string,
  ) {
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
      attemptId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "approved",
      reason,
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
        attemptId,
        userId,
        kind: "status",
        fromValue: "sending",
        toValue: "ready",
        reason: outcome,
        source: "system",
      });

      enqueueApplicationPrepare(db, clock, applicationId);
      announce(applicationId, userId, "ready");

      return "retry" as const;
    }

    if (used < maxAttempts) {
      scheduleRetry(applicationId, userId, at, attemptId);

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

    if (outcome === "form_changed") {
      const failed = db
        .select({ postingId: applications.postingId })
        .from(applications)
        .where(eq(applications.id, applicationId))
        .get();

      if (failed !== undefined) {
        recordPostingFailure(db, clock, {
          postingId: failed.postingId,
          reason: "employer_form_failed",
        });
      }
    }

    recordApplicationEvent(db, clock, {
      applicationId,
      attemptId,
      userId,
      kind: "status",
      fromValue: "sending",
      toValue: "failed",
      reason: outcome,
      source: "system",
    });
    recordApplicationEvent(db, clock, {
      applicationId,
      attemptId,
      userId,
      kind: "stage",
      fromValue: "queued",
      toValue: null,
      reason: outcome,
      source: "system",
    });

    announce(applicationId, userId, "failed");

    return "failed" as const;
  }

  function switchedOffAtSend(applicationId: string, providerId: string) {
    const row = db
      .select({ ats: applications.ats, companyId: applications.companyId })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (row === undefined) {
      return true;
    }

    return (
      isKillSwitchEnabled(db, "global", "all") ||
      (row.ats !== null && isKillSwitchEnabled(db, "ats", row.ats)) ||
      isKillSwitchEnabled(db, "employer", row.companyId) ||
      isKillSwitchEnabled(db, "provider", providerId)
    );
  }

  async function runAttempt(applicationId: string) {
    const run = startAttempt(applicationId);

    activeAttemptRuns.add(run);

    try {
      return await run;
    } finally {
      activeAttemptRuns.delete(run);
    }
  }

  async function startAttempt(applicationId: string) {
    const provider = providers.pick();

    if (switchedOffAtSend(applicationId, provider.id)) {
      return false;
    }

    const demo = db
      .select({ role: users.role })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .where(eq(applications.id, applicationId))
      .get();

    if (demo?.role === "demo") {
      return false;
    }

    const releaseSessionSlot = await acquireBrowserSession(signal);

    try {
      if (switchedOffAtSend(applicationId, provider.id)) {
        return false;
      }

      return await attemptWithSlot(applicationId, provider);
    } finally {
      releaseSessionSlot();
    }
  }

  async function claimAndReserve(applicationId: string, provider: BrowserProvider) {
    const attemptId = crypto.randomUUID();

    try {
      return await retryWhenBusy(
        () =>
          db.transaction(
            (tx) => {
              const at = clock.now();

              const row = tx
                .select({
                  attempts: applications.attempts,
                  role: users.role,
                  running: profiles.running,
                  suspendedAt: users.suspendedAt,
                  timezone: profiles.timezone,
                  userId: applications.userId,
                })
                .from(applications)
                .innerJoin(users, eq(users.id, applications.userId))
                .leftJoin(profiles, eq(profiles.userId, applications.userId))
                .where(and(eq(applications.id, applicationId), eq(applications.status, "approved")))
                .get();

              if (
                row === undefined ||
                row.running !== true ||
                row.suspendedAt !== null ||
                row.role === "demo"
              ) {
                return null;
              }

              const timeZone = row.timezone ?? "UTC";
              const window = planningWindow(at, timeZone, sendWindow(db));

              if (at < window.start || at >= window.end) {
                return null;
              }

              const dailyCap = settingNumber(db, "limits.daily_cap", 10);

              if (dailyUsageSince(tx, row.userId, localDayStart(at, timeZone)) >= dailyCap) {
                return null;
              }

              const claimed = tx
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
                return null;
              }

              const reserved = reserveForApplication(tx, clock, {
                applicationId,
                idempotencyKey: `reserve:${attemptId}`,
                userId: claimed.userId,
              });

              if (!reserved.reserved) {
                throw new ReservationRefusedError();
              }

              tx.insert(attempts)
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

              return { attempts: claimed.attempts, attemptId, userId: claimed.userId };
            },
            { behavior: "immediate" },
          ),
        "dispatch.claim",
      );
    } catch (error) {
      if (error instanceof ReservationRefusedError) {
        return null;
      }

      throw error;
    }
  }

  async function attemptWithSlot(applicationId: string, provider: BrowserProvider) {
    const claimed = await claimAndReserve(applicationId, provider);

    if (claimed === null) {
      return false;
    }

    const { attemptId } = claimed;

    const attemptStartedAt = performance.now();
    let attemptAts = "unknown";
    let attemptMode = "unknown";

    activeAttempts.add(attemptId);

    let browser: RemoteBrowser | null = null;
    let usage = zeroUsage;
    let outcome: AttemptRow["outcome"] = "provider_error";
    let shutdownActive = false;
    let codeWaitCancelled = codeWaitSignal?.aborted ?? false;

    const isShuttingDown = () => shutdownActive;

    const markCodeWaitCancelled = () => {
      codeWaitCancelled = true;
    };

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
    codeWaitSignal?.addEventListener("abort", markCodeWaitCancelled, { once: true });

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

      attemptAts = plan.ats;

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

      const mode = browserModeForAttempt(provider.id, previousOutcome(applicationId, attemptId));

      attemptMode = mode;

      browser = await provider.open({
        attemptId,
        country: proxyCountry,
        mode,
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

      const healAts: PlanCacheAts | null = plan.ats === "greenhouse" ? null : plan.ats;
      const healRunCap = new Set<string>();

      const healSignature = healAts === null ? null : planFieldSignature(healAts, plan.fields);

      const attemptHooks = {
        healField:
          healAts === null || healSignature === null
            ? undefined
            : async (scope: FormScope, field: SendPlanField) =>
                formSelfHealer.healField({
                  ats: healAts,
                  field,
                  runCap: healRunCap,
                  scope,
                  signature: healSignature,
                  userId: plan.userId,
                }),
        onCodeTyped: () => {
          updateAttempt(attemptId, { codeUsed: true });
        },
        onResponse: async (status: number | null) => {
          if (status !== null && status >= 400 && status < 500) {
            updateAttempt(attemptId, { submitClickedAt: null, submitResponseStatus: status });
          } else {
            updateAttempt(attemptId, { submitResponseStatus: status });
          }

          if (objects !== undefined) {
            await captureSubmitScreenshot(
              { clock, objects },
              {
                applicationId,
                attemptId,
                page,
                phase: "after_submit",
                userId: claimed.userId,
              },
            );
          }
        },
        onWillSubmit: async () => {
          updateAttempt(attemptId, { submitClickedAt: clock.now() });

          if (objects !== undefined) {
            await captureSubmitScreenshot(
              { clock, objects },
              {
                applicationId,
                attemptId,
                page,
                phase: "before_submit",
                userId: claimed.userId,
              },
            );
          }
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

          const askDelayMs = codeWaitAskDelayMs(mailbox.firstForwardedAt !== null);

          const resolved = await waitForCode(
            { db, clock, personal },
            {
              askDelayMs,
              onAskToPaste: async () => {
                const notificationId = createNotification(db, clock, {
                  body: copy.notifications.codeWait.body(
                    plan.companyName,
                    CODE_WAIT_TIMEOUT_MS / 60_000,
                  ),
                  kind: copy.notifications.codeWait.kind,
                  title: copy.notifications.codeWait.title,
                  url: copy.notifications.codeWait.url(wait.id),
                  userId: claimed.userId,
                });

                if (notificationId === null) {
                  return;
                }

                await sendCodeWaitEmailFallback(
                  { appOrigin, clock, db, mail },
                  { notificationId, userId: claimed.userId },
                );
              },
              waitId: wait.id,
            },
            codeWaitSignal === undefined ? {} : { signal: codeWaitSignal },
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

        if (plan.ats === "workable") {
          return runWorkableAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "personio") {
          return runPersonioAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "breezy") {
          return runBreezyAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "softgarden") {
          return runSoftgardenAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "clearcompany") {
          return runClearCompanyAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "join_com") {
          return runJoinComAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "pinpoint") {
          return runPinpointAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "teamtailor") {
          return runTeamtailorAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "zoho_recruit") {
          return runZohoRecruitAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "bamboohr") {
          return runBambooHRAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "recruitee") {
          return runRecruiteeAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "hireology") {
          return runHireologyAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "smartrecruiters") {
          return runSmartRecruitersAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "paylocity") {
          return runPaylocityAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "manatal") {
          return runManatalAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "careerplug") {
          return runCareerplugAttempt(page, planForRun, attemptHooks);
        }

        if (plan.ats === "jazzhr") {
          return runJazzhrAttempt(page, planForRun, attemptHooks);
        }

        if (isBatchFourAts(plan.ats)) {
          return BATCH_4_RUNNERS[plan.ats](page, planForRun, attemptHooks);
        }

        if (isWaveTwoAts(plan.ats)) {
          return WAVE_2_RUNNERS[plan.ats](page, planForRun, attemptHooks);
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
      } else if (run.outcome === "login_wall") {
        releaseAttempt(applicationId, claimed.userId, attemptId);

        db.update(applications)
          .set({
            stage: null,
            status: "skipped",
            statusReason: LOGIN_WALL_REASON,
            updatedAt: clock.now(),
          })
          .where(eq(applications.id, applicationId))
          .run();

        recordApplicationEvent(db, clock, {
          applicationId,
          attemptId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "skipped",
          reason: "login_wall",
          source: "system",
        });

        updateAttempt(attemptId, {
          endedAt: clock.now(),
          errorCode: LOGIN_WALL_REASON,
          outcome: "blocked",
        });
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
          attemptId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "skipped",
          reason: `posting_identity:${reason}`,
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
          attemptId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "failed",
          reason: "ats_flagged",
          source: "system",
        });
        recordApplicationEvent(db, clock, {
          applicationId,
          attemptId,
          userId: claimed.userId,
          kind: "stage",
          fromValue: "queued",
          toValue: null,
          reason: "ats_flagged",
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
          attemptId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "needs_review",
          reason: "unknown_question",
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

          recordApplicationEvent(db, clock, {
            applicationId,
            attemptId,
            userId: claimed.userId,
            kind: "status",
            fromValue: "sending",
            toValue: "confirming",
            reason: submitted === null ? "unconfirmed_after_submit" : run.outcome,
            source: "system",
          });

          announce(applicationId, claimed.userId, "confirming");
          updateAttempt(attemptId, { endedAt: clock.now(), outcome: outcomeOf(run.outcome) });
        } else if (codeWaitCancelled) {
          releaseAttempt(applicationId, claimed.userId, attemptId);
          requestInterrupt(
            applicationId,
            claimed.userId,
            clock.now(),
            attemptId,
            "code_wait_cancelled",
          );
          updateAttempt(attemptId, { endedAt: clock.now(), outcome: "interrupted" });
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

        recordApplicationEvent(db, clock, {
          applicationId,
          attemptId,
          userId: claimed.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "confirming",
          reason: isShuttingDown() ? "deploy_interruption" : "attempt_crash_after_submit",
          source: "system",
        });

        announce(applicationId, claimed.userId, "confirming");
        updateAttempt(attemptId, {
          endedAt: clock.now(),
          outcome: isShuttingDown() ? "unconfirmed" : "crash",
        });
      } else if (isShuttingDown()) {
        releaseAttempt(applicationId, claimed.userId, attemptId);
        requestInterrupt(
          applicationId,
          claimed.userId,
          clock.now(),
          attemptId,
          "deploy_interruption",
        );
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
      codeWaitSignal?.removeEventListener("abort", markCodeWaitCancelled);
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

      const finished = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();

      updateAttempt(attemptId, {
        browserMs: usage.browserMs,
        costMicros: usage.costMicros,
        endedAt: finished?.endedAt ?? clock.now(),
        outcome: finished?.outcome ?? outcome,
        proxyBytes: usage.proxyBytes,
      });

      try {
        recordApplicationVariableCosts(db, { at: clock.now(), userId: claimed.userId });
      } catch (error) {
        logError("dispatch.cost", error);
      }

      const finalOutcome = finished?.outcome ?? outcome;

      defaultMetrics().recordApplyAttempt({
        ats: attemptAts,
        durationMs: performance.now() - attemptStartedAt,
        mode: attemptMode,
        outcome: finalOutcome,
      });
    }

    return true;
  }

  async function recover() {
    const confirming = await outcomes.expireConfirming();

    const sending = db
      .select({ application: applications })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .where(and(eq(applications.status, "sending"), sql`${users.role} <> 'demo'`))
      .all()
      .map((row) => row.application);

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

        recordApplicationEvent(db, clock, {
          applicationId: application.id,
          attemptId: attempt.id,
          userId: application.userId,
          kind: "status",
          fromValue: "sending",
          toValue: "confirming",
          reason: "recovered_after_submit",
          source: "system",
        });

        announce(application.id, application.userId, "confirming");
        updateAttempt(attempt.id, {
          browserMs: attempt.browserMs ?? Math.max(0, clock.now() - attempt.startedAt),
          costMicros: attempt.costMicros ?? 0,
          endedAt: attempt.endedAt ?? clock.now(),
          outcome: attempt.outcome ?? "crash",
          proxyBytes: attempt.proxyBytes,
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
          proxyBytes: attempt.proxyBytes,
        });
      }

      requestInterrupt(
        application.id,
        application.userId,
        clock.now(),
        attempt?.id ?? application.id,
        "deploy_interruption",
      );

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

        if (reported.usage.costMicros === 0 && (reported.usage.proxyBytes ?? 0) === 0) {
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

  async function drain(timeoutMs: number) {
    if (activeAttemptRuns.size === 0) {
      return 0;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
    });

    await Promise.race([Promise.allSettled(activeAttemptRuns), deadline]);

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    return activeAttemptRuns.size;
  }

  return {
    drain,
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
