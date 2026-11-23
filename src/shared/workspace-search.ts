import { z } from "zod";

import { BOARD_STAGES } from "./board.ts";
import { REVIEW_CATEGORIES } from "./questions.ts";

export const APPLICATION_SEARCH_STATUSES = [
  "preparing",
  "needs_review",
  "ready",
  "approved",
  "sending",
  "confirming",
  "sent",
  "failed",
  "skipped",
  "withdrawn",
] as const;

export const workspaceApplicationResult = z.object({
  company: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  score: z.number().nullable(),
  stage: z.enum(BOARD_STAGES).nullable(),
  status: z.enum(APPLICATION_SEARCH_STATUSES),
  title: z.string(),
});

export const workspaceReviewResult = z.object({
  category: z.enum(REVIEW_CATEGORIES),
  id: z.string(),
  prompt: z.string(),
  unlockedCount: z.number().int().nonnegative(),
});

export const workspaceEmailResult = z.object({
  company: z.string().nullable(),
  id: z.string(),
  receivedAt: z.number().int(),
  snippet: z.string(),
  subject: z.string(),
  threadId: z.string(),
});

export const workspaceInterviewResult = z.object({
  applicationId: z.string(),
  company: z.string(),
  endsAt: z.number().int().nullable(),
  id: z.string(),
  location: z.string().nullable(),
  startsAt: z.number().int(),
  summary: z.string(),
  title: z.string(),
});

export const workspaceSearchResponse = z.object({
  applications: z.array(workspaceApplicationResult),
  emails: z.array(workspaceEmailResult),
  interviews: z.array(workspaceInterviewResult),
  query: z.string(),
  reviews: z.array(workspaceReviewResult),
});

export type WorkspaceSearchResponse = z.infer<typeof workspaceSearchResponse>;
