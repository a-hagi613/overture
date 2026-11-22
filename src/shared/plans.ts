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

export const SEND_WINDOW = {
  endHour: 20,
  minGapMinutes: 20,
  startHour: 8,
  maxPerDay: 10,
} as const;

/** The hiring systems Overture fills. Workday is out of scope (ADR 0017). */
export const PUBLIC_ATS = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"] as const;

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Formats a price for the marketing and legal pages: a whole dollar amount
 * stays whole (`$3`) and a decimal price keeps its cents (`$9.99`).
 * @param amount The price in dollars.
 * @returns The formatted dollar amount.
 */
export function formatUsd(amount: number) {
  return Number.isInteger(amount) ? `$${String(amount)}` : `$${amount.toFixed(2)}`;
}
