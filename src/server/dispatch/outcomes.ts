import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { SendPlan } from "../pipeline/send-plan.ts";

import { isAtsMailDomain } from "../../shared/ats-mail-domains.ts";
import { isSameHostOrSubdomain } from "../../shared/host-match.ts";
import {
  applications,
  applicationReceipts,
  applicationSnapshots,
  attempts,
  mailThreads,
  messages,
} from "../platform/db/schema.ts";
import { commitForApplication, releaseForApplication } from "../billing/ledger.ts";
import { getSetting } from "../platform/settings/index.ts";
import { logError } from "../platform/log.ts";
import { openApprovedPlan } from "../pipeline/approved-plan.ts";
import { recordSnapshotSent } from "../pipeline/review-events.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { recordApplicationVariableCosts } from "./application-cost.ts";
import { recordApplicationEvent } from "../applications/events.ts";

export { recordApplicationEvent };

const HOUR_MS = 60 * 60_000;

type AttemptRow = typeof attempts.$inferSelect;

type MessageRow = typeof messages.$inferSelect;

export interface OutcomeDeps {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
}

interface ConfirmationCandidate {
  applicationId: string;
  employerMatched: boolean;
  roleMatched: boolean;
  sharedEmployer: boolean;
}

interface ConfirmationTarget {
  companyDomain: string | null;
  companyName: string;
  postingTitle: string;
}

function confirmWaitMs(db: AppDatabase) {
  const parsed = Number(getSetting(db, "limits.confirm_wait_hours"));

  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 24) * HOUR_MS;
}

function unambiguousTarget(candidates: readonly ConfirmationCandidate[]) {
  const eligible = candidates.filter((candidate) =>
    candidate.sharedEmployer
      ? candidate.employerMatched && candidate.roleMatched
      : candidate.employerMatched || candidate.roleMatched,
  );

  if (eligible.length === 1) {
    return eligible.at(0)?.applicationId ?? null;
  }

  if (eligible.length > 1) {
    const strongest = eligible.filter(
      (candidate) => candidate.employerMatched && candidate.roleMatched,
    );

    if (strongest.length === 1) {
      return strongest.at(0)?.applicationId ?? null;
    }
  }

  return null;
}

function confirmationEvidence(target: ConfirmationTarget, message: MessageRow, opened: string) {
  const domainAccepted =
    isAtsMailDomain(message.senderDomain) ||
    (target.companyDomain !== null &&
      isSameHostOrSubdomain(message.senderDomain, target.companyDomain));

  if (!domainAccepted) {
    return null;
  }

  const title = (target.postingTitle.split("|")[0] ?? "").trim().toLowerCase();

  return {
    employer: opened.includes(target.companyName.toLowerCase()),
    role: title.length >= 4 && opened.includes(title),
  };
}

export function createOutcomes(deps: OutcomeDeps) {
  const { db, clock, personal } = deps;

  async function sealSnapshot(
    applicationId: string,
    userId: string,
    attempt: AttemptRow,
    plan: SendPlan,
    confirmedBy: "page" | "email",
    costMicros: number,
    approval: { approvedAt: number; approvedPlanSha256: string },
  ) {
    if (plan.resume === null) {
      return null;
    }

    const answers = plan.fields.map((field) => ({
      answer: field.fieldType === "file" ? (plan.resume?.filename ?? null) : field.answer,
      by_user: field.sentences.some((sentence) => sentence.byUser === true),
      fact_key: field.factKey,
      fact_revision: field.factRevision,
      kind: field.fieldType === "file" ? "file" : field.answerKind,
      label: field.label,
      question_id: field.questionId,
      resume_line_ids: field.sentences.flatMap((sentence) => sentence.resumeLineIds),
    }));

    const answersEnc = await personal.sealFor(
      userId,
      { column: "answers_enc", rowId: applicationId, table: "application_snapshots" },
      JSON.stringify(answers),
    );

    const coverLetterEnc =
      plan.coverLetter === null
        ? null
        : await personal.sealFor(
            userId,
            {
              column: "cover_letter_enc",
              rowId: applicationId,
              table: "application_snapshots",
            },
            JSON.stringify(
              plan.coverLetter.map((sentence) => ({
                by_user: sentence.byUser === true,
                resume_line_ids: sentence.resumeLineIds,
                sentence: sentence.sentence,
              })),
            ),
          );

    return {
      answersEnc,
      applicationId,
      approvedAt: approval.approvedAt,
      approvedPlanSha256: approval.approvedPlanSha256,
      confirmedBy,
      consentVersion: plan.consentVersion,
      costMicros,
      coverLetterEnc,
      descriptionHash: plan.descriptionHash,
      postingTitle: plan.postingTitle,
      postingUrl: plan.postingUrl,
      provider: attempt.provider,
      providerSessionId: attempt.providerSessionId,
      resumeId: plan.resume.id,
      resumeSha256: plan.resume.sha256,
      submittedAt: attempt.submitClickedAt ?? clock.now(),
      userId,
    };
  }

  async function recordSent(input: {
    applicationId: string;
    attempt: AttemptRow;
    plan: SendPlan;
    approvedAt: number;
    approvedPlanSha256: string;
    costMicros: number;
    confirmedBy: "page" | "email";
    markAttemptSent: boolean;
    receiptMessageId?: string | null;
  }) {
    const at = clock.now();
    const submittedAt = input.attempt.submitClickedAt ?? at;
    const fromStatus = input.confirmedBy === "email" ? "confirming" : "sending";
    const receiptMessageId = input.receiptMessageId ?? null;

    const snapshot = await sealSnapshot(
      input.applicationId,
      input.plan.userId,
      input.attempt,
      input.plan,
      input.confirmedBy,
      input.costMicros,
      { approvedAt: input.approvedAt, approvedPlanSha256: input.approvedPlanSha256 },
    );

    const recorded = db.transaction((tx) => {
      if (receiptMessageId !== null) {
        const owner = tx
          .select({ applicationId: applicationReceipts.applicationId })
          .from(applicationReceipts)
          .where(eq(applicationReceipts.messageId, receiptMessageId))
          .get();

        if (owner !== undefined && owner.applicationId !== input.applicationId) {
          return false;
        }

        if (owner === undefined) {
          tx.insert(applicationReceipts)
            .values({
              applicationId: input.applicationId,
              confirmedAt: at,
              messageId: receiptMessageId,
            })
            .run();
        }
      }

      commitForApplication(tx, clock, {
        applicationId: input.applicationId,
        idempotencyKey: `commit:${input.applicationId}`,
        userId: input.plan.userId,
      });

      if (snapshot !== null) {
        const existing = tx
          .select({ applicationId: applicationSnapshots.applicationId })
          .from(applicationSnapshots)
          .where(eq(applicationSnapshots.applicationId, input.applicationId))
          .get();

        tx.insert(applicationSnapshots).values(snapshot).onConflictDoNothing().run();

        if (existing === undefined) {
          recordSnapshotSent(tx, clock, {
            answers: input.plan.fields.length,
            applicationId: input.applicationId,
            ats: input.plan.ats,
            confirmedBy: input.confirmedBy,
            userId: input.plan.userId,
          });
        }
      }

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

      if (input.markAttemptSent) {
        tx.update(attempts)
          .set({ endedAt: at, outcome: "sent" })
          .where(eq(attempts.id, input.attempt.id))
          .run();
      }

      return true;
    });

    if (!recorded) {
      return false;
    }

    try {
      recordApplicationVariableCosts(db, { at, userId: input.plan.userId });
    } catch (error) {
      logError("dispatch.cost", error);
    }

    const source = input.confirmedBy === "email" ? "email" : "system";

    recordApplicationEvent(db, clock, {
      applicationId: input.applicationId,
      attemptId: input.attempt.id,
      userId: input.plan.userId,
      kind: "status",
      fromValue: fromStatus,
      toValue: "sent",
      reason: input.confirmedBy === "email" ? "confirmation_email" : "confirmation_page",
      source,
    });
    recordApplicationEvent(db, clock, {
      applicationId: input.applicationId,
      attemptId: input.attempt.id,
      userId: input.plan.userId,
      kind: "stage",
      fromValue: "queued",
      toValue: "applied",
      reason: input.confirmedBy === "email" ? "confirmation_email" : "confirmation_page",
      source,
    });

    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: input.applicationId, status: "sent" }),
      input.plan.userId,
    );
    publishEvent(
      db,
      clock,
      "home.updated",
      JSON.stringify({ applicationId: input.applicationId }),
      input.plan.userId,
    );

    return true;
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

  function confirmationTarget(applicationId: string) {
    return db
      .select({
        userId: applications.userId,
        companyName: applications.companyName,
        companyDomain: applications.companyDomain,
        postingTitle: applications.postingTitle,
      })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();
  }

  async function openedMessage(message: MessageRow) {
    if (message.auth !== "pass" || message.classification === "code") {
      return null;
    }

    const scope = (column: "subject_enc" | "text_enc") => ({
      column,
      rowId: message.id,
      table: "messages",
    });

    const subject = await personal.openFor(
      message.userId,
      scope("subject_enc"),
      message.subjectEnc,
    );

    const text = await personal.openFor(message.userId, scope("text_enc"), message.textEnc);

    return `${subject}\n${text}`.toLowerCase();
  }

  async function applicationEvidence(applicationId: string, message: MessageRow) {
    const target = confirmationTarget(applicationId);

    if (target === undefined) {
      return null;
    }

    const opened = await openedMessage(message);

    return opened === null ? null : confirmationEvidence(target, message, opened);
  }

  function receiptOwner(messageId: string) {
    return db
      .select({ applicationId: applicationReceipts.applicationId })
      .from(applicationReceipts)
      .where(eq(applicationReceipts.messageId, messageId))
      .get();
  }

  async function confirmationCandidates(userId: string, message: MessageRow) {
    const opened = await openedMessage(message);

    if (opened === null) {
      return [];
    }

    const confirming = db
      .select({
        companyDomain: applications.companyDomain,
        companyName: applications.companyName,
        employer: applications.companyNameNorm,
        id: applications.id,
        postingTitle: applications.postingTitle,
      })
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.status, "confirming")))
      .all();

    const perEmployer = new Map<string, number>();

    for (const application of confirming) {
      perEmployer.set(application.employer, (perEmployer.get(application.employer) ?? 0) + 1);
    }

    return confirming.map((application) => {
      const evidence = confirmationEvidence(application, message, opened);

      return {
        applicationId: application.id,
        employerMatched: evidence?.employer ?? false,
        roleMatched: evidence?.role ?? false,
        sharedEmployer: (perEmployer.get(application.employer) ?? 0) > 1,
      };
    });
  }

  async function resolveWithMessage(applicationId: string, message: MessageRow) {
    const application = db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application?.status !== "confirming") {
      return false;
    }

    const attempt = latestAttempt(applicationId);

    if (attempt?.submitClickedAt === null || attempt?.submitClickedAt === undefined) {
      return false;
    }

    if (message.createdAt.getTime() < attempt.submitClickedAt) {
      return false;
    }

    if (message.createdAt.getTime() > attempt.submitClickedAt + confirmWaitMs(db)) {
      return false;
    }

    const evidence = await applicationEvidence(applicationId, message);

    if (evidence === null || (!evidence.employer && !evidence.role)) {
      return false;
    }

    const owner = receiptOwner(message.id);

    if (owner !== undefined && owner.applicationId !== applicationId) {
      return false;
    }

    const approved = await openApprovedPlan({
      applicationId,
      db,
      personal,
      userId: application.userId,
    }).catch(() => null);

    if (approved === null) {
      return false;
    }

    const recorded = await recordSent({
      applicationId,
      attempt,
      approvedAt: approved.approvedAt,
      approvedPlanSha256: approved.sha256,
      confirmedBy: "email",
      costMicros: attempt.costMicros ?? 0,
      markAttemptSent: false,
      plan: approved.plan,
      receiptMessageId: message.id,
    });

    if (!recorded) {
      return false;
    }

    db.update(mailThreads)
      .set({ applicationId })
      .where(and(eq(mailThreads.id, message.threadId), isNull(mailThreads.applicationId)))
      .run();

    return true;
  }

  async function confirmMessage(input: { userId: string; messageId: string }) {
    const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();

    if (message === undefined || message.userId !== input.userId || message.auth !== "pass") {
      return false;
    }

    if (receiptOwner(message.id) !== undefined) {
      return false;
    }

    const target = unambiguousTarget(await confirmationCandidates(input.userId, message));

    if (target === null) {
      return false;
    }

    return resolveWithMessage(target, message);
  }

  async function resolveFromStoredMail(applicationId: string, submitClickedAt: number) {
    const application = db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application === undefined) {
      return false;
    }

    const stored = db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.userId, application.userId),
          eq(messages.auth, "pass"),
          gt(messages.createdAt, new Date(submitClickedAt)),
          lte(messages.createdAt, new Date(submitClickedAt + confirmWaitMs(db))),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .all();

    const used = new Set(
      db
        .select({ messageId: applicationReceipts.messageId })
        .from(applicationReceipts)
        .all()
        .map((receipt) => receipt.messageId),
    );

    const targets = await Promise.all(
      stored.map(async (message) => {
        if (used.has(message.id)) {
          return null;
        }

        const target = unambiguousTarget(await confirmationCandidates(application.userId, message));

        return target === applicationId ? message : null;
      }),
    );

    const target = targets.find((message) => message !== null);

    if (target === undefined) {
      return false;
    }

    return resolveWithMessage(applicationId, target);
  }

  async function expireConfirming() {
    const confirming = db
      .select()
      .from(applications)
      .where(eq(applications.status, "confirming"))
      .all();

    const settled = await Promise.all(
      confirming.map(async (application) => {
        const attempt = latestAttempt(application.id);
        const submittedAt = attempt?.submitClickedAt ?? null;

        if (submittedAt === null) {
          return { application, attempt, resolved: false, submittedAt };
        }

        return {
          application,
          attempt,
          resolved: await resolveFromStoredMail(application.id, submittedAt),
          submittedAt,
        };
      }),
    );

    let expired = 0;
    let confirmed = 0;

    for (const entry of settled) {
      const { application, attempt, submittedAt } = entry;

      if (entry.resolved) {
        confirmed += 1;

        continue;
      }

      if (submittedAt === null || clock.now() < submittedAt + confirmWaitMs(db)) {
        continue;
      }

      db.transaction((tx) => {
        releaseForApplication(tx, clock, {
          applicationId: application.id,
          idempotencyKey: `release:${attempt?.id ?? application.id}`,
          userId: application.userId,
        });

        tx.update(applications)
          .set({
            sentAt: submittedAt,
            stage: null,
            status: "failed",
            statusReason: "unconfirmed",
            updatedAt: clock.now(),
          })
          .where(eq(applications.id, application.id))
          .run();
      });

      try {
        recordApplicationVariableCosts(db, { at: clock.now(), userId: application.userId });
      } catch (error) {
        logError("dispatch.cost", error);
      }

      recordApplicationEvent(db, clock, {
        applicationId: application.id,
        attemptId: attempt?.id ?? null,
        userId: application.userId,
        kind: "status",
        fromValue: "confirming",
        toValue: "failed",
        reason: "confirm_wait_elapsed",
        source: "system",
      });
      recordApplicationEvent(db, clock, {
        applicationId: application.id,
        attemptId: attempt?.id ?? null,
        userId: application.userId,
        kind: "stage",
        fromValue: "queued",
        toValue: null,
        reason: "confirm_wait_elapsed",
        source: "system",
      });

      publishEvent(
        db,
        clock,
        "application.updated",
        JSON.stringify({ applicationId: application.id, status: "failed" }),
        application.userId,
      );
      publishEvent(
        db,
        clock,
        "home.updated",
        JSON.stringify({ applicationId: application.id }),
        application.userId,
      );

      expired += 1;
    }

    return { confirmed, expired };
  }

  return {
    confirmMessage,
    expireConfirming,
    recordSent,
  };
}

export type Outcomes = ReturnType<typeof createOutcomes>;
