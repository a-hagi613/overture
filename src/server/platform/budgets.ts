import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import type { AppDatabase } from "./db/client.ts";

import { grants } from "./db/schema.ts";
import { getSetting, SETTING_DEFAULTS } from "./settings/index.ts";

/**
 * Spend and mail budgets grow with the people paying for them (ADR 0018,
 * issue #564). A static ceiling sized for the first paying users would halt
 * preparation and email delivery as soon as the beta outgrew it, so the admin
 * sets a base budget plus a share per paying subscriber and the budget follows
 * the ledger. The `period` grants count: they are only issued by a paid
 * Stripe invoice, so the budget can never grow from fake or admin grants.
 */

export type BudgetSettingKey = keyof typeof SETTING_DEFAULTS;

/** The grant source a paid Stripe period issues. Admin and trial grants never scale a budget. */
export const PAYING_GRANT_SOURCE = "period";

function numberFrom(db: Pick<AppDatabase, "select">, key: BudgetSettingKey) {
  const raw = getSetting(db, key);

  return raw === null ? Number.NaN : Number(raw);
}

/**
 * Reads a dollar setting as micros, with one contract everywhere: a missing or
 * negative value reads as zero, never as a surprise negative budget.
 * @param db The application database.
 * @param key A setting key holding dollars.
 * @returns The configured amount in micros.
 */
export function settingMicros(db: Pick<AppDatabase, "select">, key: BudgetSettingKey) {
  const dollars = numberFrom(db, key);

  return Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 1_000_000) : 0;
}

/**
 * Reads a whole-number setting, falling back to its documented default when
 * the stored value is missing, fractional or below the minimum.
 * @param db The application database.
 * @param key A setting key holding a whole number.
 * @param options The fallback, the minimum and the default's override.
 * @returns The configured number.
 */
export function settingInteger(
  db: Pick<AppDatabase, "select">,
  key: BudgetSettingKey,
  options: { fallback?: number; minimum?: number } = {},
) {
  const parsed = numberFrom(db, key);
  const minimum = options.minimum ?? 0;

  if (!Number.isInteger(parsed) || parsed < minimum) {
    return options.fallback ?? Number(SETTING_DEFAULTS[key]);
  }

  return parsed;
}

/**
 * Reads a ratio setting such as an alert share. A value outside (0, 1] is a
 * typo, so the documented default is used instead of an alert that never fires.
 * @param db The application database.
 * @param key A setting key holding a ratio.
 * @param fallback The ratio to use when the stored one is unusable.
 * @returns The configured ratio.
 */
export function settingRatio(
  db: Pick<AppDatabase, "select">,
  key: BudgetSettingKey,
  fallback: number,
) {
  const parsed = numberFrom(db, key);

  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

/**
 * A base budget plus a share for every paying subscriber.
 * @param base The budget with no paying subscribers.
 * @param perSubscriber The share one paying subscriber adds.
 * @param subscribers How many people are paying.
 * @returns The budget, never negative.
 */
export function scaledBudget(base: number, perSubscriber: number, subscribers: number) {
  const people = Math.max(0, Math.trunc(subscribers));

  return Math.max(0, base) + Math.max(0, perSubscriber) * people;
}

function payingGrantsAt(at: number) {
  return and(
    eq(grants.source, PAYING_GRANT_SOURCE),
    lte(grants.startsAt, at),
    or(isNull(grants.expiresAt), gt(grants.expiresAt, at)),
  );
}

/**
 * How many distinct people hold an unexpired paid period at `at`. Overlapping
 * periods for one person (a Week plan that ended inside a Month plan) count
 * once, so a plan switch cannot double the budget.
 * @param db The application database.
 * @param at The instant to count at, in epoch milliseconds.
 * @returns The number of paying subscribers.
 */
export function activeSubscriberCount(db: Pick<AppDatabase, "select">, at: number) {
  const row = db
    .select({ subscribers: sql<number>`count(distinct ${grants.userId})` })
    .from(grants)
    .where(payingGrantsAt(at))
    .get();

  return row?.subscribers ?? 0;
}

/**
 * Whether one person holds an unexpired paid period at `at`, which is what
 * raises their own daily budget above the invited-user floor.
 * @param db The application database.
 * @param userId The person to check.
 * @param at The instant to check at, in epoch milliseconds.
 * @returns True while a paid period is running.
 */
export function isPayingSubscriber(db: Pick<AppDatabase, "select">, userId: string, at: number) {
  return (
    db
      .select({ one: sql<number>`1` })
      .from(grants)
      .where(and(eq(grants.userId, userId), payingGrantsAt(at)))
      .get() !== undefined
  );
}
