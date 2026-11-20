import { and, desc, eq, sql } from "drizzle-orm";
import { chromium } from "playwright-core";
import { z } from "zod";

import type { Page } from "playwright-core";
import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ResumeService } from "../profile/resume.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { SendPlan } from "../pipeline/send-plan.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { BrowserProvider, BrowserUsage, RemoteBrowser } from "./browser/provider.ts";

import {
  applications,
  applicationEvents,
  applicationSnapshots,
  attempts,
} from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import {
  commitForApplication,
  releaseForApplication,
  reserveForApplication,
} from "../billing/ledger.ts";
import { runGreenhouseAttempt } from "./ats/greenhouse.ts";

export const APPLICATION_SEND_JOB_KIND = "application.send";

export const DISPATCH_RECOVER_JOB_KIND = "dispatch.recover";

const ATTEMPT_LEASE_MS = 15 * 60_000;
const SESSION_TIMEOUT_MINUTES = 15;
const RECOVER_INTERVAL_MS = 60_000;

const sendPayloadSchema = z.object({ applicationId: z.string().min(1) });

export interface DispatcherDeps {
  db: AppDatabase;
  clock: Clock;
  provider: BrowserProvider;
  preparation: PreparationService;
  resumes: ResumeService;
  personal: PersonalCrypto;
  proxyCountry: string;
}

type AttemptRow = typeof attempts.$inferSelect;

const zeroUsage: BrowserUsage = { browserMs: 0, costMicros: 0, proxyBytes: 0 };

const ATTEMPT_OUTCOMES = [
  ["blocked", "blocked"],
  ["captcha_blocked", "captcha_blocked"],
  ["fill_failed", "form_changed"],
  ["form_missing", "form_changed"],
  ["sent", "sent"],
  ["unconfirmed", "unconfirmed"],
  ["upload_failed", "upload_failed"],
] as const satisfies readonly (readonly [string, AttemptRow["outcome"]])[];

function outcomeOf(outcome: string) {
  return ATTEMPT_OUTCOMES.find(([name]) => name === outcome)?.[1] ?? "provider_error";
}

function recordEvent(
  db: AppDatabase,
  clock: Clock,
  applicationId: string,
  userId: string,
  kind: "status" | "stage",
  fromValue: string | null,
  toValue: string | null,
) {
  db.insert(applicationEvents)
    .values({
      applicationId,
      at: clock.now(),
      fromValue,
      id: crypto.randomUUID(),
      kind,
      source: "system",
      toValue,
      userId,
    })
    .run();
}

export function createDispatcher(deps: DispatcherDeps) {
  const { db, clock, provider, preparation, resumes, personal, proxyCountry } = deps;

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

  function releaseAttempt(applicationId: string, userId: string, attemptId: string, at: number) {
    releaseForApplication(db, clock, {
      applicationId,
      idempotencyKey: `release:${attemptId}`,
      userId,
    });

    db.update(applications)
      .set({ status: "ready", statusReason: null, updatedAt: at })
      .where(eq(applications.id, applicationId))
      .run();
  }

  async function writeSnapshot(input: {
    applicationId: string;
    attempt: AttemptRow;
    consentVersion: string;
    costMicros: number;
    plan: SendPlan;
  }) {
    const { plan } = input;

    const answers = plan.fields.map((field) => ({
      answer: field.fieldType === "file" ? (plan.resume?.filename ?? null) : field.answer,
      fact_key: field.factKey,
      fact_revision: field.factRevision,
      kind: field.fieldType === "file" ? "file" : field.answerKind,
      label: field.label,
      question_id: field.questionId,
      resume_line_ids: field.sentences.flatMap((sentence) => sentence.resumeLineIds),
    }));

    const answersEnc = await personal.sealFor(
      plan.userId,
      { column: "answers_enc", rowId: input.applicationId, table: "application_snapshots" },
      JSON.stringify(answers),
    );

    const coverLetterEnc =
      plan.coverLetter === null
        ? null
        : await personal.sealFor(
            plan.userId,
            {
              column: "cover_letter_enc",
              rowId: input.applicationId,
              table: "application_snapshots",
            },
            JSON.stringify(
              plan.coverLetter.map((sentence) => ({
                resume_line_ids: sentence.resumeLineIds,
                sentence: sentence.sentence,
              })),
            ),
          );

    const { resume } = plan;

    if (resume === null) {
      throw new Error("an application cannot be sent without a resume");
    }

    const at = clock.now();
    const submittedAt = input.attempt.submitClickedAt ?? at;

    db.transaction((tx) => {
      commitForApplication(tx, clock, {
        applicationId: input.applicationId,
        idempotencyKey: `commit:${input.applicationId}`,
        userId: plan.userId,
      });

      tx.insert(applicationSnapshots)
        .values({
          answersEnc,
          applicationId: input.applicationId,
          confirmedBy: "page",
          consentVersion: input.consentVersion,
          costMicros: input.costMicros,
          coverLetterEnc,
          descriptionHash: plan.descriptionHash,
          postingTitle: plan.postingTitle,
          postingUrl: plan.postingUrl,
          provider: provider.id,
          providerSessionId: input.attempt.providerSessionId,
          resumeId: resume.id,
          resumeSha256: resume.sha256,
          submittedAt,
          userId: plan.userId,
        })
        .run();

      tx.update(applications)
        .set({
          sentAt: submittedAt,
          stage: "applied",
          stageLocked: false,
          status: "sent",
          statusReason: null,
          updatedAt: at,
        })
        .where(eq(applications.id, input.applicationId))
        .run();

      tx.update(attempts)
        .set({ endedAt: at, outcome: "sent" })
        .where(eq(attempts.id, input.attempt.id))
        .run();
    });

    recordEvent(db, clock, input.applicationId, plan.userId, "status", "sending", "sent");
    recordEvent(db, clock, input.applicationId, plan.userId, "stage", "queued", "applied");
  }

  async function runAttempt(applicationId: string) {
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

    try {
      const plan = await preparation.sendPlanFor(applicationId);

      if (plan === null) {
        throw new Error("the send plan could not be built");
      }

      const resumeFile = plan.resume === null ? null : await resumes.currentFileBytes(plan.userId);

      if (resumeFile === null) {
        throw new Error("the resume file could not be read");
      }

      browser = await provider.open({
        attemptId,
        country: proxyCountry,
        profileId: plan.userId,
        timeoutMinutes: SESSION_TIMEOUT_MINUTES,
      });

      updateAttempt(attemptId, { providerSessionId: browser.sessionId });

      const cdp = await chromium.connectOverCDP(browser.cdpUrl);
      const context = cdp.contexts()[0] ?? (await cdp.newContext());
      const page: Page = context.pages()[0] ?? (await context.newPage());

      await context.route("**/*", async (route) => {
        const type = route.request().resourceType();

        if (type === "image" || type === "font" || type === "media") {
          await route.abort().catch(() => undefined);

          return;
        }

        await route.fallback();
      });

      const run = await runGreenhouseAttempt(
        page,
        {
          fields: plan.fields,
          resume: {
            bytes: resumeFile.bytes,
            fieldName: null,
            filename: resumeFile.filename,
          },
          url: plan.postingUrl,
        },
        {
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
        },
      );

      outcome = outcomeOf(run.outcome);

      await cdp.close().catch(() => undefined);

      usage = await browser.close();
      await provider.stop(browser.sessionId).catch(() => undefined);
      browser = null;

      if (run.outcome === "sent") {
        const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();

        if (attempt !== undefined) {
          await writeSnapshot({
            applicationId,
            attempt,
            consentVersion: plan.consentVersion,
            costMicros: usage.costMicros,
            plan,
          });
        }
      } else if (run.outcome === "unconfirmed") {
        db.update(applications)
          .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
          .where(eq(applications.id, applicationId))
          .run();

        updateAttempt(attemptId, { endedAt: clock.now(), outcome: "unconfirmed" });
      } else {
        releaseAttempt(applicationId, claimed.userId, attemptId, clock.now());
        updateAttempt(attemptId, {
          captchaSeen: run.outcome === "captcha_blocked",
          endedAt: clock.now(),
          outcome: outcomeOf(run.outcome),
        });
      }
    } catch {
      const attempt = db.select().from(attempts).where(eq(attempts.id, attemptId)).get();

      if (attempt?.submitClickedAt !== null && attempt?.submitClickedAt !== undefined) {
        db.update(applications)
          .set({ status: "confirming", statusReason: null, updatedAt: clock.now() })
          .where(eq(applications.id, applicationId))
          .run();

        updateAttempt(attemptId, { endedAt: clock.now(), outcome: "crash" });
      } else {
        releaseAttempt(applicationId, claimed.userId, attemptId, clock.now());
        updateAttempt(attemptId, { endedAt: clock.now(), outcome });
      }
    } finally {
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
    const sending = db.select().from(applications).where(eq(applications.status, "sending")).all();

    let confirming = 0;
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

        confirming += 1;

        continue;
      }

      if (attempt !== undefined) {
        releaseForApplication(db, clock, {
          applicationId: application.id,
          idempotencyKey: `release:${attempt.id}`,
          userId: application.userId,
        });

        updateAttempt(attempt.id, {
          browserMs: attempt.browserMs ?? Math.max(0, clock.now() - attempt.startedAt),
          costMicros: attempt.costMicros ?? 0,
          endedAt: attempt.endedAt ?? clock.now(),
          outcome: "interrupted",
          proxyBytes: attempt.proxyBytes ?? 0,
        });
      }

      db.update(applications)
        .set({
          attempts: sql`max(${applications.attempts} - 1, 0)`,
          status: "ready",
          statusReason: null,
          updatedAt: clock.now(),
        })
        .where(eq(applications.id, application.id))
        .run();

      released += 1;
    }

    const open = await provider.listOpen();

    const stopped = await Promise.all(
      open.map(async (session) => {
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
      confirming,
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
    enqueueSend,
    ensureRecoveryQueued,
    recover,
    runAttempt,
    sendNow: async (applicationId: string) => {
      const parsed = sendPayloadSchema.parse({ applicationId });

      return runAttempt(parsed.applicationId);
    },
  };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
