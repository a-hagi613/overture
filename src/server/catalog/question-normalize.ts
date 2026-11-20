import { createHash } from "node:crypto";

import type { QuestionFieldType } from "../../shared/questions.ts";

import { countryCodesNamedIn } from "./geo.ts";

const AFFIRMATIVE = new Set([
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

const NEGATIVE = new Set([
  "0",
  "disagree",
  "false",
  "i disagree",
  "i need sponsorship",
  "i require sponsorship",
  "i will require sponsorship",
  "n",
  "need sponsorship",
  "no",
  "not authorised",
  "not authorized",
  "require sponsorship",
]);

export const AFFIRMATIVE_OPTION = "Yes";

export const NEGATIVE_OPTION = "No";

function baseNormalize(text: string) {
  return text.normalize("NFKD").replaceAll(/\p{M}/gu, "").toLowerCase();
}

function normalizeWords(text: string) {
  return baseNormalize(text)
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function normalizeQuestionText(text: string, companyNames: readonly string[] = []) {
  let normalized = baseNormalize(text);

  for (const companyName of companyNames) {
    const folded = normalizeWords(companyName);

    if (folded !== "") {
      normalized = normalized.replaceAll(folded, " ");
    }
  }

  return normalized
    .replaceAll(/https?:\/\/\S+/gu, " ")
    .replaceAll(/[0-9]+/gu, " ")
    .replaceAll(/[^\p{L}]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function questionVariantHash(text: string, companyNames: readonly string[] = []) {
  return createHash("sha256").update(normalizeQuestionText(text, companyNames)).digest("hex");
}

const USER_COUNTRY_REFERENCE =
  /\b(?:country|countries|location|locations|place|places)\s*(?:\(s\)|s)?\s+(?:where|in which)\s+you\s+(?:currently\s+)?(?:live|reside|are based)\b|\b(?:location|locations)\s*\(s\)\s+you\s+(?:selected|chose)\b|\b(?:country|countries|location|locations)\s+you\s+(?:selected|chose)\b|\bcountry of residence\b|\bwhich country (?:do\s+)?you\s+(?:currently\s+)?(?:live|reside)\b/u;

export function countriesNamedIn(questionText: string) {
  return countryCodesNamedIn(questionText);
}

export function referencesUserCountry(questionText: string) {
  return USER_COUNTRY_REFERENCE.test(questionText.toLowerCase());
}

export function normalizeOptionText(text: string) {
  return normalizeWords(text);
}

export function questionOptionsHash(options: readonly string[]) {
  return createHash("sha256")
    .update(
      options
        .map((option) => normalizeOptionText(option))
        .toSorted()
        .join("\u0000"),
    )
    .digest("hex");
}

function normalizeFieldTypeValue(atsType: string, fieldName: string) {
  const name = baseNormalize(fieldName);

  if (name.includes("email")) {
    return "email";
  }

  if (name.includes("phone") || name.includes("mobile")) {
    return "phone";
  }

  if (/(?:^|_)url(?:$|_)/u.test(name) || name.includes("link")) {
    return "url";
  }

  if (name.includes("date")) {
    return "date";
  }

  switch (baseNormalize(atsType)) {
    case "textarea": {
      return "textarea";
    }

    case "multi_value_single_select": {
      return "select";
    }

    case "multi_value_multi_select": {
      return "multiselect";
    }

    case "boolean":
    case "checkbox": {
      return "checkbox";
    }

    case "input_file":
    case "file": {
      return "file";
    }

    case "date": {
      return "date";
    }

    case "number":
    case "currency":
    case "numeric": {
      return "number";
    }

    case "email": {
      return "email";
    }

    case "phone": {
      return "phone";
    }

    case "url": {
      return "url";
    }

    case "radio":
    case "single_select": {
      return "radio";
    }

    case "multiselect": {
      return "multiselect";
    }

    case "select": {
      return "select";
    }

    default: {
      return "text";
    }
  }
}

export const normalizeFieldType: (atsType: string, fieldName: string) => QuestionFieldType =
  normalizeFieldTypeValue;

export type OptionMatch =
  | { readonly matched: true; readonly option: string }
  | { readonly matched: false; readonly reason: "option_missing" };

const OPTION_MISSING: OptionMatch = { matched: false, reason: "option_missing" };

type SynonymTable = (normalized: string) => string | null;

function workAuthorizationType(text: string) {
  if (
    /\bnot\b.*\b(?:authori[sz]ed|eligible|permitted)\b/u.test(text) ||
    /\bno (?:right|authori[sz]ation|permit) to work\b/u.test(text) ||
    /\b(?:need|needs|require|requires) (?:visa|immigration) support\b/u.test(text) ||
    /\bcannot work\b/u.test(text)
  ) {
    return "not_authorized";
  }

  if (
    /\b(?:permanent resident|permanent residency|green card|landed immigrant|indefinite leave to remain|ilr|settled status)\b/u.test(
      text,
    )
  ) {
    return "permanent_resident";
  }

  if (/\b(?:citizen|nationality|naturali[sz]ed)\b/u.test(text)) {
    return "citizen";
  }

  if (/\b(?:work permit|work visa|permit)\b/u.test(text)) {
    if (/\b(?:do not|does not|don t|without|no)\b.*\bsponsor/u.test(text)) {
      return "permit_no_sponsorship";
    }

    if (/\bsponsor/u.test(text)) {
      return "permit_sponsored";
    }

    return null;
  }

  return null;
}

const COUNTRY_ALIASES = {
  Argentina: ["argentina"],
  Australia: ["australia", "aus"],
  Austria: ["austria"],
  Bahrain: ["bahrain"],
  Bangladesh: ["bangladesh"],
  Belgium: ["belgium"],
  Brazil: ["brazil", "brasil"],
  Bulgaria: ["bulgaria"],
  Canada: ["canada"],
  Chile: ["chile"],
  China: ["china", "prc", "mainland china", "people s republic of china"],
  Colombia: ["colombia"],
  "Costa Rica": ["costa rica"],
  Croatia: ["croatia"],
  Czechia: ["czechia", "czech republic"],
  Denmark: ["denmark"],
  Egypt: ["egypt"],
  Estonia: ["estonia"],
  Finland: ["finland"],
  France: ["france"],
  Germany: ["germany", "deutschland"],
  Ghana: ["ghana"],
  Greece: ["greece"],
  "Hong Kong": ["hong kong", "hong kong sar"],
  Hungary: ["hungary"],
  Iceland: ["iceland"],
  India: ["india"],
  Indonesia: ["indonesia"],
  Ireland: ["ireland", "republic of ireland"],
  Israel: ["israel"],
  Italy: ["italy"],
  Japan: ["japan"],
  Jordan: ["jordan"],
  Kenya: ["kenya"],
  Kuwait: ["kuwait"],
  Latvia: ["latvia"],
  Lebanon: ["lebanon"],
  Lithuania: ["lithuania"],
  Luxembourg: ["luxembourg"],
  Malaysia: ["malaysia"],
  Mexico: ["mexico"],
  Netherlands: ["netherlands", "the netherlands", "holland"],
  "New Zealand": ["new zealand", "nz"],
  Nigeria: ["nigeria"],
  "North Korea": ["north korea", "dprk"],
  Norway: ["norway"],
  Oman: ["oman"],
  Pakistan: ["pakistan"],
  Panama: ["panama"],
  Peru: ["peru"],
  Philippines: ["philippines"],
  Poland: ["poland"],
  Portugal: ["portugal"],
  Qatar: ["qatar"],
  Romania: ["romania"],
  "Saudi Arabia": ["saudi arabia", "ksa"],
  Serbia: ["serbia"],
  Singapore: ["singapore"],
  Slovakia: ["slovakia"],
  Slovenia: ["slovenia"],
  "South Africa": ["south africa"],
  "South Korea": ["south korea", "korea", "republic of korea", "korea republic of"],
  Spain: ["spain"],
  Sweden: ["sweden"],
  Switzerland: ["switzerland"],
  Taiwan: ["taiwan", "taiwan region"],
  Thailand: ["thailand"],
  Turkey: ["turkey", "turkiye"],
  "United Arab Emirates": ["united arab emirates", "uae", "u a e"],
  "United Kingdom": ["united kingdom", "uk", "u k", "great britain", "britain"],
  "United States": [
    "united states",
    "united states of america",
    "us",
    "usa",
    "u s",
    "u s a",
    "america",
  ],
  Uruguay: ["uruguay"],
  Vietnam: ["vietnam"],
} satisfies Record<string, readonly string[]>;

const COUNTRY_BY_ALIAS = new Map(
  Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) =>
    aliases.map((alias) => [alias, country] as const),
  ),
);

function countryName(text: string) {
  return COUNTRY_BY_ALIAS.get(text) ?? null;
}

function degreeLevel(text: string) {
  if (
    /\b(?:jd|md|dds|dvm|pharmd|doctor of medicine|doctor of law|professional degree)\b/u.test(text)
  ) {
    return "professional";
  }

  if (/\b(?:phd|ph d|doctorate|doctoral|doctor of philosophy|edd|dba)\b/u.test(text)) {
    return "doctorate";
  }

  if (/\b(?:master|masters|msc|mba|graduate degree|postgraduate)\b/u.test(text)) {
    return "master";
  }

  if (/\b(?:bachelor|bachelors|bsc|undergraduate)\b/u.test(text)) {
    return "bachelor";
  }

  if (/\b(?:associate|associates)\b/u.test(text)) {
    return "associate";
  }

  if (/\b(?:high school|secondary school|ged|hs diploma)\b/u.test(text)) {
    return "high_school";
  }

  if (/\bsome college\b/u.test(text)) {
    return "some_college";
  }

  if (/\b(?:no degree|none)\b/u.test(text)) {
    return "none";
  }

  return null;
}

const NUMBER_WORDS = new Map<string, number>([
  ["eight", 8],
  ["eleven", 11],
  ["five", 5],
  ["four", 4],
  ["nine", 9],
  ["one", 1],
  ["seven", 7],
  ["six", 6],
  ["ten", 10],
  ["three", 3],
  ["twelve", 12],
  ["two", 2],
]);

const NOTICE_QUANTITY =
  /\b(?<quantity>\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?<unit>day|week|month|year)s?\b/gu;

function noticePeriod(text: string) {
  if (/\b(?:immediate(?:ly)?|asap|right away|at once|no notice)\b/u.test(text)) {
    return "immediate";
  }

  const matches = [...text.matchAll(NOTICE_QUANTITY)];

  if (matches.length !== 1) {
    return null;
  }

  const [match] = matches;
  const quantityText = match?.groups?.quantity ?? "";
  const unit = match?.groups?.unit ?? "";

  const quantity = /^\d+$/u.test(quantityText)
    ? Math.trunc(Number(quantityText))
    : (NUMBER_WORDS.get(quantityText) ?? Number.NaN);

  if (!Number.isInteger(quantity)) {
    return null;
  }

  if (quantity === 0) {
    return "immediate";
  }

  let qualifier = "";

  if (/\b(?:more than|over|at least)\b/u.test(text)) {
    qualifier = "over";
  } else if (/\b(?:less than|under|at most|or less|up to)\b/u.test(text)) {
    qualifier = "under";
  }

  return `${qualifier === "" ? "" : `${qualifier} `}${String(quantity)} ${unit}`;
}

const SALARY_PERIOD_WORD =
  /^(?:annual|annually|yearly|year|monthly|month|weekly|week|daily|day|hourly|hour|per year|per month|per week|per day|per hour|per annum|pcm)$/u;

const SALARY_HINT = /\b(?:salary|compensation|pay|annum|per)\b/u;

function salaryPeriod(text: string) {
  if (!SALARY_PERIOD_WORD.test(text) && !SALARY_HINT.test(text)) {
    return null;
  }

  if (/\b(?:annual|annually|yearly|year|annum)\b/u.test(text)) {
    return "year";
  }

  if (/\b(?:monthly|month|pcm)\b/u.test(text)) {
    return "month";
  }

  if (/\b(?:weekly|week)\b/u.test(text)) {
    return "week";
  }

  if (/\b(?:daily|day)\b/u.test(text)) {
    return "day";
  }

  if (/\b(?:hourly|hour)\b/u.test(text)) {
    return "hour";
  }

  return null;
}

const SYNONYM_TABLES: readonly SynonymTable[] = [
  workAuthorizationType,
  countryName,
  degreeLevel,
  noticePeriod,
  salaryPeriod,
];

function matchBySynonymTable(folded: string, options: readonly string[]) {
  for (const table of SYNONYM_TABLES) {
    const wanted = table(folded);

    if (wanted === null) {
      continue;
    }

    const candidates = options.filter((option) => table(normalizeOptionText(option)) === wanted);

    if (candidates.length === 1) {
      return candidates[0] ?? null;
    }

    if (candidates.length > 1) {
      return null;
    }
  }

  return null;
}

export const matchOption: (value: string, options: readonly string[]) => OptionMatch = (
  value,
  options,
) => {
  const folded = normalizeOptionText(value);

  if (folded === "") {
    return OPTION_MISSING;
  }

  const exact = options.find((option) => normalizeOptionText(option) === folded);

  if (exact !== undefined) {
    return { matched: true, option: exact };
  }

  const synonym = matchBySynonymTable(folded, options);

  if (synonym !== null) {
    return { matched: true, option: synonym };
  }

  const negative =
    NEGATIVE.has(folded) ||
    /\b(?:require|need)\b.*\bsponsor/u.test(folded) ||
    /\b(?:not|no|never)\b.*\b(?:authori[sz]ed|eligible|citizen|permit)\b/u.test(folded);

  const positive =
    !negative &&
    (AFFIRMATIVE.has(folded) ||
      /\b(?:citizen|permanent resident|authori[sz]ed|eligible|yes)\b/u.test(folded));

  if (!positive && !negative) {
    return OPTION_MISSING;
  }

  const wanted = positive ? AFFIRMATIVE : NEGATIVE;
  const option = options.find((candidate) => wanted.has(normalizeOptionText(candidate)));

  return option === undefined ? OPTION_MISSING : { matched: true, option };
};

export function affirmativeOption(options: readonly string[]) {
  const match = matchOption(AFFIRMATIVE_OPTION, options);

  return match.matched ? match.option : null;
}

export function factPolarity(value: string) {
  const folded = normalizeOptionText(value);

  if (NEGATIVE.has(folded)) {
    return "negative" as const;
  }

  if (AFFIRMATIVE.has(folded)) {
    return "affirmative" as const;
  }

  if (/\b(?:no|not|never|do not|don t)\b/u.test(folded)) {
    return "negative" as const;
  }

  if (/\b(?:yes|willing|open to|happy to)\b/u.test(folded)) {
    return "affirmative" as const;
  }

  return null;
}

const AVAILABILITY_PATTERN =
  /\b(?:on call|oncall|weekend|evening|night shift|shift|overtime|holiday|notice period|start date|start within|earliest start|relocat|travel|available|availability|open to)\b/u;

const EXPERIENCE_PATTERN =
  /\b(?:year|years|experience|kubernetes|terraform|managed|leading|led|built|shipped|degree|education|certif|skill|technolog)\b/u;

const AUTHORIZATION_PATTERN =
  /\b(?:authoriz|authoris|sponsor|visa|clearance|citizen|permit|work in|eligib|right to work|legally)\b/u;

const LINKS_PATTERN = /\b(?:portfolio|website|github|linkedin|link|url|homepage|blog)\b/u;

export function reviewCategory(text: string, factKey: string | null) {
  if (factKey !== null) {
    if (
      factKey === "notice_period" ||
      factKey === "earliest_start" ||
      factKey === "willing_relocate" ||
      factKey === "salary_expectation"
    ) {
      return "availability";
    }

    if (
      factKey === "years_total" ||
      factKey === "degree_highest" ||
      factKey === "employment_history" ||
      factKey === "education_history" ||
      factKey === "skills" ||
      factKey === "certifications"
    ) {
      return "experience";
    }

    if (
      factKey === "work_auth" ||
      factKey === "sponsorship_required" ||
      factKey === "security_clearance" ||
      factKey === "drivers_license"
    ) {
      return "work_authorization";
    }

    if (factKey === "linkedin_url" || factKey === "github_url" || factKey === "website_url") {
      return "links";
    }

    if (factKey === "languages" || factKey === "spoken_languages_levels") {
      return "languages";
    }

    if (factKey.startsWith("eeo_")) {
      return "eeo";
    }

    return "identity";
  }

  const folded = ` ${normalizeQuestionText(text)} `;

  if (AUTHORIZATION_PATTERN.test(folded)) {
    return "work_authorization";
  }

  if (LINKS_PATTERN.test(folded)) {
    return "links";
  }

  if (AVAILABILITY_PATTERN.test(folded)) {
    return "availability";
  }

  if (EXPERIENCE_PATTERN.test(folded)) {
    return "experience";
  }

  return "other";
}
