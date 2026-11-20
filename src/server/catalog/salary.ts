import type { SalaryPeriod } from "../../shared/tag-taxonomy.ts";

const numericPattern = String.raw`\d{1,3}(?:[.,\s]\d{3})+|\d+(?:[.,]\d+)?`;

const rangePattern = new RegExp(
  String.raw`(?<leftCurrency>[€£$]|c\$|ca\$|a\$|nz\$|[a-z]{3})?\s*(?<left>` +
    numericPattern +
    String.raw`)(?<leftK>[km]\b)?\s*(?:[-–—~]\s*|\bto\b\s*)(?:€|£|\$)?\s*(?<rightCurrency>[€£$]|c\$|ca\$|a\$|nz\$|[a-z]{3})?\s*(?<right>` +
    numericPattern +
    String.raw`)(?<rightK>[km]\b)?(?<rightCode>\s+[a-z]{3})?`,
  "iu",
);

const symbolValuesPattern =
  /(?<currency>[€£$]|c\$|ca\$|a\$|nz\$)\s?(?<first>\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:\.\d+)?)(?<firstK>[km]\b)?/iu;

const periodPattern =
  /(?<perUnit>\b(?:per|a|an|\/)\s+(?<unit>hour|hr|day|week|wk|month|mo|year|yr|annum)\b)|(?<word>\b(?:hourly|daily|weekly|monthly|annually|annual|yearly)\b)/iu;

const currencyTokens = new Map<string, string>([
  ["$", "USD"],
  ["usd", "USD"],
  ["£", "GBP"],
  ["gbp", "GBP"],
  ["€", "EUR"],
  ["eur", "EUR"],
  ["cad", "CAD"],
  ["aud", "AUD"],
  ["nzd", "NZD"],
  ["chf", "CHF"],
  ["sek", "SEK"],
  ["nok", "NOK"],
  ["dkk", "DKK"],
  ["jpy", "JPY"],
  ["inr", "INR"],
  ["sgd", "SGD"],
  ["brl", "BRL"],
  ["c$", "CAD"],
  ["ca$", "CAD"],
  ["a$", "AUD"],
  ["nz$", "NZD"],
]);

const periodKeywords = new Map<string, SalaryPeriod>([
  ["hour", "hour"],
  ["hourly", "hour"],
  ["hr", "hour"],
  ["day", "day"],
  ["daily", "day"],
  ["week", "week"],
  ["weekly", "week"],
  ["month", "month"],
  ["monthly", "month"],
  ["year", "year"],
  ["yearly", "year"],
  ["annum", "year"],
  ["annual", "year"],
  ["annually", "year"],
  ["yr", "year"],
]);

export function detectPeriod(text: string) {
  const matched = periodPattern.exec(text.toLowerCase());

  if (!matched?.groups) {
    return null;
  }

  const token = matched.groups.unit ?? matched.groups.word ?? "";

  return periodKeywords.get(token) ?? null;
}

export function parsePayRange(text: string) {
  const payLines = text
    .split(/\n+|(?:\.\s)/u)
    .filter((line) => /[€£$]|\b\d{2,3}[km]\b\s*[-–—]\s*\d/iu.test(line));

  for (const line of payLines) {
    const range = rangePattern.exec(line);

    if (range?.groups) {
      const { left, leftK, right, rightK, rightCode, leftCurrency, rightCurrency } = range.groups;

      if (left === undefined || right === undefined) {
        continue;
      }

      const min = parseAmount(left, leftK);
      const max = parseAmount(right, rightK);
      const bothK = leftK !== undefined && rightK !== undefined;

      const anyCurrency =
        leftCurrency !== undefined || rightCurrency !== undefined || rightCode !== undefined;

      if ((min !== null || max !== null) && (anyCurrency || bothK)) {
        return buildRange(
          min,
          max,
          detectCurrencyFrom([rightCode, leftCurrency, rightCurrency], line),
          detectPeriod(line),
        );
      }
    }

    const symbol = symbolValuesPattern.exec(line);

    if (symbol?.groups) {
      const { first, firstK, currency } = symbol.groups;

      if (first === undefined) {
        continue;
      }

      const value = parseAmount(first, firstK);

      if (value !== null) {
        return buildRange(
          value,
          value,
          detectCurrencyFrom([currency, firstK], line),
          detectPeriod(line),
        );
      }
    }
  }

  return null;
}

function parseAmount(raw: string, kSuffix: string | undefined) {
  const hasComma = raw.includes(",");
  let digits = raw.replaceAll(/[\s,]/gu, "");

  if (/^\d+[.]\d{3}$/u.test(digits) && !hasComma) {
    digits = digits.replaceAll(".", "");
  }

  const value = Number(digits);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (kSuffix === undefined) {
    return Math.round(value * 100);
  }

  if (kSuffix.toLowerCase() === "k") {
    return value * 100_000;
  }

  if (kSuffix.toLowerCase() === "m") {
    return value * 100_000_000;
  }

  return Math.round(value * 100);
}

function detectCurrencyFrom(tokens: (string | undefined)[], line: string) {
  const inline = /(?<code>\b[a-z]{3}\b)/iu.exec(line)?.groups?.code;

  for (const token of [...tokens, inline]) {
    if (token === undefined) {
      continue;
    }

    const code = currencyTokens.get(token.toLowerCase().trim());

    if (code !== undefined) {
      return code;
    }
  }

  return null;
}

function buildRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: SalaryPeriod | null,
) {
  const low = min ?? max;
  const high = max ?? min;

  if (low === null || high === null) {
    return null;
  }

  if (high < low) {
    return { currency, minMinor: high, maxMinor: low, period };
  }

  return { currency, minMinor: low, maxMinor: high, period };
}
