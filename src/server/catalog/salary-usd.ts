/**
 * Yearly USD averages for the currencies a job board sees. Every advertised range is stored in minor units
 * of its own currency, so a salary filter compares these normalized USD values instead. A currency missing
 * from the table keeps a null USD range and is excluded by a USD filter rather than guessed.
 */
export const ANNUAL_USD_RATES = new Map(
  Object.entries({
    USD: 1,
    EUR: 1.08,
    GBP: 1.27,
    CAD: 0.73,
    AUD: 0.66,
    NZD: 0.6,
    CHF: 1.13,
    SEK: 0.095,
    NOK: 0.093,
    DKK: 0.146,
    ISK: 0.0072,
    PLN: 0.25,
    CZK: 0.043,
    HUF: 0.0028,
    RON: 0.22,
    BGN: 0.55,
    HRK: 0.144,
    RSD: 0.0092,
    TRY: 0.029,
    ILS: 0.27,
    AED: 0.272,
    SAR: 0.267,
    QAR: 0.275,
    KWD: 3.25,
    BHD: 2.65,
    OMR: 2.6,
    JOD: 1.41,
    EGP: 0.02,
    ZAR: 0.055,
    NGN: 0.00065,
    KES: 0.0078,
    GHS: 0.066,
    MAD: 0.1,
    TND: 0.32,
    INR: 0.012,
    PKR: 0.0036,
    BDT: 0.0084,
    LKR: 0.0034,
    NPR: 0.0072,
    JPY: 0.0067,
    CNY: 0.14,
    HKD: 0.128,
    SGD: 0.74,
    TWD: 0.031,
    KRW: 0.00073,
    THB: 0.028,
    MYR: 0.21,
    IDR: 0.000063,
    PHP: 0.017,
    VND: 0.000039,
    BRL: 0.19,
    MXN: 0.055,
    ARS: 0.0011,
    CLP: 0.001,
    COP: 0.00025,
    PEN: 0.27,
    UYU: 0.025,
    RUB: 0.011,
    UAH: 0.024,
    KZT: 0.0022,
    MNT: 0.00029,
    ETB: 0.017,
  } satisfies Record<string, number>),
);

/** How many hours a full-time year pays, for an hourly rate. */
export const PAY_PERIOD_HOURS_PER_YEAR = 2080;

const PERIOD_MULTIPLIER = {
  hour: PAY_PERIOD_HOURS_PER_YEAR,
  month: 12,
  year: 1,
} as const;

/**
 * Annualizes one advertised amount to whole USD.
 * @param minor The amount in minor units (cents) of its currency.
 * @param currency The ISO currency code, any case.
 * @param period The pay period; null is read as a yearly figure.
 * @returns Whole annual USD, or null when the currency or period is unknown.
 */
export function annualUsdFromMinor(
  minor: number | null,
  currency: string | null,
  period: "hour" | "month" | "year" | null,
) {
  if (minor === null || currency === null) {
    return null;
  }

  const rate = ANNUAL_USD_RATES.get(currency.toUpperCase());

  if (rate === undefined) {
    return null;
  }

  const multiplier = PERIOD_MULTIPLIER[period ?? "year"];

  return Math.round((minor / 100) * rate * multiplier);
}

/**
 * The SQL that refreshes `salary_min_usd` and `salary_max_usd` for every row from the stored minor units,
 * currency and period. One statement keeps the ETL's per-row cost flat over a full snapshot.
 * @returns The update statement, or null when the rate table is empty.
 */
export function salaryUsdUpdateSql() {
  const entries = [...ANNUAL_USD_RATES.entries()];

  if (entries.length === 0) {
    return null;
  }

  const rateCase = [
    "case upper(coalesce(salary_currency, ''))",
    ...entries.map(([code, rate]) => `when '${code}' then ${String(rate)}`),
    "else null end",
  ].join(" ");

  const periodCase =
    "case salary_period when 'hour' then 2080 when 'month' then 12 when 'year' then 1 else 1 end";

  const expression = (column: string) =>
    `case when ${column} is null or salary_currency is null then null else ` +
    `cast(round((${column} / 100.0) * (${rateCase}) * (${periodCase})) as integer) end`;

  return `update postings set salary_min_usd = ${expression("salary_min_minor")}, salary_max_usd = ${expression("salary_max_minor")}`;
}
