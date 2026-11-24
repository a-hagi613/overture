import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { ReviewReason } from "../../shared/questions.ts";
import type { ApplySupportedAts } from "../../shared/ats.ts";
import type { AnswerSource } from "./answer-plan.ts";

import { reviewAuditEvents, reviews } from "../platform/db/schema.ts";

export type ReviewAuditWriter = Pick<AppDatabase, "insert" | "select">;

export type ReviewAuditAts = ApplySupportedAts;

export type ReviewResolution = "answered" | "dismissed" | "auto_dismissed";

function insertEvent(
  db: ReviewAuditWriter,
  clock: Clock,
  input: {
    userId: string;
    kind: "review_opened" | "review_resolved" | "auto_answer" | "snapshot_sent";
    applicationId?: string | null;
    reviewId?: string | null;
    questionId?: string | null;
    ats?: ReviewAuditAts | null;
    source?: AnswerSource | null;
    factKey?: string | null;
    factRevision?: number | null;
    scope?: string;
    detail?: {
      reason?: string;
      repeat?: boolean;
      resolution?: string;
      answers?: number;
      confirmedBy?: string;
    };
  },
) {
  db.insert(reviewAuditEvents)
    .values({
      applicationId: input.applicationId ?? null,
      at: clock.now(),
      ats: input.ats ?? null,
      detail: JSON.stringify(input.detail ?? {}),
      factKey: input.factKey ?? null,
      factRevision: input.factRevision ?? null,
      id: crypto.randomUUID(),
      kind: input.kind,
      questionId: input.questionId ?? null,
      reviewId: input.reviewId ?? null,
      scope: input.scope ?? "",
      source: input.source ?? null,
      userId: input.userId,
    })
    .run();
}

export function reviewWasAnswered(
  db: ReviewAuditWriter,
  userId: string,
  questionId: string,
  scope: string,
) {
  return (
    db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.userId, userId),
          eq(reviews.questionId, questionId),
          eq(reviews.scope, scope),
          eq(reviews.status, "answered"),
        ),
      )
      .get() !== undefined
  );
}

export function recordReviewOpened(
  db: ReviewAuditWriter,
  clock: Clock,
  input: {
    userId: string;
    reviewId: string;
    questionId: string;
    ats: ReviewAuditAts | null;
    factKey: string | null;
    scope: string;
    reason: ReviewReason;
    repeat: boolean;
  },
) {
  insertEvent(db, clock, {
    ats: input.ats,
    detail: { reason: input.reason, repeat: input.repeat },
    factKey: input.factKey,
    kind: "review_opened",
    questionId: input.questionId,
    reviewId: input.reviewId,
    scope: input.scope,
    userId: input.userId,
  });
}

export function recordReviewResolved(
  db: ReviewAuditWriter,
  clock: Clock,
  input: {
    userId: string;
    reviewId: string;
    questionId: string;
    resolution: ReviewResolution;
  },
) {
  insertEvent(db, clock, {
    detail: { resolution: input.resolution },
    kind: "review_resolved",
    questionId: input.questionId,
    reviewId: input.reviewId,
    userId: input.userId,
  });
}

export function recordAutoAnswer(
  db: ReviewAuditWriter,
  clock: Clock,
  input: {
    userId: string;
    applicationId: string;
    questionId: string;
    ats: ReviewAuditAts;
    source: AnswerSource;
    factKey: string | null;
    factRevision: number | null;
    scope: string;
  },
) {
  insertEvent(db, clock, {
    applicationId: input.applicationId,
    ats: input.ats,
    factKey: input.factKey,
    factRevision: input.factRevision,
    kind: "auto_answer",
    questionId: input.questionId,
    scope: input.scope,
    source: input.source,
    userId: input.userId,
  });
}

export function recordSnapshotSent(
  db: ReviewAuditWriter,
  clock: Clock,
  input: {
    userId: string;
    applicationId: string;
    ats: ReviewAuditAts;
    answers: number;
    confirmedBy: "page" | "email";
  },
) {
  insertEvent(db, clock, {
    applicationId: input.applicationId,
    ats: input.ats,
    detail: { answers: input.answers, confirmedBy: input.confirmedBy },
    kind: "snapshot_sent",
    userId: input.userId,
  });
}
