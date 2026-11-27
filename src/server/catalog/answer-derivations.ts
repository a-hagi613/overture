import type { QuestionFieldType } from "../../shared/questions.ts";
import type { Targets } from "../../shared/targets.ts";

import {
  countryCodesNamedIn,
  countryNameFor,
  regionNameFor,
  resolveLocation,
  usStateNames,
} from "./geo.ts";
import { countryCodesOfPlaceIds } from "../places/catalog.ts";
import { factPolarity, matchOption, normalizeOptionText } from "./question-normalize.ts";
import { normalizeCompanyName } from "../profile/skip-companies.ts";

export const TARGET_DERIVATION_KEYS = ["target_countries", "target_relocation"] as const;

export const DERIVED_ANSWER_KEYS = [
  "employed_by_company",
  "us_state_residence",
  "city_region",
  "city_region_country",
  "work_auth_status",
  "sponsorship_status",
  "english_fluency",
  "role_category",
] as const;

export const DERIVATION_KEYS = [...TARGET_DERIVATION_KEYS, ...DERIVED_ANSWER_KEYS] as const;

export type TargetDerivationKey = (typeof TARGET_DERIVATION_KEYS)[number];

export type DerivedAnswerKey = (typeof DERIVED_ANSWER_KEYS)[number];

export type DerivationKey = (typeof DERIVATION_KEYS)[number];

export interface DerivationFact {
  value: string;
  confirmed: boolean;
}

export interface PostingPlace {
  companyName: string;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  locationRaw: string | null;
}

export interface DerivationInput {
  questionText: string;
  fieldType: QuestionFieldType;
  options: readonly string[];
  targets: Targets;
  posting: PostingPlace;
  facts: ReadonlyMap<string, DerivationFact>;
}

export function isTargetDerivationKey(key: string): key is TargetDerivationKey {
  return TARGET_DERIVATION_KEYS.some((candidate) => candidate === key);
}

export function isDerivedAnswerKey(key: string): key is DerivedAnswerKey {
  return DERIVED_ANSWER_KEYS.some((candidate) => candidate === key);
}

export function isDerivationKey(key: string): key is DerivationKey {
  return isTargetDerivationKey(key) || isDerivedAnswerKey(key);
}

function factOf(input: DerivationInput, key: string) {
  return input.facts.get(key) ?? null;
}

function containsPhrase(haystack: string, phrase: string) {
  return ` ${haystack} `.includes(` ${phrase} `);
}

function optionWithPolarity(options: readonly string[], affirmative: boolean) {
  const direct = matchOption(affirmative ? "Yes" : "No", options);

  if (direct.matched) {
    return direct.option;
  }

  const prefix = affirmative ? /^(?:yes|y)\b/u : /^(?:no|n)\b/u;
  const byPrefix = options.find((option) => prefix.test(normalizeOptionText(option)));

  if (byPrefix !== undefined) {
    return byPrefix;
  }

  const words = affirmative
    ? /\b(?:willing|open to|happy to|intend to work remotely)\b/u
    : /\b(?:not willing|do not|office|on site|onsite)\b/u;

  return options.find((option) => words.test(normalizeOptionText(option))) ?? null;
}

function countryCodeForOption(option: string) {
  const named = countryCodesNamedIn(option);

  if (named.length === 1) {
    return named[0] ?? null;
  }

  return resolveLocation(option).countryCode;
}

function targetCountryCodes(targets: Targets) {
  return new Set(countryCodesOfPlaceIds(targets.locations));
}

function deriveTargetCountries(input: DerivationInput) {
  const targetCodes = targetCountryCodes(input.targets);

  if (targetCodes.size === 0) {
    return null;
  }

  const postingCountry =
    input.posting.countryCode ?? resolveLocation(input.posting.locationRaw).countryCode;

  if (postingCountry !== null && !targetCodes.has(postingCountry)) {
    return null;
  }

  const wanted = postingCountry === null ? targetCodes : new Set([postingCountry]);

  const matched = input.options.filter((option) => {
    const code = countryCodeForOption(option);

    return code !== null && wanted.has(code);
  });

  if (matched.length === 0) {
    return null;
  }

  if (input.fieldType === "multiselect") {
    return matched.join(", ");
  }

  return matched.length === 1 ? (matched[0] ?? null) : null;
}

const CURRENT_LOCATION_OPTION = /\b(?:currently live|currently located|i live in)\b/u;

const NOT_WILLING_OPTION = /\b(?:not willing|do not live|not open to|not relocate)\b/u;

const WILLING_OPTION = /\b(?:willing to relocate|open to relocat|willing to move)\b/u;

function currentCityIsNamedInQuestion(input: DerivationInput) {
  const city = factOf(input, "current_city")?.value.trim() ?? "";

  if (city === "") {
    return false;
  }

  const resolved = resolveLocation(city);
  const question = normalizeOptionText(input.questionText);

  const names = [resolved.city, regionNameFor(resolved.countryCode, resolved.region), city].flatMap(
    (name) => (name === null || name.trim() === "" ? [] : [normalizeOptionText(name)]),
  );

  return names.some((name) => containsPhrase(question, name));
}

function deriveTargetRelocation(input: DerivationInput) {
  const { options } = input;

  const current = options.find((option) =>
    CURRENT_LOCATION_OPTION.test(normalizeOptionText(option)),
  );

  const notWilling = options.find((option) => NOT_WILLING_OPTION.test(normalizeOptionText(option)));

  const willing = options.find((option) => {
    const normalized = normalizeOptionText(option);

    return WILLING_OPTION.test(normalized) && !NOT_WILLING_OPTION.test(normalized);
  });

  if (currentCityIsNamedInQuestion(input) && current !== undefined) {
    return current;
  }

  const relocate = factOf(input, "willing_relocate");
  const polarity = relocate === null ? null : factPolarity(relocate.value);

  if (polarity === "affirmative" && willing !== undefined) {
    return willing;
  }

  if (polarity === "negative" && notWilling !== undefined) {
    return notWilling;
  }

  return null;
}

function mentionsCompany(text: string, company: string) {
  return containsPhrase(normalizeCompanyName(text), company);
}

function deriveEmployedByCompany(input: DerivationInput) {
  const company = normalizeCompanyName(input.posting.companyName);

  if (company === "") {
    return null;
  }

  const currentEmployer = factOf(input, "current_employer");

  if (currentEmployer !== null && mentionsCompany(currentEmployer.value, company)) {
    return optionWithPolarity(input.options, true);
  }

  const history = factOf(input, "employment_history");

  if (history === null) {
    return null;
  }

  if (mentionsCompany(history.value, company)) {
    return optionWithPolarity(input.options, true);
  }

  return history.confirmed ? optionWithPolarity(input.options, false) : null;
}

function questionListsState(question: string, region: string) {
  const words = normalizeOptionText(question).split(" ");

  const target = normalizeOptionText(region)
    .split(" ")
    .filter((word) => word !== "");

  const states = new Set(usStateNames());

  for (let index = 0; index <= words.length - target.length; index += 1) {
    const matches = target.every((word, offset) => words[index + offset] === word);

    if (!matches) {
      continue;
    }

    const before = words[index - 1];
    const longer = before === undefined ? null : normalizeOptionText(`${before} ${region}`);

    if (longer !== null && states.has(longer)) {
      continue;
    }

    return true;
  }

  return false;
}

function deriveUsStateResidence(input: DerivationInput) {
  const city = factOf(input, "current_city")?.value ?? null;
  const country = factOf(input, "current_country")?.value ?? null;
  const resolvedCity = resolveLocation(city);
  const countryCode = resolveLocation(country).countryCode ?? resolvedCity.countryCode;

  if (countryCode === null) {
    return null;
  }

  if (countryCode !== "US") {
    return optionWithPolarity(input.options, false);
  }

  const region = regionNameFor("US", resolvedCity.region);

  if (region === null) {
    return null;
  }

  if (questionListsState(input.questionText, region)) {
    return optionWithPolarity(input.options, true);
  }

  const listsStates = usStateNames().some((name) => questionListsState(input.questionText, name));

  return listsStates ? optionWithPolarity(input.options, false) : null;
}

function currentPlace(input: DerivationInput) {
  const raw = factOf(input, "current_city")?.value.trim() ?? "";

  if (raw === "") {
    return null;
  }

  const resolved = resolveLocation(raw);
  const city = resolved.city ?? (raw.split(",")[0] ?? raw).trim();
  const region = regionNameFor(resolved.countryCode, resolved.region);
  const countryFact = factOf(input, "current_country")?.value ?? null;
  const countryCode = resolveLocation(countryFact).countryCode ?? resolved.countryCode;

  return {
    city,
    region: region === city ? null : region,
    country: countryCode === null ? null : countryNameFor(countryCode),
  };
}

function deriveCityRegion(input: DerivationInput) {
  const place = currentPlace(input);

  if (place === null) {
    return null;
  }

  return [place.city, place.region].filter((part): part is string => part !== null).join(", ");
}

function deriveCityRegionCountry(input: DerivationInput) {
  const place = currentPlace(input);

  if (place === null) {
    return null;
  }

  return [place.city, place.region, place.country]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");
}

const NATIONALITY_CODES: ReadonlyMap<string, string> = new Map([
  ["american", "US"],
  ["australian", "AU"],
  ["brazilian", "BR"],
  ["british", "GB"],
  ["canadian", "CA"],
  ["chinese", "CN"],
  ["colombian", "CO"],
  ["danish", "DK"],
  ["dutch", "NL"],
  ["french", "FR"],
  ["german", "DE"],
  ["indian", "IN"],
  ["irish", "IE"],
  ["israeli", "IL"],
  ["italian", "IT"],
  ["japanese", "JP"],
  ["mexican", "MX"],
  ["new zealander", "NZ"],
  ["nigerian", "NG"],
  ["norwegian", "NO"],
  ["pakistani", "PK"],
  ["philippine", "PH"],
  ["filipino", "PH"],
  ["polish", "PL"],
  ["portuguese", "PT"],
  ["romanian", "RO"],
  ["singaporean", "SG"],
  ["south african", "ZA"],
  ["spanish", "ES"],
  ["swedish", "SE"],
  ["swiss", "CH"],
  ["ukrainian", "UA"],
  ["uruguayan", "UY"],
]);

function statedCountryCodes(value: string) {
  const folded = normalizeOptionText(value);
  const codes = new Set(countryCodesNamedIn(value));

  for (const [nationality, code] of NATIONALITY_CODES) {
    if (containsPhrase(folded, nationality)) {
      codes.add(code);
    }
  }

  return [...codes];
}

function countryMatchesQuestion(questionText: string, value: string) {
  const asked = countryCodesNamedIn(questionText);

  if (asked.length === 0) {
    return true;
  }

  const stated = statedCountryCodes(value);

  return stated.length === 0 || stated.some((code) => asked.includes(code));
}

/**
 * Whether a stored work-authorisation value may answer a question: a question
 * that names a country is never answered by a value that names only other
 * countries, so a Canadian citizen is not reported as allowed to work in the US.
 *
 * @param questionText The question a board asks.
 * @param value The confirmed work-authorisation or sponsorship Fact.
 * @returns true when the countries agree, or when either side names none.
 */
export function workAuthorizationFitsQuestion(questionText: string, value: string) {
  return countryMatchesQuestion(questionText, value);
}

function confirmedFact(input: DerivationInput, key: string) {
  const fact = factOf(input, key);

  return fact === null || !fact.confirmed ? null : fact;
}

function authorizationOf(value: string) {
  const folded = normalizeOptionText(value);

  if (/\bno\b.*\bsponsor|\bdo(?:es)? not (?:require|need) spons|\bwithout spons/u.test(folded)) {
    return "authorized" as const;
  }

  if (/\b(?:need|needs|require|requires|will require)\b.*\bsponsor/u.test(folded)) {
    return "not_authorized" as const;
  }

  if (
    /\bcitizen|permanent resident|green card|authori[sz]ed|eligible|right to work|work permit|unrestricted|no restriction/u.test(
      folded,
    )
  ) {
    return "authorized" as const;
  }

  if (
    /\bnot\b.*\b(?:authori[sz]ed|eligible|permit)\b|\bcannot work\b|\bno (?:right|permit|authori[sz]ation) to work\b/u.test(
      folded,
    )
  ) {
    return "not_authorized" as const;
  }

  const polarity = factPolarity(value);

  if (polarity === "affirmative") {
    return "authorized" as const;
  }

  return polarity === "negative" ? ("not_authorized" as const) : null;
}

function sponsorshipOf(value: string) {
  const folded = normalizeOptionText(value);

  if (
    /\bno\b.*\bsponsor|\bdo(?:es)? not (?:require|need) spons|\bwithout spons|\bnot required\b/u.test(
      folded,
    )
  ) {
    return "none" as const;
  }

  if (/\b(?:need|needs|require|requires|will require)\b.*\bsponsor/u.test(folded)) {
    return "needs" as const;
  }

  const polarity = factPolarity(value);

  if (polarity === "affirmative") {
    return "needs" as const;
  }

  return polarity === "negative" ? ("none" as const) : null;
}

function deriveWorkAuthStatus(input: DerivationInput) {
  const workAuth = confirmedFact(input, "work_auth");

  if (workAuth !== null) {
    if (!countryMatchesQuestion(input.questionText, workAuth.value)) {
      return null;
    }

    const status = authorizationOf(workAuth.value);

    if (status !== null) {
      return optionWithPolarity(input.options, status === "authorized");
    }
  }

  const sponsorship = confirmedFact(input, "sponsorship_required");

  if (sponsorship !== null && countryMatchesQuestion(input.questionText, sponsorship.value)) {
    const status = sponsorshipOf(sponsorship.value);

    if (status !== null) {
      return optionWithPolarity(input.options, status === "none");
    }
  }

  return null;
}

function deriveSponsorshipStatus(input: DerivationInput) {
  const sponsorship = confirmedFact(input, "sponsorship_required");

  if (sponsorship !== null) {
    if (!countryMatchesQuestion(input.questionText, sponsorship.value)) {
      return null;
    }

    const status = sponsorshipOf(sponsorship.value);

    if (status !== null) {
      return optionWithPolarity(input.options, status === "needs");
    }
  }

  const workAuth = confirmedFact(input, "work_auth");

  if (workAuth !== null && countryMatchesQuestion(input.questionText, workAuth.value)) {
    const status = authorizationOf(workAuth.value);

    if (status !== null) {
      return optionWithPolarity(input.options, status === "not_authorized");
    }
  }

  return null;
}

function deriveEnglishFluency(input: DerivationInput) {
  const languages = confirmedFact(input, "languages");

  if (languages === null || !containsPhrase(normalizeOptionText(languages.value), "english")) {
    return null;
  }

  return optionWithPolarity(input.options, true);
}

const ROLE_TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "associate",
  "at",
  "chief",
  "director",
  "for",
  "head",
  "in",
  "intern",
  "junior",
  "lead",
  "manager",
  "of",
  "on",
  "or",
  "principal",
  "senior",
  "staff",
  "the",
  "to",
  "vp",
]);

const ROLE_SUFFIXES = ["ments", "ment", "ings", "ing", "ers", "er", "es", "s"] as const;

function stemRoleWord(word: string) {
  let stem = word;

  for (const suffix of ROLE_SUFFIXES) {
    if (stem.length - suffix.length >= 4 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
    }
  }

  return stem;
}

function roleWords(text: string) {
  return normalizeOptionText(text)
    .split(" ")
    .filter((word) => word.length > 1 && !ROLE_TITLE_STOP_WORDS.has(word))
    .map((word) => stemRoleWord(word));
}

function deriveRoleCategory(input: DerivationInput) {
  const title = confirmedFact(input, "current_job_title");

  if (title === null) {
    return null;
  }

  const wanted = new Set(roleWords(title.value));

  if (wanted.size === 0) {
    return null;
  }

  const scored = input.options.map((option) => ({
    option,
    score: roleWords(option).filter((word) => wanted.has(word)).length,
  }));

  const best = Math.max(...scored.map((entry) => entry.score));

  if (best === 0) {
    return null;
  }

  const winners = scored.filter((entry) => entry.score === best);

  return winners.length === 1 ? (winners[0]?.option ?? null) : null;
}

const DERIVATIONS: Record<DerivationKey, (input: DerivationInput) => string | null> = {
  target_countries: deriveTargetCountries,
  target_relocation: deriveTargetRelocation,
  employed_by_company: deriveEmployedByCompany,
  us_state_residence: deriveUsStateResidence,
  city_region: deriveCityRegion,
  city_region_country: deriveCityRegionCountry,
  work_auth_status: deriveWorkAuthStatus,
  sponsorship_status: deriveSponsorshipStatus,
  english_fluency: deriveEnglishFluency,
  role_category: deriveRoleCategory,
};

export function deriveAnswer(key: DerivationKey, input: DerivationInput) {
  return DERIVATIONS[key](input);
}
