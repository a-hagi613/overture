import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { PAUSE_REASONS } from "../../shared/copy.ts";

const chartSchema = z.object({
  labels: z.array(z.string()),
  per: z.enum(["day", "week"]),
  points: z.array(z.object({ at: z.number(), count: z.number() })),
});

const rangeSchema = z.object({
  applicationsSent: z.number(),
  chart: chartSchema,
  interviewsBooked: z.number(),
  replies: z.number(),
  sentDelta: z.number(),
});

const reviewRowSchema = z.object({
  companyCount: z.number(),
  companies: z.array(z.string()),
  id: z.string(),
  prompt: z.string(),
  unlocked: z.number(),
});

const inboxRowSchema = z.object({
  at: z.number(),
  company: z.string(),
  detail: z.string().nullable(),
  id: z.string(),
  kind: z.string(),
  text: z.string(),
});

const homeResponseSchema = z.object({
  activity: z.object({
    failed: z.array(
      z.object({
        at: z.number(),
        company: z.string(),
        id: z.string(),
        reason: z.string(),
        title: z.string(),
      }),
    ),
    sent: z.array(
      z.object({
        at: z.number(),
        company: z.string(),
        id: z.string(),
        status: z.enum(["sent", "confirming"]),
        title: z.string(),
      }),
    ),
  }),
  applicationsLeft: z.number(),
  checkInDue: z.number(),
  dailyCap: z.number(),
  nextSendAt: z.number().nullable(),
  now: z.number(),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  planApplications: z.number(),
  queue: z.object({ position: z.number().nullable(), sendAt: z.number().nullable() }),
  queued: z.number(),
  ready: z.object({
    approved: z.number(),
    companies: z.array(z.string()),
    ready: z.number(),
  }),
  ranges: z.object({ "7D": rangeSchema, "30D": rangeSchema, "90D": rangeSchema }),
  recentInbox: z.array(inboxRowSchema),
  remainingToday: z.number(),
  reviews: z.object({
    applications: z.number(),
    list: z.array(reviewRowSchema),
    total: z.number(),
  }),
  running: z.boolean(),
  sentToday: z.number(),
  strengthen: z.object({ missing: z.number() }).nullable(),
  timeZone: z.string(),
});

export type HomeResponse = z.infer<typeof homeResponseSchema>;

export type HomeRange = z.infer<typeof rangeSchema>;

export type HomeRangeKey = keyof HomeResponse["ranges"];

export type HomeReviewRow = z.infer<typeof reviewRowSchema>;

export type HomeInboxRow = z.infer<typeof inboxRowSchema>;

export type HomeActivitySentRow = HomeResponse["activity"]["sent"][number];

export type HomeActivityFailedRow = HomeResponse["activity"]["failed"][number];

export type HomePauseReason = z.infer<typeof homeResponseSchema>["pauseReason"];

async function loadHome() {
  const response = await fetch("/api/home");

  if (!response.ok) {
    throw new Error(`The home request did not go through (${String(response.status)}).`);
  }

  return homeResponseSchema.parse(await response.json());
}

export function useHomeData() {
  return useQuery({ queryKey: ["home"], queryFn: loadHome });
}

const runningSchema = z.object({ pauseReason: z.string().nullable(), running: z.boolean() });

async function saveRunning(running: boolean) {
  const response = await fetch("/api/running", {
    body: JSON.stringify({ running }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`The running request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return runningSchema.parse(body);
}

export function useRunning() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveRunning,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["home"] });
    },
  });
}
