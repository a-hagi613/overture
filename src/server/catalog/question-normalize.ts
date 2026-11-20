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

export function matchOption(value: string, options: readonly string[]) {
  const folded = normalizeOptionText(value);

  if (folded === "") {
    return null;
  }

  const exact = options.find((option) => normalizeOptionText(option) === folded);

  if (exact !== undefined) {
    return exact;
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
    return null;
  }

  const wanted = positive ? AFFIRMATIVE : NEGATIVE;

  return options.find((option) => wanted.has(normalizeOptionText(option))) ?? null;
}

export function affirmativeOption(options: readonly string[]) {
  return matchOption(AFFIRMATIVE_OPTION, options);
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
