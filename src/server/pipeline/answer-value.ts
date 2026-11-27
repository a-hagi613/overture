import type { QuestionFieldType } from "../../shared/questions.ts";

import {
  AFFIRMATIVE_OPTION,
  NEGATIVE_OPTION,
  affirmativeOption,
  matchOption,
  normalizeOptionText,
  normalizeQuestionText,
} from "../catalog/question-normalize.ts";

export const ANSWER_PERIODS = ["hour", "day", "week", "month", "year"] as const;

export type AnswerPeriod = (typeof ANSWER_PERIODS)[number];

export const FILE_FACTS = ["resume", "cover_letter"] as const;

export type FileFact = (typeof FILE_FACTS)[number];

export interface AnswerUnit {
  currency: string | null;
  period: AnswerPeriod | null;
}

export interface FormattedAnswer {
  value: string;
  unit: AnswerUnit | null;
}

export interface SalaryValue {
  minMinor: number;
  maxMinor: number;
  currency: string | null;
  period: AnswerPeriod | null;
}

export interface NoticeValue {
  amount: number;
  unit: "day" | "week" | "month";
}

const AFFIRMATIVE_FACT_VALUES = new Set([
  "1",
  "agree",
  "agreed",
  "authorised",
  "authorized",
  "citizen",
  "eligible",
  "i agree",
  "i am authorised",
  "i am authorized",
  "permanent resident",
  "true",
  "y",
  "yes",
]);

const NEGATIVE_FACT_VALUES = new Set([
  "0",
  "disagree",
  "false",
  "i do not require sponsorship",
  "i will not require sponsorship",
  "n",
  "no",
  "not authorised",
  "not authorized",
  "none",
]);

const NUMBER_TOKEN = String.raw`\d{1,3}(?:[ ,]\d{3})+|\d+(?:[.,]\d+)?`;

const CURRENCY_TOKEN = String.raw`(?:[€£$]|c\$|ca\$|a\$|nz\$|[a-z]{3})?`;

const SALARY_RANGE = new RegExp(
  String.raw`${CURRENCY_TOKEN}\s*(?<left>` +
    NUMBER_TOKEN +
    String.raw`)(?<leftSuffix>[km]\b)?\s*(?:-|–|—|to|through)\s*` +
    String.raw`${CURRENCY_TOKEN}\s*(?<right>` +
    NUMBER_TOKEN +
    String.raw`)(?<rightSuffix>[km]\b)?`,
  "iu",
);

const SALARY_AMOUNT = new RegExp(String.raw`(?<number>${NUMBER_TOKEN})(?<suffix>[km]\b)?`, "iu");

const CURRENCY_CODE = /\b(?:usd|cad|aud|nzd|gbp|eur|chf|sek|nok|dkk|jpy|inr|sgd|brl)\b/iu;

const PERIODS: readonly (readonly [RegExp, AnswerPeriod])[] = [
  [/\b(?:hour|hourly|hr|per hour|an hour|a hour)\b/iu, "hour"],
  [/\b(?:day|daily|per day|a day|an day)\b/iu, "day"],
  [/\b(?:week|weekly|per week|a week|an week)\b/iu, "week"],
  [/\b(?:month|monthly|per month|a month|an month)\b/iu, "month"],
  [/\b(?:year|yearly|annual|annually|annum|per year|a year|an year|yr)\b/iu, "year"],
];

const NOTICE_UNITS = new Map<string, NoticeValue["unit"]>([
  ["day", "day"],
  ["days", "day"],
  ["week", "week"],
  ["weeks", "week"],
  ["month", "month"],
  ["months", "month"],
]);

const NOTICE_WORDS = new Map<string, number>([
  ["a", 1],
  ["an", 1],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
]);

const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

function isOptionField(fieldType: QuestionFieldType) {
  return (
    fieldType === "select" ||
    fieldType === "radio" ||
    fieldType === "checkbox" ||
    fieldType === "multiselect"
  );
}

function unitFor(value: string, period: AnswerPeriod | null) {
  const currency = detectCurrency(value);

  return currency === null && period === null ? null : { currency, period };
}

function detectCurrency(text: string) {
  const code = CURRENCY_CODE.exec(text)?.[0];

  if (code !== undefined) {
    return code.toUpperCase();
  }

  if (/C\$/iu.test(text)) {
    return "CAD";
  }

  if (/A\$/iu.test(text)) {
    return "AUD";
  }

  if (/NZ\$/iu.test(text)) {
    return "NZD";
  }

  if (text.includes("€")) {
    return "EUR";
  }

  if (text.includes("£")) {
    return "GBP";
  }

  return null;
}

export function currencyNamedIn(text: string) {
  return detectCurrency(text);
}

function detectPeriod(text: string) {
  for (const [pattern, period] of PERIODS) {
    if (pattern.test(text)) {
      return period;
    }
  }

  return null;
}

function amountValue(raw: string, suffix: string | undefined) {
  let digits = raw.replaceAll(/[ ,]/gu, "");

  if (/^[0-9]+\.[0-9]{3}$/u.test(digits) && !raw.includes(",")) {
    digits = digits.replaceAll(".", "");
  }

  const value = Number(digits);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (suffix === undefined) {
    return value;
  }

  if (suffix.toLowerCase() === "k") {
    return value * 1000;
  }

  return value * 1_000_000;
}

export function parseSalaryExpectation(text: string) {
  const currency = detectCurrency(text);
  const period = detectPeriod(text);
  const range = SALARY_RANGE.exec(text);

  if (range?.groups !== undefined) {
    const { left, leftSuffix, right, rightSuffix } = range.groups;

    if (left !== undefined && right !== undefined) {
      const first = amountValue(left, leftSuffix);
      const second = amountValue(right, rightSuffix);

      if (first !== null && second !== null) {
        return salaryFrom(first, second, currency, period);
      }
    }
  }

  const single = SALARY_AMOUNT.exec(text);

  if (single?.groups?.number === undefined) {
    return null;
  }

  const value = amountValue(single.groups.number, single.groups.suffix);

  return value === null ? null : salaryFrom(value, value, currency, period);
}

function salaryFrom(
  first: number,
  second: number,
  currency: string | null,
  period: AnswerPeriod | null,
) {
  const low = Math.min(first, second);
  const high = Math.max(first, second);

  return {
    minMinor: Math.round(low * 100),
    maxMinor: Math.round(high * 100),
    currency,
    period,
  };
}

export function parseNoticePeriod(text: string) {
  const folded = text.toLowerCase();

  if (/\bimmediate(?:ly)?\b/u.test(folded)) {
    return { amount: 0, unit: "day" } satisfies NoticeValue;
  }

  const match =
    /(?<amount>[0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)\s*(?<unit>days?|weeks?|months?)\b/u.exec(
      folded,
    );

  if (match?.groups?.amount === undefined || match.groups.unit === undefined) {
    return null;
  }

  const amount =
    NOTICE_WORDS.get(match.groups.amount) ??
    (Number.isInteger(Number(match.groups.amount)) ? Number(match.groups.amount) : null);

  const unit: NoticeValue["unit"] | undefined = NOTICE_UNITS.get(match.groups.unit);

  if (amount === null || unit === undefined) {
    return null;
  }

  return { amount, unit } satisfies NoticeValue;
}

function requestedNoticeUnit(questionText: string) {
  const match = /\b(?<unit>days?|weeks?|months?)\b/u.exec(normalizeQuestionText(questionText));

  return match?.groups?.unit === undefined ? null : (NOTICE_UNITS.get(match.groups.unit) ?? null);
}

function calendarDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthNumber(name: string) {
  return MONTHS.get(name.toLowerCase().replace(/\.$/u, "")) ?? null;
}

export function parseDateValue(text: string) {
  const trimmed = text.trim();
  const iso = /^(?<year>[0-9]{4})-(?<month>[0-9]{1,2})-(?<day>[0-9]{1,2})$/u.exec(trimmed);

  if (iso?.groups !== undefined) {
    return calendarDate(Number(iso.groups.year), Number(iso.groups.month), Number(iso.groups.day));
  }

  const slashed = /^(?<year>[0-9]{4})[/.](?<month>[0-9]{1,2})[/.](?<day>[0-9]{1,2})$/u.exec(
    trimmed,
  );

  if (slashed?.groups !== undefined) {
    return calendarDate(
      Number(slashed.groups.year),
      Number(slashed.groups.month),
      Number(slashed.groups.day),
    );
  }

  const dayFirst =
    /^(?<day>[0-9]{1,2})(?:st|nd|rd|th)?\s+(?<month>[A-Za-z]+)\.?,?\s+(?<year>[0-9]{4})$/u.exec(
      trimmed,
    );

  if (dayFirst?.groups !== undefined) {
    const month = monthNumber(dayFirst.groups.month ?? "");

    if (month !== null) {
      return calendarDate(Number(dayFirst.groups.year), month, Number(dayFirst.groups.day));
    }
  }

  const monthFirst =
    /^(?<month>[A-Za-z]+)\.?\s+(?<day>[0-9]{1,2})(?:st|nd|rd|th)?,?\s+(?<year>[0-9]{4})$/u.exec(
      trimmed,
    );

  if (monthFirst?.groups !== undefined) {
    const month = monthNumber(monthFirst.groups.month ?? "");

    if (month !== null) {
      return calendarDate(Number(monthFirst.groups.year), month, Number(monthFirst.groups.day));
    }
  }

  return null;
}

function isIsoDate(value: string) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) && parseDateValue(value) === value;
}

function isNumeric(value: string) {
  return /^-?[0-9]+(?:\.[0-9]+)?$/u.test(value);
}

export function answerIsValid(
  fieldType: QuestionFieldType,
  options: readonly string[],
  value: string,
) {
  switch (fieldType) {
    case "email": {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
    }

    case "phone": {
      return value.replaceAll(/[^0-9]/gu, "").length >= 7;
    }

    case "url": {
      return URL.canParse(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value);
    }

    case "number": {
      return isNumeric(value);
    }

    case "date": {
      return isIsoDate(value);
    }

    case "select": {
      return options.length === 0 ? value.trim() !== "" : options.includes(value);
    }

    case "radio": {
      return options.length === 0
        ? value === AFFIRMATIVE_OPTION || value === NEGATIVE_OPTION
        : options.includes(value);
    }

    case "checkbox": {
      return options.length === 0
        ? value === AFFIRMATIVE_OPTION || value === NEGATIVE_OPTION
        : options.includes(value);
    }

    case "multiselect": {
      return value
        .split(", ")
        .every((part) =>
          options.some((option) => normalizeOptionText(option) === normalizeOptionText(part)),
        );
    }

    case "file": {
      return false;
    }

    default: {
      return value.trim() !== "";
    }
  }
}

function formatSelectValue(
  value: string,
  options: readonly string[],
  fieldType: QuestionFieldType,
) {
  if (options.length === 0) {
    const folded = value.trim().toLowerCase();

    if (AFFIRMATIVE_FACT_VALUES.has(folded)) {
      return AFFIRMATIVE_OPTION;
    }

    if (NEGATIVE_FACT_VALUES.has(folded)) {
      return NEGATIVE_OPTION;
    }

    const trimmed = value.trim();

    return fieldType === "select" && trimmed !== "" ? trimmed : null;
  }

  const match = matchOption(value, options);

  return match.matched ? match.option : null;
}

function formatMultiselectValue(value: string, options: readonly string[]) {
  const parts = value
    .split(/[,;|]/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const matched = parts.flatMap((part) => {
    const match = matchOption(part, options);

    return match.matched ? [match.option] : [];
  });

  return matched.length === parts.length ? matched.join(", ") : null;
}

function salaryMatchesQuestion(questionText: string, parsed: SalaryValue) {
  const questionCurrency = detectCurrency(questionText);
  const questionPeriod = detectPeriod(questionText);

  if (questionCurrency !== null && parsed.currency !== questionCurrency) {
    return false;
  }

  return questionPeriod === null || parsed.period === questionPeriod;
}

function formatSalary(input: {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  const parsed = parseSalaryExpectation(input.value);
  const unit = parsed === null ? null : unitFor(input.value, parsed.period);

  if (isOptionField(input.fieldType)) {
    const exact = formatSelectValue(input.value, input.options, input.fieldType);

    if (exact !== null) {
      return { value: exact, unit };
    }

    if (parsed !== null) {
      const contained = input.options.filter((option) => optionContainsSalary(option, parsed));

      if (contained.length === 1 && contained[0] !== undefined) {
        return { value: contained[0], unit };
      }
    }

    return null;
  }

  if (input.fieldType === "number") {
    if (
      parsed === null ||
      parsed.minMinor !== parsed.maxMinor ||
      !salaryMatchesQuestion(input.questionText, parsed)
    ) {
      return null;
    }

    const amount = String(parsed.minMinor / 100);

    return isNumeric(amount) ? { value: amount, unit } : null;
  }

  if (
    input.fieldType === "date" ||
    !answerIsValid(input.fieldType, input.options, input.value) ||
    (parsed !== null && !salaryMatchesQuestion(input.questionText, parsed))
  ) {
    return null;
  }

  return { value: input.value.trim(), unit };
}

function optionContainsSalary(option: string, target: SalaryValue) {
  const parsed = parseSalaryExpectation(option);

  if (parsed === null) {
    return false;
  }

  if (target.currency !== null && parsed.currency !== null && target.currency !== parsed.currency) {
    return false;
  }

  if (target.period !== null && parsed.period !== null && target.period !== parsed.period) {
    return false;
  }

  return parsed.minMinor <= target.minMinor && parsed.maxMinor >= target.maxMinor;
}

function formatNotice(input: {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  const parsed = parseNoticePeriod(input.value);
  const unit = parsed === null ? null : { currency: null, period: parsed.unit };

  if (isOptionField(input.fieldType)) {
    const exact = formatSelectValue(input.value, input.options, input.fieldType);

    if (exact !== null) {
      return { value: exact, unit };
    }

    if (parsed !== null) {
      const contained = input.options.filter((option) => optionMatchesNotice(option, parsed));

      if (contained.length === 1 && contained[0] !== undefined) {
        return { value: contained[0], unit };
      }
    }

    return null;
  }

  if (input.fieldType === "number") {
    if (parsed === null || requestedNoticeUnit(input.questionText) !== parsed.unit) {
      return null;
    }

    return { value: String(parsed.amount), unit };
  }

  if (input.fieldType === "date" || !answerIsValid(input.fieldType, input.options, input.value)) {
    return null;
  }

  return { value: input.value.trim(), unit };
}

function optionMatchesNotice(option: string, target: NoticeValue) {
  const parsed = parseNoticePeriod(option);

  return parsed !== null && parsed.amount === target.amount && parsed.unit === target.unit;
}

function formatDateFact(input: {
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  const parsed = parseDateValue(input.value);

  if (input.fieldType === "date") {
    return parsed === null ? null : { value: parsed, unit: null };
  }

  if (isOptionField(input.fieldType)) {
    const exact = formatSelectValue(input.value, input.options, input.fieldType);

    if (exact !== null) {
      return { value: exact, unit: null };
    }

    if (parsed !== null) {
      const contained = input.options.filter((option) => parseDateValue(option) === parsed);

      if (contained.length === 1 && contained[0] !== undefined) {
        return { value: contained[0], unit: null };
      }
    }

    return null;
  }

  if (input.fieldType === "number" || !answerIsValid(input.fieldType, input.options, input.value)) {
    return null;
  }

  return { value: input.value.trim(), unit: null };
}

function formatGeneric(input: {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  const value = input.value.trim();

  if (value === "") {
    return null;
  }

  if (isOptionField(input.fieldType)) {
    const answer =
      input.fieldType === "multiselect"
        ? formatMultiselectValue(value, input.options)
        : formatSelectValue(value, input.options, input.fieldType);

    return answer === null ? null : { value: answer, unit: null };
  }

  if (input.fieldType === "date") {
    const parsed = parseDateValue(value);

    return parsed === null ? null : { value: parsed, unit: null };
  }

  if (input.fieldType === "number") {
    const number = /-?[0-9]+(?:\.[0-9]+)?/u.exec(value)?.[0] ?? null;

    return number === null || !answerIsValid("number", input.options, number)
      ? null
      : { value: number, unit: null };
  }

  if (!answerIsValid(input.fieldType, input.options, value)) {
    return null;
  }

  const normalizedQuestion = normalizeQuestionText(input.questionText);

  if (normalizedQuestion === "first name" || normalizedQuestion === "given name") {
    const { first } = splitName(value);

    return first === "" ? null : { value: first, unit: null };
  }

  if (
    normalizedQuestion === "last name" ||
    normalizedQuestion === "family name" ||
    normalizedQuestion === "surname"
  ) {
    const { last } = splitName(value);

    return last === "" ? null : { value: last, unit: null };
  }

  return { value, unit: null };
}

function splitName(value: string) {
  const parts = value
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== "");

  return { first: parts.at(0) ?? "", last: parts.at(-1) ?? "" };
}

export function formatFactValue(input: {
  questionText: string;
  factKey: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  value: string;
}) {
  if (input.factKey === "salary_expectation") {
    return formatSalary(input);
  }

  if (input.factKey === "notice_period") {
    return formatNotice(input);
  }

  if (input.factKey === "earliest_start") {
    return formatDateFact(input);
  }

  return formatGeneric(input);
}

function isNegativeOption(option: string) {
  return /\b(?:do not|don't|dont|decline|refuse|not|no)\b/u.test(normalizeOptionText(option));
}

export function acknowledgementOption(questionText: string, options: readonly string[]) {
  const [single] = options;

  if (options.length === 1 && single !== undefined) {
    return isNegativeOption(single) ? null : single;
  }

  const affirmative = affirmativeOption(options);

  if (affirmative !== null) {
    return affirmative;
  }

  const matches = options.filter(
    (option) =>
      !isNegativeOption(option) &&
      /\b(?:acknowledg|confirm|agree|accept|read|consent)\b/u.test(normalizeOptionText(option)),
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}
