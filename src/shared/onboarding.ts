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

/** The largest pick list any plan offers, so storage is not tied to one plan (#709). */
export const ONBOARDING_MAX_PICKS = 10;

/** The plans onboarding can choose between; the pick limit comes from the plan. */
export const ONBOARDING_PLAN_KINDS = ["free_trial", "week", "month"] as const;

export type OnboardingPlanKind = (typeof ONBOARDING_PLAN_KINDS)[number];

/**
 * The pick limit one plan allows: the free trial 3, a paid plan the daily cap of 10.
 * @param planKind The chosen plan, or null before a plan is chosen.
 * @returns The number of picks the plan allows.
 */
export function onboardingPickLimitFor(planKind: OnboardingPlanKind | null) {
  return planKind === null || planKind === "free_trial"
    ? ONBOARDING_MATCH_PICK_LIMIT
    : ONBOARDING_MAX_PICKS;
}

/** One pick's status, from chosen through preparation to a closed or failed posting. */
export const ONBOARDING_PICK_STATUSES = [
  "picked",
  "preparing",
  "needs_answer",
  "prepared",
  "closed",
  "failed",
] as const;

export type OnboardingPickStatus = (typeof ONBOARDING_PICK_STATUSES)[number];

/** The durable batch's own lifecycle, resumed across refresh, two tabs and Stripe returns. */
export const ONBOARDING_BATCH_STATUSES = [
  "picking",
  "awaiting_card",
  "preparing",
  "prepared",
  "failed",
] as const;

export type OnboardingBatchStatus = (typeof ONBOARDING_BATCH_STATUSES)[number];

/** The reasons a pick can end without a sendable Application. */
export const ONBOARDING_PICK_FAILURE_REASONS = [
  "posting_closed",
  "apply_unsupported",
  "language",
  "company_excluded",
  "already_applied",
  "prepare_failed",
] as const;

export type OnboardingPickFailureReason = (typeof ONBOARDING_PICK_FAILURE_REASONS)[number];

const PICK_STATUS_BY_APPLICATION_STATUS = new Map<string, OnboardingPickStatus>([
  ["approved", "prepared"],
  ["confirming", "prepared"],
  ["needs_review", "needs_answer"],
  ["preparing", "preparing"],
  ["ready", "prepared"],
  ["sending", "prepared"],
  ["sent", "prepared"],
  ["skipped", "closed"],
  ["withdrawn", "closed"],
]);

/**
 * Map one Application's status onto its pick: preparation runs through preparing, a question surfaces as
 * `needs_answer`, a finished plan is `prepared`, and a closed or failed Application keeps that outcome.
 * @param status The Application's status.
 * @param reason The Application's stored status reason, when it has one.
 * @returns The pick status.
 */
export function pickStatusOfApplication(status: string, reason: string | null) {
  if (status === "failed") {
    return reason === "posting_closed" ? "closed" : "failed";
  }

  return PICK_STATUS_BY_APPLICATION_STATUS.get(status) ?? "picked";
}

export const onboardingTimezoneInputSchema = z.object({ timezone: timezoneSchema });

export const onboardingMatchSelectionInputSchema = z.object({
  postingIds: z.array(z.string().trim().min(1)).max(ONBOARDING_MAX_PICKS),
});

export const onboardingPrepareInputSchema = onboardingMatchSelectionInputSchema;

/** A Stripe return can carry the Checkout or Setup session that was just confirmed. */
export const onboardingSettleInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(255).optional(),
});

export const onboardingCurrentEmployerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

/** One durable pick as the Tracker, Ready and onboarding screens read it. */
export interface OnboardingPickView {
  applicationId: string | null;
  applyUrl: string | null;
  company: string;
  location: string | null;
  postingId: string;
  reason: OnboardingPickFailureReason | null;
  status: OnboardingPickStatus;
  title: string;
}

/** The durable batch plus its picks; the same view on every refresh and tab. */
export interface OnboardingPicksView {
  batchStatus: OnboardingBatchStatus;
  pickLimit: number;
  picks: OnboardingPickView[];
  selected: string[];
}

/** The outcome of settling a Stripe return, so the client can show one message per case. */
export const ONBOARDING_SETTLE_OUTCOMES = [
  "prepared",
  "pending",
  "already_trialed",
  "already_used",
  "card_not_verified",
  "trial_required",
  "no_picks",
] as const;

export type OnboardingSettleOutcome = (typeof ONBOARDING_SETTLE_OUTCOMES)[number];

export interface OnboardingSettleView {
  outcome: OnboardingSettleOutcome;
  picks: OnboardingPicksView;
  prepared: number;
  applicationsLeft: number;
}

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
