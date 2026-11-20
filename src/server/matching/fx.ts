import { and, desc, eq, lte } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { fxRates } from "../platform/db/schema.ts";

export const PERIODS_PER_YEAR = {
  hour: 2080,
  month: 12,
  year: 1,
} as const;

const RECORDED_PER_USD = new Map<string, number>([
  ["AUD", 1.55],
  ["BRL", 5.1],
  ["CAD", 1.37],
  ["CHF", 0.88],
  ["DKK", 6.9],
  ["EUR", 0.92],
  ["GBP", 0.79],
  ["INR", 84],
  ["JPY", 157],
  ["NOK", 10.7],
  ["NZD", 1.7],
  ["SEK", 10.5],
  ["SGD", 1.34],
  ["USD", 1],
]);

export function recordedPerUsd(currency: string) {
  return RECORDED_PER_USD.get(currency.toUpperCase()) ?? null;
}

export function rateOn(db: AppDatabase, at: number, currency: string) {
  const code = currency.toUpperCase();

  if (code === "USD") {
    return 1;
  }

  const date = new Date(at).toISOString().slice(0, 10);

  const row = db
    .select({ perUsd: fxRates.perUsd })
    .from(fxRates)
    .where(and(eq(fxRates.currency, code), lte(fxRates.date, date)))
    .orderBy(desc(fxRates.date))
    .limit(1)
    .get();

  return row?.perUsd ?? recordedPerUsd(code);
}

export function annualMinor(amountMinor: number, period: keyof typeof PERIODS_PER_YEAR) {
  return Math.round(amountMinor * PERIODS_PER_YEAR[period]);
}

export function salaryMeetsFloor(
  db: AppDatabase,
  at: number,
  posting: {
    salaryMinMinor: number | null;
    salaryCurrency: string | null;
    salaryPeriod: keyof typeof PERIODS_PER_YEAR | null;
  },
  floorMinor: number,
  floorCurrency: string,
  floorPeriod: keyof typeof PERIODS_PER_YEAR,
) {
  if (
    posting.salaryMinMinor === null ||
    posting.salaryCurrency === null ||
    posting.salaryPeriod === null
  ) {
    return { known: false, meets: true };
  }

  const postingRate = rateOn(db, at, posting.salaryCurrency);
  const floorRate = rateOn(db, at, floorCurrency);

  if (postingRate === null || floorRate === null) {
    return { known: true, meets: true };
  }

  const postingUsdMinor = annualMinor(posting.salaryMinMinor, posting.salaryPeriod) / postingRate;
  const floorUsdMinor = annualMinor(floorMinor, floorPeriod) / floorRate;

  return { known: true, meets: postingUsdMinor >= floorUsdMinor };
}
