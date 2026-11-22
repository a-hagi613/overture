import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { LlmPort } from "../platform/ports/llm.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type { SpendGate } from "../billing/spend.ts";

import { isAtsMailDomain } from "../../shared/ats-mail-domains.ts";
import { applications, applicationEvents, mailThreads, messages } from "../platform/db/schema.ts";
import {
  notifyCardMoved,
  notifyEmployerReply,
  notifyInterviewDetected,
  notifyOfferDetected,
} from "../notify/events.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { classifyWithLlm } from "./classify-llm.ts";
import type { MailClassification } from "./codes.ts";
import type { DegradedFlagReader } from "../platform/degraded.ts";

export const MAIL_CLASSIFY_JOB_KIND = "mail.classify";

const STAGE_RANK = new Map<string, number>([
  ["applied", 1],
  ["screening", 2],
  ["interviewing", 3],
  ["offer", 4],
  ["closed", 5],
]);

type MoveStage = "screening" | "interviewing" | "offer" | "closed";

interface MoveTarget {
  stage: MoveStage;
  closedReason: "rejected" | null;
}

type ForwardTargets = Partial<Record<MailClassification, MoveTarget>>;

const FORWARD_TARGETS: ForwardTargets = {
  rejection: { closedReason: "rejected", stage: "closed" },
  screening: { closedReason: null, stage: "screening" },
  interview: { closedReason: null, stage: "interviewing" },
  offer: { closedReason: null, stage: "offer" },
};

const classifyPayloadSchema = z.object({ messageId: z.string().min(1) });

function sameDomain(sender: string, wanted: string) {
  const host = wanted.trim().toLowerCase().replace(/\.$/u, "");
  const from = sender.trim().toLowerCase().replace(/\.$/u, "");

  return host !== "" && (from === host || from.endsWith(`.${host}`));
}

function isForwardMove(from: string, to: string) {
  const fromRank = STAGE_RANK.get(from);
  const toRank = STAGE_RANK.get(to);

  return fromRank !== undefined && toRank !== undefined && toRank > fromRank;
}

export function forwardStageFor(classification: MailClassification) {
  return FORWARD_TARGETS[classification] ?? null;
}

export function createMailMoves(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
  llm: LlmPort;
  degraded?: DegradedFlagReader;
  spendGate?: SpendGate | undefined;
}) {
  const { db, clock, personal, llm, degraded, spendGate } = deps;

  async function contentsOf(message: typeof messages.$inferSelect) {
    return {
      subject: await personal.openFor(
        message.userId,
        { column: "subject_enc", rowId: message.id, table: "messages" },
        message.subjectEnc,
      ),
      text: await personal.openFor(
        message.userId,
        { column: "text_enc", rowId: message.id, table: "messages" },
        message.textEnc,
      ),
    };
  }

  function applicationForThread(threadId: string) {
    return db
      .select({ applicationId: mailThreads.applicationId })
      .from(mailThreads)
      .where(eq(mailThreads.id, threadId))
      .get();
  }

  function matchApplication(input: {
    userId: string;
    senderDomain: string;
    subject: string;
    text: string;
  }) {
    const rows = db
      .select({
        companyDomain: applications.companyDomain,
        companyName: applications.companyName,
        id: applications.id,
        title: applications.postingTitle,
      })
      .from(applications)
      .where(
        and(
          eq(applications.userId, input.userId),
          inArray(applications.status, ["sent", "confirming"]),
          isNotNull(applications.sentAt),
        ),
      )
      .orderBy(desc(applications.sentAt))
      .all();

    const haystack = `${input.subject}\n${input.text}`.toLowerCase();

    for (const row of rows) {
      const domainAccepted =
        isAtsMailDomain(input.senderDomain) ||
        (row.companyDomain !== null && sameDomain(input.senderDomain, row.companyDomain));

      if (!domainAccepted) {
        continue;
      }

      if (haystack.includes(row.companyName.toLowerCase())) {
        return row.id;
      }

      const title = (row.title.split("|")[0] ?? "").trim().toLowerCase();

      if (title.length >= 4 && haystack.includes(title)) {
        return row.id;
      }
    }

    return null;
  }

  function linkThread(input: {
    threadId: string;
    userId: string;
    senderDomain: string;
    subject: string;
    text: string;
  }) {
    const thread = applicationForThread(input.threadId);

    if (thread === undefined) {
      return null;
    }

    if (thread.applicationId !== null) {
      return thread.applicationId;
    }

    const applicationId = matchApplication(input);

    if (applicationId !== null) {
      db.update(mailThreads).set({ applicationId }).where(eq(mailThreads.id, input.threadId)).run();
    }

    return applicationId;
  }

  function applyMove(input: {
    userId: string;
    applicationId: string;
    classification: MailClassification;
  }) {
    const target = forwardStageFor(input.classification);

    if (target === null) {
      return null;
    }

    const row = db
      .select({
        closedReason: applications.closedReason,
        stage: applications.stage,
        stageLocked: applications.stageLocked,
        status: applications.status,
      })
      .from(applications)
      .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.userId)))
      .get();

    if (row === undefined || (row.status !== "sent" && row.status !== "confirming")) {
      return null;
    }

    if (row.stageLocked || row.stage === null || !isForwardMove(row.stage, target.stage)) {
      return null;
    }

    const fromStage = row.stage;
    const now = clock.now();

    db.transaction((tx) => {
      tx.update(applications)
        .set({
          closedReason: target.closedReason,
          stage: target.stage,
          updatedAt: now,
        })
        .where(eq(applications.id, input.applicationId))
        .run();

      tx.insert(applicationEvents)
        .values({
          applicationId: input.applicationId,
          at: now,
          detail: null,
          fromValue: fromStage,
          id: crypto.randomUUID(),
          kind: "stage",
          source: "email",
          toValue: target.stage,
          userId: input.userId,
        })
        .run();
    });

    const context = db
      .select({ company: applications.companyName, title: applications.postingTitle })
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .get();

    publishEvent(
      db,
      clock,
      "board.moved",
      JSON.stringify({
        applicationId: input.applicationId,
        fromStage,
        source: "email",
        stage: target.stage,
      }),
      input.userId,
    );
    publishEvent(
      db,
      clock,
      "application.updated",
      JSON.stringify({ applicationId: input.applicationId }),
      input.userId,
    );

    if (context !== undefined) {
      if (input.classification === "interview") {
        notifyInterviewDetected(db, clock, {
          company: context.company,
          title: context.title,
          userId: input.userId,
        });
      } else if (input.classification === "offer") {
        notifyOfferDetected(db, clock, {
          company: context.company,
          title: context.title,
          userId: input.userId,
        });
      } else {
        notifyCardMoved(db, clock, {
          applicationId: input.applicationId,
          company: context.company,
          stage: target.stage,
          title: context.title,
          userId: input.userId,
        });
      }
    }

    return { fromStage, stage: target.stage };
  }

  async function linkMessage(input: { userId: string; messageId: string }) {
    const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();

    if (message === undefined || message.userId !== input.userId) {
      return null;
    }

    const thread = applicationForThread(message.threadId);

    if (thread !== undefined && thread.applicationId !== null) {
      return thread.applicationId;
    }

    const contents = await contentsOf(message);

    return linkThread({
      senderDomain: message.senderDomain,
      subject: contents.subject,
      text: contents.text,
      threadId: message.threadId,
      userId: message.userId,
    });
  }

  function applicationContextOf(applicationId: string) {
    return db
      .select({
        company: applications.companyName,
        title: applications.postingTitle,
        userId: applications.userId,
      })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();
  }

  function notifyReplyFor(applicationId: string) {
    const context = applicationContextOf(applicationId);

    if (context !== undefined) {
      notifyEmployerReply(db, clock, {
        company: context.company,
        title: context.title,
        userId: context.userId,
      });
    }
  }

  async function handleAuthenticatedMessage(input: { userId: string; messageId: string }) {
    const message = db.select().from(messages).where(eq(messages.id, input.messageId)).get();

    if (message === undefined) {
      return;
    }

    if (message.userId !== input.userId || message.auth !== "pass") {
      return;
    }

    const applicationId = await linkMessage(input);

    if (message.classification === "code") {
      return;
    }

    if (message.classification === "other" || message.classification === null) {
      if (isAtsMailDomain(message.senderDomain)) {
        enqueueJob(db, clock, MAIL_CLASSIFY_JOB_KIND, JSON.stringify({ messageId: message.id }), {
          dedupeKey: `mail.classify:${message.id}`,
          maxAttempts: 2,
        });

        return;
      }

      if (message.classification === "other" && applicationId !== null) {
        notifyReplyFor(applicationId);
      }

      return;
    }

    if (applicationId !== null) {
      applyMove({
        applicationId,
        classification: message.classification,
        userId: message.userId,
      });
    }
  }

  async function runClassification(payload: string) {
    const job = classifyPayloadSchema.parse(JSON.parse(payload));
    const message = db.select().from(messages).where(eq(messages.id, job.messageId)).get();

    if (message === undefined) {
      return;
    }

    if (
      message.auth !== "pass" ||
      (message.classification !== "other" && message.classification !== null)
    ) {
      return;
    }

    const contents = await contentsOf(message);

    const classification = await classifyWithLlm(
      { clock, db, degraded, llm, spendGate },
      {
        messageId: message.id,
        subject: contents.subject,
        text: contents.text,
        userId: message.userId,
      },
    );

    if (classification === "other") {
      const thread = applicationForThread(message.threadId);

      if (thread?.applicationId !== undefined && thread.applicationId !== null) {
        notifyReplyFor(thread.applicationId);
      }

      return;
    }

    db.update(messages).set({ classification }).where(eq(messages.id, message.id)).run();

    const thread = applicationForThread(message.threadId);
    const applicationId = thread?.applicationId ?? null;

    if (applicationId !== null) {
      applyMove({
        applicationId,
        classification,
        userId: message.userId,
      });
    }

    publishEvent(
      db,
      clock,
      "message.received",
      JSON.stringify({
        classification,
        messageId: message.id,
        threadId: message.threadId,
      }),
      message.userId,
    );
  }

  return { handleAuthenticatedMessage, linkMessage, runClassification };
}

export type MailMoves = ReturnType<typeof createMailMoves>;
