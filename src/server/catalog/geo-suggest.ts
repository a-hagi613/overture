import type { LocationSuggestion } from "../../shared/supply.ts";
import {
  cityPlaceId,
  countryPlaceId,
  isContinentCode,
  metroPlaceId,
  regionPlaceId,
  remoteContinentPlaceId,
  remoteCountryPlaceId,
  REMOTE_WORLDWIDE_ID,
} from "../../shared/places.ts";
import type { PlaceKind, PlaceSuggestion } from "../../shared/places.ts";

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
  readonly id: string | null;
  readonly kind: PlaceKind | "continent";
  readonly value: string;
  readonly label: string;
  readonly meta: string;
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

const DEFAULT_PLACES: readonly PlaceSuggestion[] = [
  {
    id: REMOTE_WORLDWIDE_ID,
    kind: "remote_worldwide",
    label: "Remote · Worldwide",
    meta: "Anywhere",
  },
  { id: countryPlaceId("US"), kind: "country", label: "United States", meta: "" },
  { id: countryPlaceId("CA"), kind: "country", label: "Canada", meta: "" },
  { id: countryPlaceId("GB"), kind: "country", label: "United Kingdom", meta: "" },
  {
    id: remoteContinentPlaceId("EU"),
    kind: "remote_continent",
    label: "Remote · Europe",
    meta: "Europe",
  },
  { id: cityPlaceId("CA", "Toronto"), kind: "city", label: "Toronto", meta: "Ontario, Canada" },
  {
    id: cityPlaceId("GB", "London"),
    kind: "city",
    label: "London",
    meta: "England, United Kingdom",
  },
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
      id: regionPlaceId(continent.code),
      kind: "continent",
      label: continent.name,
      meta: "",
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
      id: countryPlaceId(country.code),
      kind: "country",
      label: country.name,
      meta: "",
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
      id: metroPlaceId(metro.name),
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
      id: null,
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
      id: cityPlaceId(city.countryCode, city.name),
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

let cachedRemoteIndex: readonly IndexedPlace[] | null = null;

function remoteIndex() {
  if (cachedRemoteIndex !== null) {
    return cachedRemoteIndex;
  }

  const entries: IndexedPlace[] = [];

  for (const country of geoCountries()) {
    const normName = normalizePlaceName(country.name);

    entries.push({
      id: remoteCountryPlaceId(country.code),
      kind: "remote_country",
      label: `Remote · ${country.name}`,
      meta: country.name,
      normName: normalizePlaceName(`Remote ${country.name}`),
      searchKeys: [
        normName,
        normalizePlaceName(`remote ${country.name}`),
        country.code.toLowerCase(),
      ],
      value: country.name,
      weight: 205,
      words: splitWords(normName),
    });
  }

  for (const continent of geoContinents()) {
    const normName = normalizePlaceName(continent.name);

    if (!isContinentCode(continent.code)) {
      continue;
    }

    entries.push({
      id: remoteContinentPlaceId(continent.code),
      kind: "remote_continent",
      label: `Remote · ${continent.name}`,
      meta: continent.name,
      normName: normalizePlaceName(`Remote ${continent.name}`),
      searchKeys: [normName, normalizePlaceName(`remote ${continent.name}`)],
      value: continent.name,
      weight: 200,
      words: splitWords(normName),
    });
  }

  entries.push({
    id: REMOTE_WORLDWIDE_ID,
    kind: "remote_worldwide",
    label: "Remote · Worldwide",
    meta: "Anywhere",
    normName: "remote worldwide",
    searchKeys: ["remote", "worldwide", "anywhere", "global", "remote worldwide"],
    value: "Remote · Worldwide",
    weight: 230,
    words: ["remote", "worldwide"],
  });

  cachedRemoteIndex = entries;

  return entries;
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

function rankedPlaces(entries: readonly IndexedPlace[], normalized: string) {
  const queryWords = splitWords(normalized);

  const ranked: { place: IndexedPlace; score: number }[] = [];

  for (const place of entries) {
    const score = scorePlace(place, normalized, queryWords);

    if (score > 0) {
      ranked.push({ place, score });
    }
  }

  return ranked.toSorted((left, right) => right.score - left.score);
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

  const seen = new Set<string>();
  const suggestions: LocationSuggestion[] = [];

  for (const entry of rankedPlaces(placeIndex(), normalized)) {
    const dedupeKey = `${entry.place.kind}:${entry.place.normName}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    suggestions.push({
      kind: legacyKindOf(entry.place),
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

function legacyKindOf(entry: IndexedPlace) {
  if (entry.kind === "continent") {
    return "continent";
  }

  if (entry.kind === "region") {
    return "region";
  }

  if (entry.kind === "country") {
    return "country";
  }

  if (entry.kind === "metro") {
    return "metro";
  }

  return "city";
}

function placeKindOf(entry: IndexedPlace) {
  if (entry.kind === "continent") {
    return "region";
  }

  if (entry.kind === "region") {
    return "region";
  }

  return entry.kind;
}

/**
 * Suggests the canonical places a target may hold from the same catalog both sides of a location match read
 * (issue #683): physical countries, regions, metros and cities, plus the explicit `Remote · …` scopes. Only a
 * returned suggestion carries an id, so free text can never become a saved target.
 * @param rawQuery The text in the picker.
 * @param limit Maximum suggestions to return.
 * @returns Ranked place suggestions with canonical ids.
 */
export function suggestPlaces(rawQuery: string, limit = 10) {
  const normalized = normalizePlaceName(rawQuery);

  if (normalized.length < 2) {
    return DEFAULT_PLACES.slice(0, limit);
  }

  const entries = [
    ...rankedPlaces(placeIndex(), normalized),
    ...rankedPlaces(remoteIndex(), normalized),
  ]
    .filter((entry) => entry.place.id !== null)
    .toSorted((left, right) => right.score - left.score);

  const seen = new Set<string>();
  const suggestions: PlaceSuggestion[] = [];

  for (const entry of entries) {
    const { id } = entry.place;

    if (id === null || seen.has(id)) {
      continue;
    }

    seen.add(id);
    suggestions.push({
      id,
      kind: placeKindOf(entry.place),
      label: entry.place.label,
      meta: entry.place.meta,
    });

    if (suggestions.length >= limit) {
      break;
    }
  }

  return suggestions;
}
