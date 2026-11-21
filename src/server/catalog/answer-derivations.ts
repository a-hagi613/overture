import type { QuestionFieldType } from "../../shared/questions.ts";
import type { Targets } from "../../shared/targets.ts";

import {
  countryCodesNamedIn,
  countryNameFor,
  regionNameFor,
  resolveLocation,
  usStateNames,
} from "./geo.ts";
import { factPolarity, matchOption, normalizeOptionText } from "./question-normalize.ts";
import { normalizeCompanyName } from "../profile/skip-companies.ts";

export const TARGET_DERIVATION_KEYS = [
  "target_countries",
  "target_workplace",
  "target_relocation",
] as const;

export const DERIVED_ANSWER_KEYS = [
  "employed_by_company",
  "us_state_residence",
  "city_region",
  "city_region_country",
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
  const codes = new Set<string>();

  for (const location of targets.locations) {
    const code = resolveLocation(location).countryCode;

    if (code !== null) {
      codes.add(code);
    }
  }

  return codes;
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

function deriveTargetWorkplace(input: DerivationInput) {
  const workplaces = new Set(input.targets.workplaces);

  if (workplaces.size === 0) {
    return null;
  }

  const question = normalizeOptionText(input.questionText);
  const remote = /\b(?:remote|remotely)\b/u.test(question);
  const office = /\b(?:office|on site|onsite|hybrid|in person)\b/u.test(question);

  if (!remote && !office) {
    return null;
  }

  const affirmative = remote
    ? workplaces.has("remote")
    : workplaces.has("hybrid") || workplaces.has("onsite");

  return optionWithPolarity(input.options, affirmative);
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

const DERIVATIONS: Record<DerivationKey, (input: DerivationInput) => string | null> = {
  target_countries: deriveTargetCountries,
  target_workplace: deriveTargetWorkplace,
  target_relocation: deriveTargetRelocation,
  employed_by_company: deriveEmployedByCompany,
  us_state_residence: deriveUsStateResidence,
  city_region: deriveCityRegion,
  city_region_country: deriveCityRegionCountry,
};

export function deriveAnswer(key: DerivationKey, input: DerivationInput) {
  return DERIVATIONS[key](input);
}
