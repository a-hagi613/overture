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
  createdAt: z.number(),
});

export const reviewsResponseSchema = z.object({
  reviews: z.array(reviewSchema),
  totalApplications: z.number(),
});

export type Review = z.infer<typeof reviewSchema>;

export type ReviewsResponse = z.infer<typeof reviewsResponseSchema>;

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

export async function answerReview(reviewId: string, value: string) {
  return jsonFrom(
    await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    }),
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
