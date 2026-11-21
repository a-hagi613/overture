import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { SendPlan } from "../pipeline/send-plan.ts";

import { isAtsMailDomain } from "../../shared/ats-mail-domains.ts";
import {
  applications,
  applicationEvents,
  applicationSnapshots,
  attempts,
  companies,
  mailThreads,
  messages,
  postings,
} from "../platform/db/schema.ts";
import { commitForApplication, releaseForApplication } from "../billing/ledger.ts";
import { getSetting } from "../platform/settings/index.ts";
import { recordSnapshotSent } from "../pipeline/review-events.ts";
import { publishEvent } from "../platform/sse/stream.ts";

const HOUR_MS = 60 * 60_000;

type AttemptRow = typeof attempts.$inferSelect;

type MessageRow = typeof messages.$inferSelect;

export interface OutcomeDeps {
  db: AppDatabase;
  clock: Clock;
  preparation: PreparationService;
  personal: PersonalCrypto;
}

export function recordApplicationEvent(
  db: AppDatabase,
  clock: Clock,
  input: {
    applicationId: string;
    userId: string;
    kind: "status" | "stage" | "email";
    fromValue: string | null;
    toValue: string | null;
    source: "system" | "email" | "user" | "admin";
  },
) {
  db.insert(applicationEvents)
    .values({
      applicationId: input.applicationId,
      at: clock.now(),
      fromValue: input.fromValue,
      id: crypto.randomUUID(),
      kind: input.kind,
      source: input.source,
      toValue: input.toValue,
      userId: input.userId,
    })
    .run();
}

function confirmWaitMs(db: AppDatabase) {
  const parsed = Number(getSetting(db, "limits.confirm_wait_hours"));

  return (Number.isFinite(parsed) && parsed > 0 ? parsed : 24) * HOUR_MS;
}

function sameDomain(sender: string, wanted: string) {
  const host = wanted.trim().toLowerCase().replace(/\.$/u, "");
  const from = sender.trim().toLowerCase().replace(/\.$/u, "");

  return host !== "" && (from === host || from.endsWith(`.${host}`));
}

export function createOutcomes(deps: OutcomeDeps) {
  const { db, clock, preparation, personal } = deps;

  async function sealSnapshot(
    applicationId: string,
    userId: string,
    attempt: AttemptRow,
    plan: SendPlan,
    confirmedBy: "page" | "email",
    costMicros: number,
  ) {
    if (plan.resume === null) {
      return null;
    }

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
                resume_line_ids: sentence.resumeLineIds,
                sentence: sentence.sentence,
              })),
            ),
          );

    return {
      answersEnc,
      applicationId,
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
    costMicros: number;
    confirmedBy: "page" | "email";
    markAttemptSent: boolean;
  }) {
    const at = clock.now();
    const submittedAt = input.attempt.submitClickedAt ?? at;
    const fromStatus = input.confirmedBy === "email" ? "confirming" : "sending";

    const snapshot = await sealSnapshot(
      input.applicationId,
      input.plan.userId,
      input.attempt,
      input.plan,
      input.confirmedBy,
      input.costMicros,
    );

    db.transaction((tx) => {
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
    });

    const source = input.confirmedBy === "email" ? "email" : "system";

    recordApplicationEvent(db, clock, {
      applicationId: input.applicationId,
      userId: input.plan.userId,
      kind: "status",
      fromValue: fromStatus,
      toValue: "sent",
      source,
    });
    recordApplicationEvent(db, clock, {
      applicationId: input.applicationId,
      userId: input.plan.userId,
      kind: "stage",
      fromValue: "queued",
      toValue: "applied",
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
        companyName: companies.name,
        companyDomain: companies.domain,
        postingTitle: postings.title,
      })
      .from(applications)
      .innerJoin(postings, eq(postings.id, applications.postingId))
      .innerJoin(companies, eq(companies.id, applications.companyId))
      .where(eq(applications.id, applicationId))
      .get();
  }

  async function matchesConfirmation(applicationId: string, message: MessageRow) {
    if (message.auth !== "pass" || message.classification === "code") {
      return false;
    }

    const target = confirmationTarget(applicationId);

    if (target === undefined) {
      return false;
    }

    const domainAccepted =
      isAtsMailDomain(message.senderDomain) ||
      (target.companyDomain !== null && sameDomain(message.senderDomain, target.companyDomain));

    if (!domainAccepted) {
      return false;
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
    const haystack = `${subject}\n${text}`.toLowerCase();

    if (haystack.includes(target.companyName.toLowerCase())) {
      return true;
    }

    const title = (target.postingTitle.split("|")[0] ?? "").trim().toLowerCase();

    return title.length >= 4 && haystack.includes(title);
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

    if (!(await matchesConfirmation(applicationId, message))) {
      return false;
    }

    const plan = await preparation.sendPlanFor(applicationId);

    if (plan === null) {
      return false;
    }

    db.update(mailThreads)
      .set({ applicationId })
      .where(and(eq(mailThreads.id, message.threadId), isNull(mailThreads.applicationId)))
      .run();

    await recordSent({
      applicationId,
      attempt,
      confirmedBy: "email",
      costMicros: attempt.costMicros ?? 0,
      markAttemptSent: false,
      plan,
    });

    return true;
  }

  async function confirmMessage(input: { userId: string; messageId: string }) {
    const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();

    if (message === undefined || message.userId !== input.userId || message.auth !== "pass") {
      return false;
    }

    const confirming = db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.userId, input.userId), eq(applications.status, "confirming")))
      .all();

    const matches = await Promise.all(
      confirming.map(async (application) => ({
        id: application.id,
        matched: await matchesConfirmation(application.id, message),
      })),
    );

    const target = matches.find((match) => match.matched);

    if (target === undefined) {
      return false;
    }

    return resolveWithMessage(target.id, message);
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

    const matches = await Promise.all(
      stored.map(async (message) => ({
        matched: await matchesConfirmation(applicationId, message),
        message,
      })),
    );

    const target = matches.find((match) => match.matched);

    if (target === undefined) {
      return false;
    }

    return resolveWithMessage(applicationId, target.message);
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

      recordApplicationEvent(db, clock, {
        applicationId: application.id,
        userId: application.userId,
        kind: "status",
        fromValue: "confirming",
        toValue: "failed",
        source: "system",
      });
      recordApplicationEvent(db, clock, {
        applicationId: application.id,
        userId: application.userId,
        kind: "stage",
        fromValue: "queued",
        toValue: null,
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
