import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { OnboardingFactsInput } from "../../shared/onboarding.ts";

import { SALARY_PERIOD_WORDS } from "../../shared/onboarding.ts";

const resumeSchema = z.object({
  bytes: z.number(),
  filename: z.string(),
  id: z.string(),
  pages: z.number(),
  unreadable: z.boolean(),
  uploadedAt: z.string(),
});

const skipCompanySchema = z.object({
  domain: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  reason: z.enum(["current_employer", "user"]),
});

const onboardingStateSchema = z.object({
  currentEmployer: z.string().nullable(),
  needsOnboarding: z.boolean(),
  onboardedAt: z.string().nullable(),
  pauseReason: z.string().nullable(),
  resume: resumeSchema.nullable(),
  skipCompanies: z.array(skipCompanySchema),
  step: z.number(),
});

const onboardingFactsSchema = z.object({
  answers: z.object({
    eeo: z.object({
      disability: z.string(),
      enabled: z.boolean(),
      ethnicity: z.string(),
      gender: z.string(),
      veteran: z.string(),
    }),
    hear: z.string(),
    jobTitle: z.string(),
    salary: z.array(
      z.object({
        amount: z.string(),
        currency: z.string(),
        period: z.enum(SALARY_PERIOD_WORDS),
      }),
    ),
    workAuth: z.record(z.string(), z.string()),
  }),
  countries: z.array(z.object({ code: z.string(), name: z.string() })),
  currencies: z.array(z.string()),
  unlocks: z.object({
    eeo: z.number(),
    hear: z.number(),
    jobTitle: z.number(),
    salary: z.number(),
    workAuth: z.number(),
  }),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const stateKey = ["onboarding-state"] as const;

export const factsKey = ["onboarding-facts"] as const;

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The step did not save (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchOnboardingState() {
  return onboardingStateSchema.parse(await jsonFrom(await fetch("/api/onboarding")));
}

export async function finishOnboardingStep(step: number) {
  return onboardingStateSchema.parse(
    await jsonFrom(await fetch(`/api/onboarding/${String(step)}`, { method: "POST" })),
  );
}

export async function uploadOnboardingResume(file: File) {
  const form = new FormData();

  form.append("file", file);

  return resumeSchema.parse(
    await jsonFrom(await fetch("/api/profile/resume", { body: form, method: "POST" })),
  );
}

export async function fetchOnboardingFacts() {
  return onboardingFactsSchema.parse(await jsonFrom(await fetch("/api/onboarding/facts")));
}

export async function saveOnboardingFacts(input: OnboardingFactsInput) {
  return onboardingFactsSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/facts", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  );
}

export function useOnboardingState() {
  return useQuery({ queryFn: fetchOnboardingState, queryKey: stateKey });
}

export function useFinishOnboardingStep() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: finishOnboardingStep,
    onSuccess: (state) => {
      client.setQueryData(stateKey, state);
    },
  });
}

export function useOnboardingFacts() {
  return useQuery({ queryFn: fetchOnboardingFacts, queryKey: factsKey });
}

export function useUploadOnboardingResume() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: uploadOnboardingResume,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: stateKey }),
        client.invalidateQueries({ queryKey: factsKey }),
      ]);
    },
  });
}

export function useSaveOnboardingFacts() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveOnboardingFacts,
    onSuccess: (view) => {
      client.setQueryData(factsKey, view);
    },
  });
}
