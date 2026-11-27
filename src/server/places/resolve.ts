import {
  continentCodesForPlaceName,
  cityCandidatesFor,
  continentCodeForCountry,
  countryCodeForPlaceName,
  countryCodesNamedIn,
  isRemoteLocationText,
  locationGroups,
  metroCandidatesFor,
  normalizePlaceName,
  regionCandidatesFor,
  resolvePlaceQuery,
} from "../catalog/geo.ts";
import type { GeoCityCandidate } from "../catalog/geo.ts";
import {
  cityPlaceId,
  countryPlaceId,
  continentCodeForRegionValue,
  FREEHIRE_REGION_BY_CONTINENT,
  isContinentCode,
  isPlaceId,
  metroPlaceId,
  regionPlaceId,
  remoteContinentPlaceId,
  remoteCountryPlaceId,
  REMOTE_WORLDWIDE_ID,
} from "../../shared/places.ts";
import type { ContinentCode } from "../../shared/places.ts";

/** The places one free-text location names, plus the parts that stayed too ambiguous to guess. */
export interface PlaceResolution {
  ids: string[];
  /** Raw parts the resolver refused to guess; a person picks or dismisses them in the UI. */
  unresolved: string[];
}

const REMOTE_FILLER_WORDS = new Set([
  "a",
  "and",
  "anywhere",
  "based",
  "candidate",
  "candidates",
  "distributed",
  "eligible",
  "for",
  "from",
  "fully",
  "global",
  "home",
  "in",
  "job",
  "jobs",
  "only",
  "opportunity",
  "opportunities",
  "or",
  "position",
  "remote",
  "residents",
  "role",
  "the",
  "telecommute",
  "telework",
  "wfh",
  "within",
  "work",
  "worker",
  "workers",
  "working",
  "worldwide",
]);

const DOMINANT_CITY_POPULATION = 100_000;
const DOMINANT_CITY_RATIO = 5;
const MEANINGFUL_CITY_POPULATION = 100_000;

function segmentsOf(text: string) {
  return text
    .replaceAll(/[[\]()]/gu, ",")
    .split(/[,;|•·/]|\s[-–—]\s/gu)
    .map((segment) => normalizePlaceName(segment))
    .filter((segment) => segment !== "");
}

function withoutRemoteWords(text: string) {
  return normalizePlaceName(text)
    .split(" ")
    .filter((word) => !REMOTE_FILLER_WORDS.has(word) && !/^\d+$/u.test(word))
    .join(" ")
    .trim();
}

function continentCodesIn(text: string) {
  const normalized = normalizePlaceName(text);

  if (normalized === "") {
    return [];
  }

  const codes = new Set<string>(continentCodesForPlaceName(normalized));
  const words = normalized.split(" ");

  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const phrase = words.slice(start, start + size).join(" ");

      for (const code of continentCodesForPlaceName(phrase)) {
        codes.add(code);
      }

      const fromRegion = continentCodeForRegionValue(phrase);

      if (fromRegion !== null) {
        codes.add(fromRegion);
      }
    }
  }

  return [...codes].filter((code) => isContinentCode(code));
}

function physicalRegionId(code: ContinentCode) {
  return regionPlaceId(FREEHIRE_REGION_BY_CONTINENT[code]);
}

function citiesByCountry(candidates: readonly GeoCityCandidate[]) {
  const map = new Map<string, GeoCityCandidate>();

  for (const candidate of candidates) {
    const current = map.get(candidate.countryCode);

    if (current === undefined || candidate.population > current.population) {
      map.set(candidate.countryCode, candidate);
    }
  }

  return map;
}

function dominantCountry(candidates: readonly GeoCityCandidate[]) {
  const byCountry = [...citiesByCountry(candidates).values()].toSorted(
    (left, right) => right.population - left.population,
  );

  const [first, second] = byCountry;

  if (first === undefined) {
    return null;
  }

  if (second === undefined) {
    return first.countryCode;
  }

  if (
    first.population >= DOMINANT_CITY_POPULATION &&
    first.population >= second.population * DOMINANT_CITY_RATIO
  ) {
    return first.countryCode;
  }

  return null;
}

function cityIdsFor(
  candidates: readonly GeoCityCandidate[],
  countryCodes: readonly string[],
  regionCountries: readonly string[],
) {
  const wanted = countryCodes.length > 0 ? countryCodes : regionCountries;

  const allowed = wanted.map((code) => code.toUpperCase());

  const filtered =
    allowed.length === 0
      ? candidates
      : candidates.filter((candidate) => allowed.includes(candidate.countryCode.toUpperCase()));

  if (filtered.length === 0) {
    return null;
  }

  const countries = [...new Set(filtered.map((candidate) => candidate.countryCode))];

  if (countries.length === 1) {
    const [candidate] = filtered;

    return candidate === undefined
      ? null
      : [cityPlaceId(candidate.countryCode, candidate.canonicalName)];
  }

  const dominant = dominantCountry(filtered);

  if (dominant === null) {
    return "ambiguous" as const;
  }

  const candidate = filtered.find((row) => row.countryCode === dominant);

  return candidate === undefined
    ? null
    : [cityPlaceId(candidate.countryCode, candidate.canonicalName)];
}

function cityCandidatesInSegments(segments: readonly string[]) {
  for (const segment of segments) {
    const words = segment.split(" ");
    const whole = cityCandidatesFor(segment);

    if (whole.length > 0) {
      return { candidates: whole, segment };
    }

    for (let size = words.length - 1; size >= 1; size -= 1) {
      const suffix = words.slice(size).join(" ");

      if (countryCodeForPlaceName(suffix) === null && regionCandidatesFor(suffix).length === 0) {
        continue;
      }

      const candidates = cityCandidatesFor(words.slice(0, size).join(" "));

      if (candidates.length > 0) {
        return { candidates, segment };
      }
    }
  }

  return null;
}

function uniqueIds(ids: readonly string[]) {
  return [...new Set(ids)].toSorted();
}

function countryCodesIn(text: string) {
  const normalized = normalizePlaceName(text);

  if (normalized === "") {
    return [];
  }

  const codes = new Set<string>(countryCodesNamedIn(text));
  const words = normalized.split(" ");

  for (let size = 1; size <= 3; size += 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const code = countryCodeForPlaceName(words.slice(start, start + size).join(" "));

      if (code !== null) {
        codes.add(code);
      }
    }
  }

  return [...codes].toSorted();
}

function remoteScopeFor(countryCodesNamed: readonly string[], fallbackContinent: string | null) {
  return {
    ids: uniqueIds(
      countryCodesNamed.flatMap((code) => {
        const continent = continentCodeForCountry(code.toUpperCase()) ?? fallbackContinent;

        return [
          remoteCountryPlaceId(code),
          ...(continent !== null && isContinentCode(continent)
            ? [remoteContinentPlaceId(continent)]
            : []),
        ];
      }),
    ),
    unresolved: [],
  } satisfies PlaceResolution;
}

function resolveRemote(text: string) {
  const cleaned = withoutRemoteWords(text);

  if (cleaned === "") {
    return { ids: [REMOTE_WORLDWIDE_ID], unresolved: [] };
  }

  const exactCountry = countryCodeForPlaceName(cleaned);

  if (exactCountry !== null) {
    return remoteScopeFor([exactCountry], null);
  }

  const exactContinents = continentCodesForPlaceName(cleaned);
  const continentCode = cleaned.toUpperCase();
  const codeIsContinent = isContinentCode(continentCode);

  if (exactContinents.length > 0 || codeIsContinent) {
    const codes = codeIsContinent ? [...exactContinents, continentCode] : exactContinents;

    return {
      ids: uniqueIds(
        codes.filter((code) => isContinentCode(code)).map((code) => remoteContinentPlaceId(code)),
      ),
      unresolved: [],
    };
  }

  const parsed = resolvePlaceQuery(cleaned);
  const countries = parsed.countryCodes.map((code) => code.toUpperCase());

  if (countries.length > 0) {
    return remoteScopeFor(countries, parsed.continentCodes.at(0) ?? null);
  }

  const named = countryCodesIn(cleaned);

  if (named.length > 0) {
    return remoteScopeFor(named, null);
  }

  const continents = continentCodesIn(cleaned);

  if (continents.length > 0) {
    return {
      ids: uniqueIds(continents.map((code) => remoteContinentPlaceId(code))),
      unresolved: [],
    };
  }

  return { ids: [], unresolved: [text] };
}

function resolvePhysical(text: string) {
  const segments = segmentsOf(text);

  if (segments.length === 0) {
    return { ids: [], unresolved: [text] };
  }

  const single = segments.length === 1 ? segments[0] : undefined;

  if (single !== undefined) {
    const country = countryCodeForPlaceName(single);

    if (country !== null) {
      return { ids: [countryPlaceId(country)], unresolved: [] };
    }

    const singleContinents = continentCodesIn(single);

    if (singleContinents.length > 0) {
      return {
        ids: uniqueIds(singleContinents.map((code) => physicalRegionId(code))),
        unresolved: [],
      };
    }

    const regionCountriesForSingle = [
      ...new Set(regionCandidatesFor(single).map((region) => region.countryCode.toUpperCase())),
    ];

    const [largestCity] = cityCandidatesFor(single);

    if (
      regionCountriesForSingle.length === 1 &&
      (largestCity === undefined || largestCity.population < MEANINGFUL_CITY_POPULATION)
    ) {
      const [regionCountry] = regionCountriesForSingle;

      if (regionCountry !== undefined) {
        return { ids: [countryPlaceId(regionCountry)], unresolved: [] };
      }
    }
  }

  const city = cityCandidatesInSegments(segments);

  const qualifierSegments = segments.filter((segment) => segment !== city?.segment);

  const regionCandidates = qualifierSegments.flatMap((segment) => regionCandidatesFor(segment));

  const regionCountries = [
    ...new Set(regionCandidates.map((region) => region.countryCode.toUpperCase())),
  ];

  const countrySegments = qualifierSegments.flatMap((segment) => {
    const country = countryCodeForPlaceName(segment);

    return country === null || regionCandidatesFor(segment).length > 0 ? [] : [country];
  });

  if (city !== null) {
    const ids = cityIdsFor(city.candidates, countrySegments, regionCountries);

    if (Array.isArray(ids)) {
      return { ids: uniqueIds(ids), unresolved: [] };
    }
  }

  if (countrySegments.length > 0) {
    return { ids: uniqueIds(countrySegments.map((code) => countryPlaceId(code))), unresolved: [] };
  }

  const continents = continentCodesIn(text);

  if (continents.length > 0) {
    return { ids: uniqueIds(continents.map((code) => physicalRegionId(code))), unresolved: [] };
  }

  const named = countryCodesNamedIn(text);

  if (city === null && named.length > 0) {
    return { ids: uniqueIds(named.map((code) => countryPlaceId(code))), unresolved: [] };
  }

  if (regionCountries.length > 0) {
    return {
      ids: uniqueIds(regionCountries.map((code) => countryPlaceId(code))),
      unresolved: [],
    };
  }

  for (const segment of segments) {
    const [metro] = metroCandidatesFor(segment);

    if (metro !== undefined) {
      return { ids: [metroPlaceId(metro.name)], unresolved: [] };
    }
  }

  for (const segment of segments) {
    const continent = continentCodeForRegionValue(segment);

    if (continent !== null) {
      return { ids: [physicalRegionId(continent)], unresolved: [] };
    }
  }

  return { ids: [], unresolved: [text] };
}

/**
 * Resolves one free-text location into the same canonical place ids a job carries. It never guesses across
 * countries: a city name that is shared by several countries without a qualifier becomes unresolved, which the UI
 * asks the person to pick.
 * @param input The location a person typed or a saved target still holds.
 * @returns The exact place ids, and the parts that need a pick.
 */
export function resolvePlaceText(input: string) {
  const text = input.trim();

  if (text === "") {
    return { ids: [], unresolved: [] };
  }

  if (isPlaceId(text)) {
    return { ids: [text], unresolved: [] };
  }

  const ids: string[] = [];
  const unresolved: string[] = [];

  for (const group of locationGroups(text)) {
    const resolution = isRemoteLocationText(group) ? resolveRemote(group) : resolvePhysical(group);

    ids.push(...resolution.ids);
    unresolved.push(...resolution.unresolved);
  }

  return { ids: uniqueIds(ids), unresolved };
}

/**
 * Promotes the raw values a target may still hold after the place-id migration: a canonical id is kept, anything
 * else is resolved once. Idempotent, because a resolved id is kept on the next run.
 * @param values The stored location values.
 * @returns The ids and the values that stayed unresolved.
 */
export function promotePlaceValues(values: readonly string[]) {
  const ids: string[] = [];
  const unresolved: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed === "") {
      continue;
    }

    if (isPlaceId(trimmed)) {
      ids.push(trimmed);

      continue;
    }

    const resolution = resolvePlaceText(trimmed);

    ids.push(...resolution.ids);
    unresolved.push(...resolution.unresolved);
  }

  return { ids: uniqueIds(ids), unresolved: [...new Set(unresolved)].toSorted() };
}
