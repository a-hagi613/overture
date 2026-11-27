import { z } from "zod";

import type { TargetsInput } from "../../shared/targets.ts";

import { QUESTION_FIELD_TYPES } from "../../shared/questions.ts";
import { TIER_2_FACT_KEYS } from "../../shared/facts.ts";
import { placeSuggestionSchema } from "../../shared/places.ts";
import { targetsInputSchema } from "../../shared/targets.ts";

const targetsResponseSchema = z.object({
  targets: targetsInputSchema,
  version: z.number(),
  matchedCount: z.number(),
  places: z.array(placeSuggestionSchema),
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

const resumeRecordSchema = z
  .object({
    bytes: z.number(),
    filename: z.string(),
    id: z.string(),
    isCurrent: z.boolean(),
    pages: z.number(),
    parsedWith: z.enum(["unpdf", "llm"]),
    sha256: z.string(),
    unreadable: z.boolean(),
    uploadedAt: z.string(),
  })
  .nullable();

const factRecordSchema = z.object({
  key: z.string(),
  revision: z.number().optional(),
  scope: z.string(),
  source: z.string().optional(),
  value: z.string(),
});

const factsResponseSchema = z.object({
  facts: z.array(factRecordSchema),
});

const portalResponseSchema = z.object({
  url: z.string(),
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

export async function fetchCurrentResume() {
  return resumeRecordSchema.parse(await jsonFrom(await fetch("/api/profile/resume")));
}

export async function uploadResumeFile(file: File) {
  const form = new FormData();

  form.append("file", file);

  const response = await fetch("/api/profile/resume", {
    body: form,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`resume upload failed: ${String(response.status)}`);
  }

  const body: unknown = await response.json();

  return resumeRecordSchema.parse(body);
}

export function resumeFileUrl(id: string) {
  return `/api/profile/resume/${encodeURIComponent(id)}/file`;
}

export async function fetchProfileFacts() {
  return factsResponseSchema.parse(await jsonFrom(await fetch("/api/profile/facts")));
}

export async function saveProfileFacts(facts: { key: string; scope?: string; value: string }[]) {
  return factsResponseSchema.parse(
    await jsonFrom(
      await fetch("/api/profile/facts", {
        body: JSON.stringify({ facts }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    ),
  );
}

export async function createBillingPortalSession() {
  return portalResponseSchema.parse(
    await jsonFrom(await fetch("/api/billing/portal", { method: "POST" })),
  );
}

export type ResumeRecordView = z.infer<typeof resumeRecordSchema>;

export type FactRecordView = z.infer<typeof factRecordSchema>;

export type TargetsResponse = z.infer<typeof targetsResponseSchema>;

export type SkipCompany = z.infer<typeof skipCompanySchema>;

export type StrengthenFact = z.infer<typeof strengthenFactSchema>;

export type StrengthenView = z.infer<typeof strengthenSchema>;
