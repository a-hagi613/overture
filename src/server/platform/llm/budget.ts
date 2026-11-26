import type { AppDatabase } from "../db/client.ts";

import { activeSubscriberCount, scaledBudget, settingMicros, settingRatio } from "../budgets.ts";
import { getSetting } from "../settings/index.ts";

const GLOBAL_DAILY_CAP_KEY = "llm.daily_spend_cap_micros";

/** The share of a daily LLM budget at which the owner hears about it. */
export const DEFAULT_SPEND_ALERT_RATIO = 0.8;

export type LlmDollarCapKey =
  | "llm.cap_global_day_usd"
  | "llm.cap_onboarding_usd"
  | "llm.cap_tagging_day_usd"
  | "llm.cap_user_day_usd";

/**
 * Reads a dollar cap as micros. A global cap stored in micros by the LLM admin
 * page overrides the dollar setting, so an existing deployment keeps its value.
 * @param db The application database.
 * @param key The dollar setting to read.
 * @returns The amount in micros, zero when unset or unusable.
 */
export function capMicros(db: AppDatabase, key: LlmDollarCapKey) {
  if (key === "llm.cap_global_day_usd") {
    const storedMicros = getSetting(db, GLOBAL_DAILY_CAP_KEY);
    const micros = storedMicros === null ? Number.NaN : Number(storedMicros);

    if (Number.isFinite(micros) && micros >= 0) {
      return Math.round(micros);
    }
  }

  return settingMicros(db, key);
}

/**
 * The daily LLM budget the whole app may spend, and how it was reached: a base
 * plus a share for every paying subscriber, read from the ledger's `period`
 * grants, so paid growth raises the ceiling instead of halting preparation.
 */
export interface LlmDayBudget {
  baseMicros: number;
  perSubscriberMicros: number;
  subscribers: number;
  budgetMicros: number;
}

/**
 * Reads the global daily LLM budget for one instant.
 * @param db The application database.
 * @param at The instant to count paying subscribers at.
 * @returns The base, the per-subscriber share, the count and the resulting budget.
 */
export function llmDayBudget(db: AppDatabase, at: number) {
  const baseMicros = capMicros(db, "llm.cap_global_day_usd");
  const perSubscriberMicros = settingMicros(db, "llm.cap_per_subscriber_day_usd");
  const subscribers = activeSubscriberCount(db, at);

  return {
    baseMicros,
    budgetMicros: scaledBudget(baseMicros, perSubscriberMicros, subscribers),
    perSubscriberMicros,
    subscribers,
  } satisfies LlmDayBudget;
}

/**
 * The global daily LLM budget in micros at one instant.
 * @param db The application database.
 * @param at The instant to count paying subscribers at.
 * @returns The budget in micros.
 */
export function llmDayBudgetMicros(db: AppDatabase, at: number) {
  return llmDayBudget(db, at).budgetMicros;
}

/**
 * One person's daily LLM budget. Every account gets the same daily ceiling;
 * the onboarding matching pool is a separate, one-time budget and the global
 * ceiling grows with paying subscribers.
 * @param db The application database.
 * @returns The budget in micros.
 */
export function llmUserDayBudgetMicros(db: AppDatabase) {
  return capMicros(db, "llm.cap_user_day_usd");
}

/**
 * The one-time matching budget a person gets while onboarding, before their
 * daily ceiling applies to scored jobs after onboarding.
 * @param db The application database.
 * @returns The budget in micros.
 */
export function llmOnboardingMatchingBudgetMicros(db: AppDatabase) {
  return capMicros(db, "llm.cap_onboarding_usd");
}

/**
 * The share of an LLM budget at which the owner is alerted, admin-configurable.
 * @param db The application database.
 * @returns The ratio, where 1 is the whole budget.
 */
export function llmSpendAlertRatio(db: AppDatabase) {
  return settingRatio(db, "llm.spend_alert_ratio", DEFAULT_SPEND_ALERT_RATIO);
}
