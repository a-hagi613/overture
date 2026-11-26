import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { z } from "zod";

import type { OnboardingTargetsView } from "../../shared/onboarding.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { EMPLOYMENT_TYPES, SENIORITIES, WORKPLACES } from "../../shared/tag-taxonomy.ts";
import { KEY_DETAIL_FACT_KEYS } from "../../shared/key-details.ts";
import { targetsInputSchema } from "../../shared/targets.ts";
import { saveSkipCompanies } from "./profile-api.ts";

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
  applicationsLeft: z.number().default(0),
  currentEmployer: z.string().nullable(),
  needsOnboarding: z.boolean(),
  onboardedAt: z.string().nullable(),
  pauseReason: z.string().nullable(),
  resume: resumeSchema.nullable(),
  skipCompanies: z.array(skipCompanySchema),
  step: z.number(),
});

const onboardingTargetsSchema: z.ZodType<OnboardingTargetsView> = z.object({
  choices: z.object({
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)),
    locations: z.array(z.string()),
    roleCounts: z.record(z.string(), z.number()).default({}),
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

const onboardingMatchSchema = z.object({
  company: z.string(),
  employmentType: z.string(),
  id: z.string(),
  location: z.string().nullable(),
  reason: z.string().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryMinMinor: z.number().nullable(),
  salaryPeriod: z.enum(["year", "month", "hour"]).nullable(),
  score: z.number(),
  strong: z.boolean(),
  title: z.string(),
  why: z.array(z.string()),
  workplace: z.string(),
});

const onboardingMatchesSchema = z.object({
  matches: z.array(onboardingMatchSchema),
  pickLimit: z.number(),
  poolCount: z.number(),
  selected: z.array(z.string()),
});

const keyDetailFieldSchema = z.object({
  confirmed: z.boolean(),
  key: z.enum(KEY_DETAIL_FACT_KEYS),
  label: z.string(),
  source: z.enum(["resume", "user", "review", "import"]).nullable(),
  value: z.string(),
});

const onboardingGapsSchema = z.object({
  fields: z.array(keyDetailFieldSchema),
});

const prepareResultSchema = z.object({
  onboarding: onboardingStateSchema,
  prepared: z.number(),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const stateKey = ["onboarding-state"] as const;

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

export type OnboardingMatches = z.infer<typeof onboardingMatchesSchema>;

export type OnboardingMatchView = z.infer<typeof onboardingMatchSchema>;

export type OnboardingGaps = z.infer<typeof onboardingGapsSchema>;

export type KeyDetailField = z.infer<typeof keyDetailFieldSchema>;

export const gapsKey = ["onboarding-gaps"] as const;

export async function fetchOnboardingGaps() {
  return onboardingGapsSchema.parse(await jsonFrom(await fetch("/api/onboarding/gaps")));
}

export async function saveOnboardingGaps(fields: { key: string; value: string }[]) {
  return onboardingGapsSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/gaps", {
        body: JSON.stringify({ fields }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  );
}

export const matchesKey = ["onboarding-matches"] as const;

export async function fetchOnboardingMatches() {
  return onboardingMatchesSchema.parse(await jsonFrom(await fetch("/api/onboarding/matches")));
}

export async function saveOnboardingMatches(postingIds: string[]) {
  return onboardingMatchesSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/matches", {
        body: JSON.stringify({ postingIds }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  );
}

export async function saveCurrentEmployer(name: string) {
  return onboardingStateSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/current-employer", {
        body: JSON.stringify({ name }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );
}

export async function prepareOnboarding(postingIds: string[]) {
  return prepareResultSchema.parse(
    await jsonFrom(
      await fetch("/api/onboarding/prepare", {
        body: JSON.stringify({ postingIds }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );
}

export function useOnboardingState(enabled = true) {
  return useQuery({ enabled, queryFn: fetchOnboardingState, queryKey: stateKey, retry: 1 });
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

export function useUploadOnboardingResume() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: uploadOnboardingResume,
    onSuccess: async () => {
      client.removeQueries({ queryKey: matchesKey });
      await Promise.all([
        client.invalidateQueries({ queryKey: stateKey }),
        client.invalidateQueries({ queryKey: targetsKey }),
        client.invalidateQueries({ queryKey: gapsKey }),
      ]);
    },
  });
}

export function useOnboardingGaps(enabled = true) {
  return useQuery({ enabled, queryFn: fetchOnboardingGaps, queryKey: gapsKey, retry: 1 });
}

export function useSaveOnboardingGaps() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveOnboardingGaps,
    onSuccess: (view) => {
      client.setQueryData(gapsKey, view);
      client.removeQueries({ queryKey: matchesKey });
    },
  });
}

export function useOnboardingTargets() {
  return useQuery({ queryFn: fetchOnboardingTargets, queryKey: targetsKey, retry: 1 });
}

export function useSaveOnboardingTargets() {
  const client = useQueryClient();
  const sequence = useRef(0);

  return useMutation({
    mutationFn: saveOnboardingTargets,
    onMutate: () => {
      sequence.current += 1;

      return sequence.current;
    },
    onSuccess: (view, _variables, requestId) => {
      if (requestId !== sequence.current) {
        return;
      }

      client.setQueryData(targetsKey, view);
      client.removeQueries({ queryKey: matchesKey });
    },
  });
}

export function useSaveOnboardingTimezone() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveOnboardingTimezone,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["profile-settings"] }),
        client.invalidateQueries({ queryKey: ["time-language"] }),
        client.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });
}

export function useSaveOnboardingSkipCompanies() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveSkipCompanies,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["profile-skip-companies"] }),
        client.invalidateQueries({ queryKey: stateKey }),
        client.invalidateQueries({ queryKey: targetsKey }),
        client.invalidateQueries({ queryKey: matchesKey }),
        client.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });
}

export function useSaveCurrentEmployer() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveCurrentEmployer,
    onSuccess: async (state) => {
      client.setQueryData(stateKey, state);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["profile-skip-companies"] }),
        client.invalidateQueries({ queryKey: targetsKey }),
        client.invalidateQueries({ queryKey: matchesKey }),
        client.invalidateQueries({ queryKey: ["home"] }),
      ]);
    },
  });
}

export function useOnboardingMatches() {
  return useQuery({ queryFn: fetchOnboardingMatches, queryKey: matchesKey, retry: 1 });
}

export function useSaveOnboardingMatches() {
  const client = useQueryClient();
  const sequence = useRef(0);

  return useMutation({
    mutationFn: saveOnboardingMatches,
    onMutate: () => {
      sequence.current += 1;

      return sequence.current;
    },
    onSuccess: (view, _variables, requestId) => {
      if (requestId !== sequence.current) {
        return;
      }

      client.setQueryData(matchesKey, view);
    },
  });
}

export function usePrepareOnboarding() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: prepareOnboarding,
    onSuccess: async ({ onboarding }) => {
      client.setQueryData(stateKey, onboarding);
      await Promise.all([
        client.invalidateQueries({ queryKey: stateKey }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["nav"] }),
        client.invalidateQueries({ queryKey: ["ready"] }),
        client.invalidateQueries({ queryKey: ["board"] }),
        client.invalidateQueries({ queryKey: ["billing"] }),
      ]);
    },
  });
}

const mailboxSchema = z.object({
  address: z.string(),
  firstForwardedAt: z.number().nullable(),
  forwardingWorks: z.boolean(),
});

export const mailboxKey = ["onboarding-mailbox"] as const;

export async function fetchOnboardingMailbox() {
  return mailboxSchema.parse(await jsonFrom(await fetch("/api/profile/mailbox")));
}

export async function startOnboarding() {
  return onboardingStateSchema.parse(
    await jsonFrom(await fetch("/api/onboarding/start", { method: "POST" })),
  );
}

/**
 * The forwarding address, re-read every few seconds until the first mail arrives.
 * @returns The mailbox query.
 */
export function useOnboardingMailbox() {
  return useQuery({
    queryFn: fetchOnboardingMailbox,
    queryKey: mailboxKey,
    refetchInterval: (query) => (query.state.data?.forwardingWorks === true ? false : 4000),
  });
}

export function useStartOnboarding() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: startOnboarding,
    onSuccess: async (state) => {
      client.setQueryData(stateKey, state);
      await Promise.all([
        client.invalidateQueries({ queryKey: stateKey }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["nav"] }),
        client.invalidateQueries({ queryKey: ["billing"] }),
        client.invalidateQueries({ queryKey: ["consent"] }),
        client.invalidateQueries({ queryKey: ["consent-versions"] }),
      ]);
    },
  });
}
