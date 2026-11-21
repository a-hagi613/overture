import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { OnboardingFactsInput, OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { SALARY_PERIOD_WORDS } from "../../shared/onboarding.ts";
import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "../../shared/tag-taxonomy.ts";
import { targetsInputSchema } from "../../shared/targets.ts";

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

const onboardingTargetsSchema: z.ZodType<OnboardingTargetsView> = z.object({
  choices: z.object({
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
    locations: z.array(z.string()),
    roles: z.array(z.string()),
    seniorities: z.array(z.enum(SENIORITIES)),
    workplaces: z.array(z.enum(WORKPLACES)),
  }),
  currencies: z.array(z.string()),
  matchedCount: z.number(),
  targets: targetsInputSchema,
});

const timezoneSavedSchema = z.object({
  languages: z.array(z.string()),
  pendingTimezone: z.string().nullable(),
  pendingTimezoneAt: z.string().nullable(),
  timezone: z.string().nullable(),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const stateKey = ["onboarding-state"] as const;

export const factsKey = ["onboarding-facts"] as const;

export const targetsKey = ["onboarding-targets"] as const;

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

export async function fetchOnboardingTargets() {
  return onboardingTargetsSchema.parse(await jsonFrom(await fetch("/api/onboarding/targets")));
}

export async function saveOnboardingTargets(targets: TargetsInput) {
  return onboardingTargetsSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/targets", {
        body: JSON.stringify(targets),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  );
}

export async function saveOnboardingTimezone(timezone: string) {
  return timezoneSavedSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/timezone", {
        body: JSON.stringify({ timezone }),
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
  return useQuery({ queryFn: fetchOnboardingFacts, queryKey: factsKey, retry: 1 });
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

export function useOnboardingTargets() {
  return useQuery({ queryFn: fetchOnboardingTargets, queryKey: targetsKey, retry: 1 });
}

export function useSaveOnboardingTargets() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveOnboardingTargets,
    onSuccess: (view) => {
      client.setQueryData(targetsKey, view);
    },
  });
}

export function useSaveOnboardingTimezone() {
  return useMutation({ mutationFn: saveOnboardingTimezone });
}
