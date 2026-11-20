import { and, eq, inArray, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

import { reviewApplications, reviews } from "../platform/db/schema.ts";

export interface OpenReviewInput {
  userId: string;
  questionId: string;
  factKey: string | null;
  prompt: string;
  fieldType: QuestionFieldType;
  options: string[];
}

export function ensureOpenReview(db: AppDatabase, clock: Clock, input: OpenReviewInput) {
  const existing = db
    .select({ id: reviews.id })
    .from(reviews)
    .where(
      and(
        eq(reviews.userId, input.userId),
        eq(reviews.questionId, input.questionId),
        eq(reviews.status, "open"),
      ),
    )
    .get();

  if (existing !== undefined) {
    return existing.id;
  }

  const id = crypto.randomUUID();

  db.insert(reviews)
    .values({
      id,
      userId: input.userId,
      questionId: input.questionId,
      factKey: input.factKey,
      prompt: input.prompt,
      fieldType: input.fieldType,
      options: JSON.stringify(input.options),
      status: "open",
      createdAt: clock.now(),
      resolvedAt: null,
    })
    .run();

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
    db.update(reviews)
      .set({ status: "dismissed", resolvedAt: clock.now() })
      .where(and(eq(reviews.id, reviewId), eq(reviews.status, "open")))
      .run();
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
