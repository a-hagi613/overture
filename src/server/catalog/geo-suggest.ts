import type { LocationSuggestion } from "../../shared/supply.ts";

import {
  countryNameFor,
  geoCities,
  geoContinents,
  geoCountries,
  geoMetros,
  geoRegions,
  normalizePlaceName,
} from "./geo.ts";

interface IndexedPlace {
  readonly value: string;
  readonly label: string;
  readonly meta: string;
  readonly kind: LocationSuggestion["kind"];
  readonly normName: string;
  readonly words: readonly string[];
  readonly searchKeys: readonly string[];
  readonly weight: number;
}

const DEFAULT_SUGGESTIONS: readonly LocationSuggestion[] = [
  { kind: "country", label: "United States", meta: "Country", value: "United States" },
  { kind: "country", label: "Canada", meta: "Country", value: "Canada" },
  { kind: "country", label: "United Kingdom", meta: "Country", value: "United Kingdom" },
  { kind: "continent", label: "Europe", meta: "Continent", value: "Europe" },
  { kind: "continent", label: "North America", meta: "Continent", value: "North America" },
  { kind: "city", label: "New York", meta: "New York, United States", value: "New York" },
  { kind: "city", label: "Toronto", meta: "Ontario, Canada", value: "Toronto" },
  { kind: "city", label: "London", meta: "England, United Kingdom", value: "London" },
];

const COUNTRY_SEARCH_ALIASES = new Map<string, readonly string[]>([
  ["US", ["usa", "united states of america", "america", "us"]],
  ["GB", ["uk", "britain", "great britain", "england", "scotland", "wales"]],
  ["AE", ["uae", "emirates"]],
  ["DE", ["deutschland"]],
]);

function splitWords(normalized: string) {
  return normalized.split(/\s+/u).filter((word) => word.length > 0);
}

function formatCityMeta(
  countryCode: string,
  isoRegionCode: string,
  regionsByIso: ReadonlyMap<string, string>,
) {
  const region = regionsByIso.get(isoRegionCode);
  const country = countryNameFor(countryCode) ?? countryCode;

  if (region !== undefined && region !== "") {
    return `${region}, ${country}`;
  }

  return country;
}

function buildPlaceIndex() {
  const regionsByIso = new Map<string, string>();
  const entries: IndexedPlace[] = [];

  for (const region of geoRegions()) {
    regionsByIso.set(region.isoCode, region.name);
  }

  for (const continent of geoContinents()) {
    const normName = normalizePlaceName(continent.name);

    const keys = [
      normName,
      continent.code.toLowerCase(),
      ...continent.aliases.map((alias) => normalizePlaceName(alias)),
    ];

    entries.push({
      kind: "continent",
      label: continent.name,
      meta: "Continent",
      normName,
      searchKeys: keys.filter((item) => item.length > 0),
      value: continent.name,
      weight: 220,
      words: splitWords(normName),
    });
  }

  for (const country of geoCountries()) {
    const normName = normalizePlaceName(country.name);
    const extraAliases = COUNTRY_SEARCH_ALIASES.get(country.code) ?? [];
    const keys = [normName, country.code.toLowerCase(), ...extraAliases];

    entries.push({
      kind: "country",
      label: country.name,
      meta: "Country",
      normName,
      searchKeys: keys.filter((item) => item.length > 0),
      value: country.name,
      weight: 210,
      words: splitWords(normName),
    });
  }

  for (const metro of geoMetros()) {
    const normName = metro.norm;
    const keys = [normName, ...metro.aliases.map((alias) => normalizePlaceName(alias))];
    const country = countryNameFor(metro.countryCode) ?? metro.countryCode;

    entries.push({
      kind: "metro",
      label: metro.name,
      meta: `${country} · Metro`,
      normName,
      searchKeys: keys.filter((item) => item.length > 0),
      value: metro.name,
      weight: 195,
      words: splitWords(normName),
    });
  }

  for (const region of geoRegions()) {
    const normName = normalizePlaceName(region.name);
    const country = countryNameFor(region.countryCode) ?? region.countryCode;

    entries.push({
      kind: "region",
      label: region.name,
      meta: `${country} · Region`,
      normName,
      searchKeys: [normName].filter((item) => item.length > 0),
      value: region.name,
      weight: 155,
      words: splitWords(normName),
    });
  }

  for (const city of geoCities()) {
    const normName = normalizePlaceName(city.name);

    const altKeys = city.altNames
      .split("|")
      .slice(0, 6)
      .flatMap((alias) => {
        const cleaned = normalizePlaceName(alias);

        return cleaned.length > 0 ? [cleaned] : [];
      });

    entries.push({
      kind: "city",
      label: city.name,
      meta: formatCityMeta(city.countryCode, city.isoRegionCode, regionsByIso),
      normName,
      searchKeys: [normName, ...altKeys],
      value: city.name,
      weight: Math.round(Math.log10(Math.max(1000, city.population)) * 30),
      words: splitWords(normName),
    });
  }

  return entries;
}

let cachedIndex: readonly IndexedPlace[] | null = null;

function placeIndex() {
  cachedIndex ??= buildPlaceIndex();

  return cachedIndex;
}

function isOrderedSubsequence(target: string, query: string) {
  let cursor = 0;

  for (let index = 0; index < target.length && cursor < query.length; index += 1) {
    if (target[index] === query[cursor]) {
      cursor += 1;
    }
  }

  return cursor === query.length;
}

function wordBridgeScore(words: readonly string[], query: string) {
  if (words.length < 2 || query.length < 2) {
    return 0;
  }

  const first = words[0] ?? "";
  const second = words[1] ?? "";

  for (let split = 1; split < query.length; split += 1) {
    const left = query.slice(0, split);
    const right = query.slice(split);

    if (first.startsWith(left) && second.startsWith(right)) {
      return 870;
    }
  }

  return 0;
}

function scorePlace(place: IndexedPlace, normalizedQuery: string, queryWords: readonly string[]) {
  if (place.normName === normalizedQuery) {
    return 1000 + place.weight;
  }

  if (place.kind !== "city" && place.searchKeys.some((key) => key === normalizedQuery)) {
    return 960 + place.weight;
  }

  if (place.normName.startsWith(normalizedQuery)) {
    return 900 + place.weight;
  }

  if (place.words.some((word) => word.startsWith(normalizedQuery))) {
    return 850 + place.weight;
  }

  const bridge = wordBridgeScore(place.words, normalizedQuery);

  if (bridge > 0) {
    return bridge + place.weight;
  }

  if (
    queryWords.length > 1 &&
    queryWords.every(
      (token) =>
        place.words.some((word) => word.startsWith(token)) || place.normName.includes(token),
    )
  ) {
    return 700 + place.weight;
  }

  if (place.searchKeys.some((key) => key.startsWith(normalizedQuery))) {
    return 660 + place.weight;
  }

  if (place.normName.includes(normalizedQuery)) {
    return 600 + place.weight;
  }

  if (
    normalizedQuery.length >= 3 &&
    place.normName.length <= 24 &&
    isOrderedSubsequence(place.normName, normalizedQuery)
  ) {
    const firstCharBonus = place.normName.startsWith(normalizedQuery.slice(0, 1)) ? 60 : 0;

    return 440 + firstCharBonus + place.weight;
  }

  return 0;
}

/**
 * Suggests global places (continents, countries, metro areas, regions, and cities) from the
 * local geographic catalog for interactive typeahead pickers.
 * @param rawQuery The visitor's search input.
 * @param limit Maximum suggestions to return.
 * @returns Ranked place suggestions ready for Combobox items.
 */
export function suggestLocations(rawQuery: string, limit = 10) {
  const normalized = normalizePlaceName(rawQuery);

  if (normalized.length < 2) {
    return DEFAULT_SUGGESTIONS.slice(0, limit);
  }

  const queryWords = splitWords(normalized);
  const scored: { place: IndexedPlace; score: number }[] = [];

  for (const place of placeIndex()) {
    const score = scorePlace(place, normalized, queryWords);

    if (score > 0) {
      scored.push({ place, score });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  const seen = new Set<string>();
  const suggestions: LocationSuggestion[] = [];

  for (const entry of scored) {
    const dedupeKey = `${entry.place.kind}:${entry.place.normName}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    suggestions.push({
      kind: entry.place.kind,
      label: entry.place.label,
      meta: entry.place.meta,
      value: entry.place.value,
    });

    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}
