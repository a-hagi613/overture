import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { QuestionFieldType, ReviewReason } from "../../shared/questions.ts";

import { reviewApplications, reviews } from "../platform/db/schema.ts";
import type { ReviewAuditAts } from "./review-events.ts";
import { recordReviewOpened, recordReviewResolved, reviewWasAnswered } from "./review-events.ts";

export interface OpenReviewInput {
  userId: string;
  questionId: string;
  factKey: string | null;
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
  scope: string;
  reason: ReviewReason;
  /** The attempt whose live-form check asked for this Fact, if any. */
  attemptId?: string | null;
  ats: ReviewAuditAts | null;
}

export function ensureOpenReview(db: AppDatabase, clock: Clock, input: OpenReviewInput) {
  const existing = db
    .select({ id: reviews.id, reason: reviews.reason })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, input.userId),
        eq(reviews.questionId, input.questionId),
        eq(reviews.scope, input.scope),
        eq(reviews.status, "open"),
      ),
    )
    .get();

  if (existing !== undefined) {
    const updates: Partial<typeof reviews.$inferInsert> = {};
    const attemptId = input.attemptId ?? null;

    if (existing.reason !== input.reason) {
      updates.reason = input.reason;
    }

    if (attemptId !== null) {
      updates.attemptId = attemptId;
    }

    if (Object.keys(updates).length > 0) {
      db.update(reviews).set(updates).where(eq(reviews.id, existing.id)).run();
    }

    return existing.id;
  }

  const id = crypto.randomUUID();

  const repeat = reviewWasAnswered(db, input.userId, input.questionId, input.scope);

  db.insert(reviews)
    .values({
      id,
      userId: input.userId,
      questionId: input.questionId,
      factKey: input.factKey,
      scope: input.scope,
      prompt: input.prompt,
      fieldType: input.fieldType,
      options: JSON.stringify(input.options),
      reason: input.reason,
      status: "open",
      createdAt: clock.now(),
      resolvedAt: null,
      attemptId: input.attemptId ?? null,
    })
    .run();

  recordReviewOpened(db, clock, {
    ats: input.ats,
    factKey: input.factKey,
    questionId: input.questionId,
    reason: input.reason,
    repeat,
    reviewId: id,
    scope: input.scope,
    userId: input.userId,
  });

  return id;
}

export function attachApplication(db: AppDatabase, reviewId: string, applicationId: string) {
  db.insert(reviewApplications).values({ reviewId, applicationId }).onConflictDoNothing().run();
}

export function openReviewsForApplication(db: AppDatabase, userId: string, applicationId: string) {
  return db
    .select({
      id: reviews.id,
      questionId: reviews.questionId,
      prompt: reviews.prompt,
      fieldType: reviews.fieldType,
      options: reviews.options,
      factKey: reviews.factKey,
      scope: reviews.scope,
    })
    .from(reviews)
    .innerJoin(reviewApplications, eq(reviewApplications.reviewId, reviews.id))
    .where(and(eq(reviews.userId, userId), eq(reviewApplications.applicationId, applicationId)))
    .all();
}

export function detachApplication(db: AppDatabase, reviewId: string, applicationId: string) {
  db.delete(reviewApplications)
    .where(
      and(
        eq(reviewApplications.reviewId, reviewId),
        eq(reviewApplications.applicationId, applicationId),
      ),
    )
    .run();
}

export function attachmentCount(db: AppDatabase, reviewId: string) {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(reviewApplications)
    .where(eq(reviewApplications.reviewId, reviewId))
    .get();

  return row?.count ?? 0;
}

export function dismissEmptyReview(db: AppDatabase, clock: Clock, reviewId: string) {
  if (attachmentCount(db, reviewId) === 0) {
    const review = db
      .select({ userId: reviews.userId, questionId: reviews.questionId, status: reviews.status })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .get();

    if (review?.status !== "open") {
      return;
    }

    db.update(reviews)
      .set({ status: "dismissed", resolvedAt: clock.now() })
      .where(and(eq(reviews.id, reviewId), eq(reviews.status, "open")))
      .run();

    recordReviewResolved(db, clock, {
      questionId: review.questionId,
      resolution: "auto_dismissed",
      reviewId,
      userId: review.userId,
    });
  }
}

export function applicationIdsForReview(db: AppDatabase, reviewId: string) {
  return db
    .select({ applicationId: reviewApplications.applicationId })
    .from(reviewApplications)
    .where(eq(reviewApplications.reviewId, reviewId))
    .all()
    .map((row) => row.applicationId);
}

export function openReviewIds(db: AppDatabase, userId: string) {
  return db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
    .all()
    .map((row) => row.id);
}

export function reviewIdsWithApplications(
  db: AppDatabase,
  reviewIds: readonly string[],
  applicationIds: readonly string[],
) {
  if (reviewIds.length === 0 || applicationIds.length === 0) {
    return [];
  }

  return db
    .select({ reviewId: reviewApplications.reviewId })
    .from(reviewApplications)
    .where(
      and(
        inArray(reviewApplications.reviewId, [...reviewIds]),
        inArray(reviewApplications.applicationId, [...applicationIds]),
      ),
    )
    .all();
}
