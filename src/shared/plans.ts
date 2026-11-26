/**
 * Product configuration for plans, allowances and the send rules shown on the public landing and
 * pricing pages. Every number a marketing page prints comes from here, so a price change is one edit
 * (ADR 0018 for the plan shapes; ADR 0029 for approval; the daytime window is the SPEC send rule).
 */

export const TRIAL = {
  applications: 3,
  cardVerified: true,
} as const;

export const PLANS = {
  week: {
    applications: 50,
    periodDays: 7,
    priceUsd: 9.99,
  },
  month: {
    applications: 250,
    periodDays: 30,
    priceUsd: 29.99,
  },
} as const;

/** The plan a person is on, before their grants run out: the trial or a paid subscription. */
export type PlanKind = "month" | "none" | "trial" | "week";

/**
 * The one-line price and allowance for a plan, used beside its name in the
 * sidebar, Home and Settings → Billing. Every number comes from the plan
 * configuration above, so a price change never leaves a screen behind.
 * @param kind The plan the person is on.
 * @returns The price and allowance, or what is left to choose when there is no plan.
 */
export function planAllowanceText(kind: PlanKind) {
  if (kind === "trial") {
    return `${String(TRIAL.applications)} applications`;
  }

  if (kind === "week") {
    return `${formatUsd(PLANS.week.priceUsd)}/wk · ${String(PLANS.week.applications)}/wk`;
  }

  if (kind === "month") {
    return `${formatUsd(PLANS.month.priceUsd)}/mo · ${String(PLANS.month.applications)}/mo`;
  }

  return "No plan yet";
}

export const SEND_RULES = {
  /** The onboarding trial's Applications go together, in parallel. */
  trialParallel: 3,
  /** Paid Applications for one person are spaced this far apart. */
  paidGapMinutes: 5,
  maxPerDay: 10,
} as const;

/** The hiring systems Overture fills. Workday is out of scope (ADR 0017). */
export const PUBLIC_ATS = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"] as const;

/**
 * Formats a price for the marketing and legal pages: a whole dollar amount
 * stays whole (`$3`) and a decimal price keeps its cents (`$9.99`).
 * @param amount The price in dollars.
 * @returns The formatted dollar amount.
 */
export function formatUsd(amount: number) {
  return Number.isInteger(amount) ? `$${String(amount)}` : `$${amount.toFixed(2)}`;
}
