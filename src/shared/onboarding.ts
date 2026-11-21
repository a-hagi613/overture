import { z } from "zod";

export const ONBOARDING_STEP_COUNT = 5;

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
