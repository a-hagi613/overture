import { z } from "zod";

import type { TargetsInput } from "../../shared/targets.ts";

import { QUESTION_FIELD_TYPES } from "../../shared/questions.ts";
import { TIER_2_FACT_KEYS } from "../../shared/facts.ts";
import { targetsInputSchema } from "../../shared/targets.ts";

const targetsResponseSchema = z.object({
  targets: targetsInputSchema,
  version: z.number(),
  matchedCount: z.number(),
});

const matchCountSchema = z.object({ matchedCount: z.number() });

const skipCompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  reason: z.enum(["current_employer", "user"]),
});

const skipCompaniesSchema = z.object({ companies: z.array(skipCompanySchema) });

const languagesSchema = z.object({ languages: z.array(z.string()) });

const strengthenFactSchema = z.object({
  key: z.enum(TIER_2_FACT_KEYS),
  label: z.string(),
  prompt: z.string(),
  fieldType: z.enum(QUESTION_FIELD_TYPES),
  options: z.array(z.string()),
  unlocked: z.number(),
});

const strengthenSchema = z.object({
  facts: z.array(strengthenFactSchema),
  unlocks: z.number(),
});

const profileSettingsSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
  pendingTimezone: z.string().nullable(),
  pendingTimezoneAt: z.string().nullable(),
});

async function jsonFrom(response: Response) {
  if (!response.ok) {
    throw new Error(`profile request failed: ${String(response.status)}`);
  }

  const body: unknown = await response.json();

  return body;
}

export async function fetchTargets() {
  return targetsResponseSchema.parse(await jsonFrom(await fetch("/api/profile/targets")));
}

export async function previewTargetsCount(targets: TargetsInput) {
  return matchCountSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/targets/match-count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(targets),
      }),
    ),
  );
}

export async function saveTargets(targets: TargetsInput) {
  return targetsResponseSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(targets),
      }),
    ),
  );
}

export async function fetchSkipCompanies() {
  return skipCompaniesSchema.parse(await jsonFrom(await fetch("/api/profile/skip-companies")));
}

export async function saveSkipCompanies(companies: { name: string; domain: string | null }[]) {
  return skipCompaniesSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/skip-companies", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companies }),
      }),
    ),
  );
}

export async function fetchStrengthen() {
  return strengthenSchema.parse(await jsonFrom(await fetch("/api/profile/strengthen")));
}

export async function saveStrengthen(key: string, value: string) {
  return strengthenSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/strengthen", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      }),
    ),
  );
}

export async function fetchLanguages() {
  return languagesSchema.parse(await jsonFrom(await fetch("/api/profile/languages")));
}

export async function saveLanguages(languages: string[]) {
  return languagesSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/languages", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ languages }),
      }),
    ),
  );
}

export async function fetchProfileSettings() {
  return profileSettingsSchema.parse(await jsonFrom(await fetch("/api/profile/settings")));
}

export async function saveProfileSettings(settings: { languages: string[]; timezone: string }) {
  return profileSettingsSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      }),
    ),
  );
}

export type TargetsResponse = z.infer<typeof targetsResponseSchema>;

export type SkipCompany = z.infer<typeof skipCompanySchema>;

export type StrengthenFact = z.infer<typeof strengthenFactSchema>;

export type StrengthenView = z.infer<typeof strengthenSchema>;
