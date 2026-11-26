import { and, asc, desc, eq, like } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { ledgerBalances } from "../billing/ledger.ts";
import type { LedgerBalances } from "../billing/ledger.ts";
import { readApplicationTimeline } from "../applications/events.ts";
import { listApplicationScreenshots } from "../applications/screenshots.ts";
import {
  applicationReceipts,
  applicationSnapshots,
  applications,
  attempts,
  bgJobs,
  grants,
  ledger,
  mailThreads,
  messages,
} from "../platform/db/schema.ts";

export interface ApplicationLookupDeps {
  clock: Clock;
  db: AppDatabase;
  objects: ObjectStore;
  personal: PersonalCrypto;
}

export interface ApplicationLookup {
  now: number;
  application: {
    id: string;
    userId: string;
    companyName: string;
    postingTitle: string;
    postingUrl: string;
    ats: string | null;
    origin: string;
    status: string;
    statusReason: string | null;
    stage: string | null;
    stageLocked: boolean;
    attempts: number;
    scoreAtQueue: number | null;
    scheduledFor: number | null;
    createdAt: number;
    updatedAt: number;
    readyAt: number | null;
    approvedAt: number | null;
    sentAt: number | null;
    closedReason: string | null;
    cost: {
      browserMicros: number;
      retryMicros: number;
      llmMicros: number;
      recordedAt: number | null;
    };
  } | null;
  timeline: ReturnType<typeof readApplicationTimeline>;
  queue: {
    scheduledFor: number | null;
    jobs: {
      id: string;
      kind: string;
      status: string;
      runAt: number;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      createdAt: number;
      updatedAt: number;
    }[];
  };
  attempts: {
    id: string;
    n: number;
    provider: string;
    providerSessionId: string | null;
    startedAt: number;
    endedAt: number | null;
    submitClickedAt: number | null;
    submitResponseStatus: number | null;
    outcome: string | null;
    errorCode: string | null;
    browserMs: number | null;
    costMicros: number | null;
  }[];
  confirmation: {
    snapshot: {
      submittedAt: number;
      confirmedBy: string;
      consentVersion: string;
      approvedAt: number | null;
      costMicros: number;
      provider: string;
    } | null;
    receipt: { messageId: string; confirmedAt: number } | null;
  };
  balance: {
    balances: LedgerBalances;
    ledger: {
      id: string;
      kind: string;
      amount: number;
      grantId: string;
      debitAccount: string;
      creditAccount: string;
      createdAt: number;
    }[];
    grants: {
      id: string;
      source: string;
      quantity: number;
      startsAt: number;
      expiresAt: number | null;
    }[];
  } | null;
  mail: {
    threads: {
      id: string;
      subject: string | null;
      employerStarted: boolean;
      lastMessageAt: number;
      messages: {
        id: string;
        direction: string;
        senderDomain: string;
        auth: string;
        classification: string | null;
        outStatus: string | null;
        subject: string | null;
        createdAt: number;
      }[];
    }[];
  }[];
  screenshots: {
    key: string;
    phase: string;
    at: number;
    attemptId: string;
    bytes: number | null;
  }[];
}

/**
 * The support lookup behind one Application id: the timeline, queue and planner
 * jobs, send attempts, deploy interruption and recovery, confirmation,
 * balance/ledger and linked mail, plus the Submit screenshots. Mail subjects are
 * opened for the admin only and a value that cannot be opened stays null.
 */
export async function lookupApplication(
  deps: ApplicationLookupDeps,
  applicationId: string,
): Promise<ApplicationLookup | null> {
  const { db, objects, personal } = deps;
  const row = db.select().from(applications).where(eq(applications.id, applicationId)).get();

  if (row === undefined) {
    return null;
  }

  const timeline = readApplicationTimeline(db, applicationId);
  const attemptRows = db
    .select()
    .from(attempts)
    .where(eq(attempts.applicationId, applicationId))
    .orderBy(asc(attempts.startedAt), asc(attempts.id))
    .all();

  const jobRows = db
    .select()
    .from(bgJobs)
    .where(like(bgJobs.payload, `%${applicationId}%`))
    .orderBy(desc(bgJobs.updatedAt), desc(bgJobs.id))
    .limit(50)
    .all();

  const snapshot = db
    .select()
    .from(applicationSnapshots)
    .where(eq(applicationSnapshots.applicationId, applicationId))
    .get();
  const receipt = db
    .select()
    .from(applicationReceipts)
    .where(eq(applicationReceipts.applicationId, applicationId))
    .get();

  const threadRows = db
    .select()
    .from(mailThreads)
    .where(eq(mailThreads.applicationId, applicationId))
    .orderBy(desc(mailThreads.lastMessageAt), asc(mailThreads.id))
    .all();

  const mail = await Promise.all(
    threadRows.map(async (thread) => {
      const messageRows = db
        .select()
        .from(messages)
        .where(eq(messages.threadId, thread.id))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .all();

      const opened = await Promise.all(
        messageRows.map(async (message) => {
          const subject = await personal
            .openFor(
              message.userId,
              { column: "subject_enc", rowId: message.id, table: "messages" },
              message.subjectEnc,
            )
            .catch(() => null);

          return {
            auth: message.auth,
            classification: message.classification,
            createdAt: message.createdAt.getTime(),
            direction: message.direction,
            id: message.id,
            outStatus: message.outStatus,
            senderDomain: message.senderDomain,
            subject,
          };
        }),
      );

      return {
        employerStarted: thread.employerStarted,
        id: thread.id,
        lastMessageAt: thread.lastMessageAt.getTime(),
        messages: opened,
        subject: await personal
          .openFor(
            row.userId,
            { column: "subject_enc", rowId: thread.id, table: "mail_threads" },
            thread.subjectEnc,
          )
          .catch(() => null),
      };
    }),
  );

  const ledgerRows = db
    .select()
    .from(ledger)
    .where(and(eq(ledger.userId, row.userId), eq(ledger.applicationId, applicationId)))
    .orderBy(asc(ledger.createdAt), asc(ledger.id))
    .all();

  const grantRows = db
    .select()
    .from(grants)
    .where(eq(grants.userId, row.userId))
    .orderBy(desc(grants.startsAt), asc(grants.id))
    .all();

  return {
    application: {
      approvedAt: row.approvedAt,
      ats: row.ats,
      attempts: row.attempts,
      closedReason: row.closedReason,
      companyName: row.companyName,
      cost: {
        browserMicros: row.browserCostMicros,
        llmMicros: row.llmCostMicros,
        recordedAt: row.costRecordedAt,
        retryMicros: row.retryCostMicros,
      },
      createdAt: row.createdAt,
      id: row.id,
      origin: row.origin,
      postingTitle: row.postingTitle,
      postingUrl: row.postingUrl,
      readyAt: row.readyAt,
      scheduledFor: row.scheduledFor,
      scoreAtQueue: row.scoreAtQueue,
      sentAt: row.sentAt,
      stage: row.stage,
      stageLocked: row.stageLocked,
      status: row.status,
      statusReason: row.statusReason,
      updatedAt: row.updatedAt,
      userId: row.userId,
    },
    attempts: attemptRows.map((attempt) => ({
      browserMs: attempt.browserMs,
      costMicros: attempt.costMicros,
      endedAt: attempt.endedAt,
      errorCode: attempt.errorCode,
      id: attempt.id,
      n: attempt.n,
      outcome: attempt.outcome,
      provider: attempt.provider,
      providerSessionId: attempt.providerSessionId,
      startedAt: attempt.startedAt,
      submitClickedAt: attempt.submitClickedAt,
      submitResponseStatus: attempt.submitResponseStatus,
    })),
    balance: {
      balances: ledgerBalances(db, row.userId),
      grants: grantRows.map((grant) => ({
        expiresAt: grant.expiresAt,
        id: grant.id,
        quantity: grant.quantity,
        source: grant.source,
        startsAt: grant.startsAt,
      })),
      ledger: ledgerRows.map((entry) => ({
        amount: entry.amount,
        createdAt: entry.createdAt,
        creditAccount: entry.creditAccount,
        debitAccount: entry.debitAccount,
        grantId: entry.grantId,
        id: entry.id,
        kind: entry.kind,
      })),
    },
    confirmation: {
      receipt:
        receipt === undefined
          ? null
          : { confirmedAt: receipt.confirmedAt, messageId: receipt.messageId },
      snapshot:
        snapshot === undefined
          ? null
          : {
              approvedAt: snapshot.approvedAt,
              confirmedBy: snapshot.confirmedBy,
              consentVersion: snapshot.consentVersion,
              costMicros: snapshot.costMicros,
              provider: snapshot.provider,
              submittedAt: snapshot.submittedAt,
            },
    },
    mail,
    now: deps.clock.now(),
    queue: {
      jobs: jobRows.map((job) => ({
        attempts: job.attempts,
        createdAt: job.createdAt,
        id: job.id,
        kind: job.kind,
        lastError: job.lastError,
        maxAttempts: job.maxAttempts,
        runAt: job.runAt,
        status: job.status,
        updatedAt: job.updatedAt,
      })),
      scheduledFor: row.scheduledFor,
    },
    screenshots: (await listApplicationScreenshots(objects, row.userId, applicationId)).map(
      (screenshot) => ({
        at: screenshot.at,
        attemptId: screenshot.attemptId,
        bytes: screenshot.bytes,
        key: screenshot.key,
        phase: screenshot.phase,
      }),
    ),
    timeline,
  };
}
