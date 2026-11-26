import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { QUESTION_FIELD_TYPES, REVIEW_CATEGORIES } from "../../shared/questions.ts";

const reviewApplicationSchema = z.object({
  applicationId: z.string(),
  company: z.string(),
  title: z.string(),
  postingId: z.string(),
});

const reviewSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  fieldType: z.enum(QUESTION_FIELD_TYPES),
  options: z.array(z.string()),
  factKey: z.string().nullable(),
  scope: z.string(),
  factLabel: z.string().nullable(),
  category: z.enum(REVIEW_CATEGORIES),
  unlocked: z.number(),
  companies: z.number(),
  applications: z.array(reviewApplicationSchema),
  saveForFutureDefault: z.boolean(),
  createdAt: z.number(),
});

export const reviewsResponseSchema = z.object({
  reviews: z.array(reviewSchema),
  totalApplications: z.number(),
});

export type Review = z.infer<typeof reviewSchema>;

export type ReviewsResponse = z.infer<typeof reviewsResponseSchema>;

export interface ReviewApplicationGroup {
  applicationId: string;
  company: string;
  title: string;
  postingId: string;
  questions: Review[];
}

const answerResponseSchema = z.object({
  reviewId: z.string(),
  applicationIds: z.array(z.string()),
  readyCount: z.number(),
  saveForFuture: z.boolean(),
  factKey: z.string().nullable(),
  scope: z.string(),
});

export type ReviewAnswerResult = z.infer<typeof answerResponseSchema>;

const batchAnswerResponseSchema = z.object({
  answers: z.array(answerResponseSchema.omit({ readyCount: true })),
  applicationIds: z.array(z.string()),
  readyCount: z.number(),
});

export type ReviewBatchAnswerResult = z.infer<typeof batchAnswerResponseSchema>;

/**
 * Folds the open Reviews into one card per Application. A shared question is the
 * same Review attached to several Applications, so it appears in each card but
 * is answered once for all of them.
 * @param reviews The open Reviews, each listing the Applications waiting on it.
 * @returns Applications with at least one open question, most questions first.
 */
export function groupReviewsByApplication(reviews: readonly Review[]) {
  const groups = new Map<string, ReviewApplicationGroup>();

  for (const review of reviews) {
    for (const application of review.applications) {
      const existing = groups.get(application.applicationId);

      if (existing === undefined) {
        groups.set(application.applicationId, {
          applicationId: application.applicationId,
          company: application.company,
          title: application.title,
          postingId: application.postingId,
          questions: [review],
        });

        continue;
      }

      existing.questions.push(review);
    }
  }

  const grouped = [...groups.values()];

  for (const group of grouped) {
    group.questions.sort((left, right) => left.createdAt - right.createdAt);
  }

  return grouped.toSorted(
    (left, right) =>
      right.questions.length - left.questions.length ||
      left.company.localeCompare(right.company) ||
      left.title.localeCompare(right.title),
  );
}

/**
 * Counts how many Applications beyond this one wait on the same question.
 * @param review A Review attached to one or more Applications.
 * @param applicationId The Application whose form is open.
 * @returns The number of other Applications the answer also fills.
 */
export function sharedApplicationCount(review: Review, applicationId: string) {
  return review.applications.filter((application) => application.applicationId !== applicationId)
    .length;
}

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The Review request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchReviews() {
  return reviewsResponseSchema.parse(await jsonFrom(await fetch("/api/reviews")));
}

export async function answerReview(reviewId: string, value: string, saveForFuture: boolean) {
  return answerResponseSchema.parse(
    await jsonFrom(
      await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ saveForFuture, value }),
      }),
    ),
  );
}

export async function answerReviewBatch(
  answers: readonly { reviewId: string; value: string; saveForFuture: boolean }[],
) {
  return batchAnswerResponseSchema.parse(
    await jsonFrom(
      await fetch("/api/reviews/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      }),
    ),
  );
}

export async function dismissReview(reviewId: string) {
  return jsonFrom(
    await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  );
}

export function useReviews() {
  return useQuery({ queryKey: ["reviews"], queryFn: fetchReviews });
}
