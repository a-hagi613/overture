import { z } from "zod";

import type { KeyDetailFactKey } from "./key-details.ts";
import type { PlaceSuggestion } from "./places.ts";
import type { TargetsInput } from "./targets.ts";
import type { EmploymentType, Workplace } from "./tag-taxonomy.ts";

import { KEY_DETAIL_FACT_KEYS } from "./key-details.ts";
import { timezoneSchema } from "./targets.ts";

export const ONBOARDING_STEP_COUNT = 5;

/** How many openings a person previews and picks before the trial card (SPEC, M3). */
export const ONBOARDING_MATCH_PICK_LIMIT = 3;

export const onboardingTimezoneInputSchema = z.object({ timezone: timezoneSchema });

export const onboardingMatchSelectionInputSchema = z.object({
  postingIds: z.array(z.string().trim().min(1)).max(ONBOARDING_MATCH_PICK_LIMIT),
});

export const onboardingPrepareInputSchema = onboardingMatchSelectionInputSchema;

export const onboardingCurrentEmployerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export interface OnboardingMatchView {
  id: string;
  title: string;
  company: string;
  location: string | null;
  workplace: Workplace;
  employmentType: EmploymentType;
  salaryMinMinor: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "year" | "month" | "hour" | null;
  score: number;
  reason: string | null;
  strong: boolean;
  why: string[];
}

export interface OnboardingMatchesView {
  matches: OnboardingMatchView[];
  pickLimit: number;
  poolCount: number;
  selected: string[];
}

export interface OnboardingTargetsView {
  targets: TargetsInput;
  matchedCount: number;
  /** The labels for the places already saved, so a pill never renders a raw id. */
  places: PlaceSuggestion[];
}

export const WORK_AUTH_OPTIONS = [
  "Citizen",
  "Permanent resident",
  "Work permit",
  "Need sponsorship",
] as const;

export const SALARY_PERIOD_WORDS = ["a year", "a month", "a week", "a day", "an hour"] as const;

export type SalaryPeriodWord = (typeof SALARY_PERIOD_WORDS)[number];

export const EEO_PREFER_NOT_TO_SAY = "Prefer not to say";

export const EEO_FIELD_KEYS = ["gender", "ethnicity", "veteran", "disability"] as const;

export type EeoFieldKey = (typeof EEO_FIELD_KEYS)[number];

export const EEO_OPTIONS: Record<EeoFieldKey, readonly string[]> = {
  gender: [EEO_PREFER_NOT_TO_SAY, "Woman", "Man", "Non-binary"],
  ethnicity: [
    EEO_PREFER_NOT_TO_SAY,
    "Asian",
    "Black",
    "Hispanic or Latino",
    "White",
    "Two or more",
  ],
  veteran: [EEO_PREFER_NOT_TO_SAY, "Not a veteran", "Veteran"],
  disability: [EEO_PREFER_NOT_TO_SAY, "No", "Yes"],
};

export const workAuthAnswerSchema = z.object({
  code: z.string().regex(/^[A-Z]{2}$/u),
  value: z.string().trim().max(80),
});

export const salaryAnswerSchema = z.object({
  amount: z.string().trim().max(20),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  period: z.union([z.enum(SALARY_PERIOD_WORDS), z.literal("")]),
});

export const eeoAnswersSchema = z.object({
  disability: z.string().trim().max(80),
  enabled: z.boolean(),
  ethnicity: z.string().trim().max(80),
  gender: z.string().trim().max(80),
  veteran: z.string().trim().max(80),
});

export const onboardingFactsInputSchema = z.object({
  eeo: eeoAnswersSchema.optional(),
  hear: z.string().trim().max(500).optional(),
  jobTitle: z.string().trim().max(200).optional(),
  salary: z.array(salaryAnswerSchema).max(8).optional(),
  workAuth: z.array(workAuthAnswerSchema).max(20).optional(),
});

export type WorkAuthAnswer = z.infer<typeof workAuthAnswerSchema>;

export type SalaryAnswer = z.infer<typeof salaryAnswerSchema>;

export type EeoAnswers = z.infer<typeof eeoAnswersSchema>;

export type OnboardingFactsInput = z.infer<typeof onboardingFactsInputSchema>;

export interface QuestionUnlocks {
  jobTitle: number;
  workAuth: number;
  salary: number;
  hear: number;
  eeo: number;
}

export interface OnboardingFactsView {
  countries: { code: string; name: string }[];
  currencies: string[];
  unlocks: QuestionUnlocks;
  answers: {
    jobTitle: string;
    workAuth: Record<string, string>;
    salary: SalaryAnswer[];
    hear: string;
    eeo: EeoAnswers;
  };
}

export const keyDetailFieldInputSchema = z.object({
  key: z.enum(KEY_DETAIL_FACT_KEYS),
  value: z.string().trim().max(2000),
});

export const onboardingGapsInputSchema = z.object({
  fields: z.array(keyDetailFieldInputSchema).max(KEY_DETAIL_FACT_KEYS.length),
});

export type OnboardingGapsInput = z.infer<typeof onboardingGapsInputSchema>;

export interface KeyDetailFieldView {
  confirmed: boolean;
  key: KeyDetailFactKey;
  label: string;
  source: "resume" | "user" | "review" | "import" | null;
  value: string;
}

export interface OnboardingGapsView {
  fields: KeyDetailFieldView[];
}
