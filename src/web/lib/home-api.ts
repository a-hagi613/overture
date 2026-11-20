import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const upNextSchema = z.object({
  id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  workplace: z.string(),
  employmentType: z.string(),
  salaryMinMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.string().nullable(),
  codeRank: z.number(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
  strong: z.boolean(),
  saved: z.boolean(),
});

const homeResponseSchema = z.object({
  applicationsLeft: z.number(),
  planApplications: z.number(),
  sentToday: z.number(),
  dailyCap: z.number(),
  remainingToday: z.number(),
  upNext: z.array(upNextSchema),
});

const applySchema = z.object({ applicationId: z.string(), created: z.boolean() });

const stateSchema = z.object({ id: z.string(), state: z.enum(["saved", "hidden"]).nullable() });

const postingSchema = z.object({
  id: z.string(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
  applicationId: z.string().nullable(),
});

export type HomeResponse = z.infer<typeof homeResponseSchema>;

export type UpNextPosting = z.infer<typeof upNextSchema>;

async function loadHome() {
  const response = await fetch("/api/home");

  if (!response.ok) {
    throw new Error(`The home request did not go through (${String(response.status)}).`);
  }

  return homeResponseSchema.parse(await response.json());
}

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The home request did not go through (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

export function useHomeData() {
  return useQuery({ queryKey: ["home"], queryFn: loadHome });
}

export async function fetchHome() {
  return loadHome();
}

export async function openPosting(postingId: string) {
  return postingSchema.parse(await jsonFrom(await fetch(`/api/postings/${postingId}`)));
}

export async function applyToPosting(postingId: string) {
  return applySchema.parse(
    await jsonFrom(
      await fetch(`/api/postings/${postingId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    ),
  );
}

export async function savePosting(postingId: string, state: "saved" | "hidden" | null) {
  return stateSchema.parse(
    await jsonFrom(
      await fetch(`/api/postings/${postingId}/state`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      }),
    ),
  );
}
