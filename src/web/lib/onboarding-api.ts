import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { OnboardingFactsInput } from "../../shared/onboarding.ts";

import { SALARY_PERIOD_WORDS } from "../../shared/onboarding.ts";

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

export const queryKey = ["onboarding-facts"] as const;

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`The step did not save (${String(response.status)}).`);
  }

  const body: unknown = await response.json();

  return body;
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

export function useOnboardingFacts() {
  return useQuery({ queryFn: fetchOnboardingFacts, queryKey });
}

export function useSaveOnboardingFacts() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveOnboardingFacts,
    onSuccess: (view) => {
      client.setQueryData(queryKey, view);
    },
  });
}
