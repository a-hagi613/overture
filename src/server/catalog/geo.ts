import { z } from "zod";

import { CONTINENTS, METRO_AREAS, isoSubdivisionTokens } from "./geo-static.ts";
import geoDataJson from "./tag-data/geo-places.json";

const cityTupleSchema = z.tuple([
  z.number(),
  z.string(),
  z.string(),
  z.string(),
  z.number(),
  z.number(),
  z.number(),
  z.string(),
]);

const geoMetaSchema = z.object({
  published: z.string(),
  countries: z.record(z.string(), z.string()),
  countryContinents: z.record(z.string(), z.string()),
  continents: z.record(z.string(), z.string()),
  regions: z.record(z.string(), z.string()),
  regionIso: z.record(z.string(), z.string()),
  metros: z.array(
    z.object({
      name: z.string(),
      aliases: z.array(z.string()),
      countryCode: z.string(),
      isoRegionCode: z.string().nullable(),
      continentCode: z.string(),
      bbox: z.array(z.number()),
    }),
  ),
});

const dataset = geoMetaSchema.parse(geoDataJson);

export type PlaceKind = "continent" | "country" | "region" | "metro" | "city";

export const POSTING_SCOPE_KINDS = [
  "onsite",
  "hybrid",
  "remote_city",
  "remote_region",
  "remote_country",
  "remote_continent",
  "remote_global",
] as const;

export type PostingScopeKind = (typeof POSTING_SCOPE_KINDS)[number];

/** One derived `posting_locations` row: where a Posting is, or where its remote scope allows. */
export interface PostingLocationScope {
  continentCode: string | null;
  countryCode: string | null;
  regionCode: string | null;
  cityGeonameId: number | null;
  scopeKind: PostingScopeKind;
}

/** One resolved place a free-text location query names. */
export interface ResolvedPlaceQuery {
  kind: PlaceKind | null;
  continentCodes: string[];
  countryCodes: string[];
  regionIsoCode: string | null;
  legacyRegionCode: string | null;
  regionName: string | null;
  cityName: string | null;
  cityGeonameId: number | null;
  lat: number | null;
  lon: number | null;
  metroName: string | null;
  metroBbox: readonly [number, number, number, number] | null;
  remote: boolean;
  remoteScope: PostingScopeKind | null;
}

const countryAliases = new Map([
  ["usa", "US"],
  ["united states of america", "US"],
  ["united states", "US"],
  ["america", "US"],
  ["uae", "AE"],
  ["uk", "GB"],
  ["britain", "GB"],
  ["great britain", "GB"],
  ["england", "GB"],
  ["scotland", "GB"],
  ["wales", "GB"],
  ["republic of ireland", "IE"],
  // Country names in their own language, as non-English job boards print them.
  ["deutschland", "DE"],
  ["osterreich", "AT"],
  ["schweiz", "CH"],
  ["suisse", "CH"],
  ["svizzera", "CH"],
  ["espana", "ES"],
  ["italia", "IT"],
  ["nederland", "NL"],
  ["belgie", "BE"],
  ["belgique", "BE"],
  ["sverige", "SE"],
  ["norge", "NO"],
  ["danmark", "DK"],
  ["suomi", "FI"],
  ["polska", "PL"],
  ["cesko", "CZ"],
  ["ceska republika", "CZ"],
  ["magyarorszag", "HU"],
  ["turkiye", "TR"],
  ["brasil", "BR"],
  ["eire", "IE"],
]);

const remoteKeywords = new Set([
  "remote",
  "anywhere",
  "work from home",
  "wfh",
  "distributed",
  "worldwide",
]);

/**
 * Lowercases and folds a place name so "São Paulo", "sao paulo" and "SAO-PAULO" compare equal.
 * @param value The raw name.
 * @returns The folded name: letters and digits, single spaces.
 */
export function normalizePlaceName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

const countries = new Map<string, string>();
const countryNameLookup = new Map<string, string>();
const countryNames = new Map<string, string>();
const countryContinents = new Map<string, string>();
const countryNameByCode = new Map<string, string>();

for (const [code, name] of Object.entries(dataset.countries)) {
  countryNameByCode.set(code, name);
  countryContinents.set(code, dataset.countryContinents[code] ?? "NA");
  countryNames.set(code, name);

  for (const candidate of [name, name.replace(/^the /iu, "")]) {
    const normalized = normalizePlaceName(candidate);

    if (normalized.length >= 3) {
      countryNameLookup.set(normalized, code);
      countries.set(normalized, code);
    }
  }

  countries.set(code.toLowerCase(), code);
}

for (const [alias, code] of countryAliases) {
  countryNameLookup.set(alias, code);
  countries.set(alias, code);
}

interface RegionRef {
  iso: string;
  legacy: string;
  name: string;
  country: string;
  continent: string;
}

const regionByIso = new Map<string, RegionRef>();
const regionByLegacy = new Map<string, RegionRef>();
const regionByName = new Map<string, RegionRef[]>();
const regionSuffixTokens = new Map<string, RegionRef[]>();

for (const [legacy, name] of Object.entries(dataset.regions)) {
  const [country] = legacy.split(".");

  if (country === undefined) {
    continue;
  }

  const isoTarget = dataset.regionIso[legacy];
  const iso = isoTarget ?? `${country}-${legacy.slice(country.length + 1)}`;

  const region: RegionRef = {
    iso,
    legacy,
    name,
    country,
    continent: countryContinents.get(country) ?? "NA",
  };

  regionByIso.set(iso, region);
  regionByLegacy.set(legacy, region);

  const normalized = normalizePlaceName(name);

  if (normalized.length > 0) {
    regionByName.set(normalized, [...(regionByName.get(normalized) ?? []), region]);
  }

  const suffix = iso.slice(country.length + 1).toLowerCase();

  if (suffix.length >= 2 && suffix.length <= 3) {
    regionSuffixTokens.set(suffix, [...(regionSuffixTokens.get(suffix) ?? []), region]);
  }
}

const crosswalkTokens = isoSubdivisionTokens();

for (const [token, isos] of crosswalkTokens) {
  for (const iso of isos) {
    const region = regionByIso.get(iso);

    if (region !== undefined) {
      const key = token.toLowerCase();
      const rows = regionSuffixTokens.get(key) ?? [];

      if (!rows.some((row) => row.iso === iso)) {
        regionSuffixTokens.set(key, [...rows, region]);
      }
    }
  }
}

interface MetroRef {
  name: string;
  norm: string;
  aliases: readonly string[];
  countryCode: string;
  isoRegionCode: string | null;
  continentCode: string;
  bbox: readonly [number, number, number, number];
}

const metros = new Map<string, MetroRef>();

for (const metro of dataset.metros) {
  const { bbox } = metro;

  if (bbox.length !== 4) {
    continue;
  }

  const ref: MetroRef = {
    name: metro.name,
    norm: normalizePlaceName(metro.name),
    aliases: metro.aliases,
    countryCode: metro.countryCode,
    isoRegionCode: metro.isoRegionCode,
    continentCode: metro.continentCode,
    bbox: [bbox[0] ?? 0, bbox[1] ?? 0, bbox[2] ?? 0, bbox[3] ?? 0],
  };

  metros.set(ref.norm, ref);

  for (const alias of metro.aliases) {
    const normalized = normalizePlaceName(alias);

    if (normalized !== "") {
      metros.set(normalized, ref);
    }
  }
}

const continentAliases = new Map<string, string[]>();

for (const [code, name] of CONTINENTS) {
  continentAliases.set(normalizePlaceName(name), [code]);
}

const CONTINENT_NAME_ALIASES = {
  apac: ["AS", "OC"],
  emea: ["EU", "AF", "AS"],
  latam: ["SA"],
  "latin america": ["SA"],
  "middle east": ["AS"],
  "asia pacific": ["AS", "OC"],
  "europe middle east africa": ["EU", "AF", "AS"],
} satisfies Record<string, readonly string[]>;

for (const [alias, codes] of Object.entries(CONTINENT_NAME_ALIASES)) {
  continentAliases.set(normalizePlaceName(alias), [...codes]);
}

const CITY_ALIASES = [
  { alias: "new york", country: "US", name: "New York City" },
  { alias: "nyc", country: "US", name: "New York City" },
  { alias: "washington dc", country: "US", name: "Washington" },
  { alias: "washington d c", country: "US", name: "Washington" },
  { alias: "ho chi minh", country: "VN", name: "Ho Chi Minh City" },
  { alias: "saigon", country: "VN", name: "Ho Chi Minh City" },
  { alias: "frankfurt", country: "DE", name: "Frankfurt am Main" },
  { alias: "metro manila", country: "PH", name: "Manila" },
  // Business districts GeoNames files as sections of a bigger city, so they are not rows of their own.
  { alias: "sandton", country: "ZA", name: "Johannesburg" },
  { alias: "annapolis junction", admin1: "MD", country: "US", name: "Fort Meade" },
] as const satisfies readonly { alias: string; admin1?: string; country: string; name: string }[];

/** A single place name that is both a region and a city this big means the city ("Sofia", "Buenos Aires"). */
const CITY_OVER_REGION_POPULATION = 1_000_000;

let cityTopIndex: Map<string, number> | null = null;
let cityOtherIndexes: Map<string, number[]> | null = null;

function cityAt(index: number) {
  const row = cityTupleSchema.parse(geoDataJson.cities[index]);

  return {
    id: row[0],
    name: row[1],
    country: row[2],
    admin1: row[3],
    lat: row[4],
    lon: row[5],
    population: row[6],
  };
}

function cityIndex() {
  if (cityTopIndex !== null) {
    return { others: cityOtherIndexes ?? new Map<string, number[]>(), top: cityTopIndex };
  }

  const top = new Map<string, number>();
  const others = new Map<string, number[]>();

  const add = (key: string, index: number) => {
    if (!top.has(key)) {
      top.set(key, index);

      return;
    }

    const rows = others.get(key);

    if (rows === undefined) {
      others.set(key, [index]);
    } else if (rows.at(-1) !== index) {
      rows.push(index);
    }
  };

  for (const [index, row] of geoDataJson.cities.entries()) {
    const name = String(row[1] ?? "");
    const normalized = normalizePlaceName(name);
    const population = Number(row[6] ?? 0);

    if (normalized !== "") {
      add(normalized, index);
    }

    if (population < 50_000) {
      continue;
    }

    for (const alternate of String(row[7] ?? "").split("|")) {
      const alias = normalizePlaceName(alternate);

      if (alias !== "" && alias !== normalized) {
        add(alias, index);
      }
    }
  }

  for (const alias of CITY_ALIASES) {
    const key = normalizePlaceName(alias.name);

    const candidates = [top.get(key), ...(others.get(key) ?? [])].filter(
      (index): index is number => index !== undefined,
    );

    const canonical = candidates.find((index) => {
      const city = cityAt(index);

      return (
        city.country === alias.country && (!("admin1" in alias) || city.admin1 === alias.admin1)
      );
    });

    if (canonical !== undefined) {
      top.set(normalizePlaceName(alias.alias), canonical);
    }
  }

  cityTopIndex = top;
  cityOtherIndexes = others;

  return { others, top };
}

interface PlaceSegment {
  raw: string;
  normalized: string;
}

function segmentsOf(text: string) {
  return text
    .replaceAll(/[[\]()]/gu, ",")
    .split(/[,;|•·/]|\s[-–—]\s/gu)
    .map((segment) => withoutPostcode(segment.trim().replaceAll(/\s+/gu, " ")))
    .filter((segment) => segment.length > 1)
    .map((segment) => ({ normalized: normalizePlaceName(segment), raw: segment }))
    .filter((segment) => segment.normalized !== "")
    .filter((segment) => !remoteKeywords.has(segment.normalized));
}

/**
 * Drops a postcode printed beside a place: "10115 Berlin" → "Berlin", "CA 94105" → "CA".
 * @param segment One trimmed location segment.
 * @returns The segment without a leading or trailing postcode; a bare number is left alone.
 */
function withoutPostcode(segment: string) {
  return segment.replace(/^\d{4,6}\s+(?=\D)/u, "").replace(/(?<=\D)\s+\d{4,6}(?:-\d{4})?$/u, "");
}

/**
 * Splits a multi-location string (`"Toronto; Vancouver"`, `"Berlin | Remote"`) into its independent
 * location groups. Commas stay inside a group because they are the right-to-left hierarchy separator.
 * @param text The raw location.
 * @returns The trimmed groups.
 */
export function locationGroups(text: string) {
  return text
    .split(/[;|•·/]|\n/gu)
    .map((group) => group.trim())
    .filter((group) => group.length > 0);
}

/**
 * Whether a raw location text names remote work. Kept for the tag rules and the onboarding steps.
 * @param text The raw location.
 * @returns True when any remote keyword appears.
 */
export function isRemoteLocationText(text: string | null | undefined) {
  if (text === undefined || text === null) {
    return false;
  }

  const normalized = normalizePlaceName(text);

  return [...remoteKeywords].some((keyword) => normalized.includes(keyword));
}

function countryForSegment(segment: PlaceSegment) {
  const alias = countryAliases.get(segment.normalized);

  if (alias !== undefined) {
    return alias;
  }

  return countries.get(segment.normalized) ?? null;
}

function regionForSegment(segment: PlaceSegment, countryCode: string | null) {
  const token = segment.normalized.replaceAll(" ", "");
  const candidates = regionSuffixTokens.get(token) ?? [];

  if (candidates.length > 0) {
    const match = candidates.find(
      (region) => countryCode === null || region.country === countryCode,
    );

    if (match !== undefined) {
      return match;
    }
  }

  const named = regionByName.get(segment.normalized) ?? [];
  const namedMatch = named.find((region) => countryCode === null || region.country === countryCode);

  if (namedMatch !== undefined) {
    return namedMatch;
  }

  if (countryCode !== null && /^\d{1,3}$/u.test(segment.raw)) {
    return regionByLegacy.get(`${countryCode}.${segment.raw}`) ?? null;
  }

  return null;
}

function findCity(normalized: string, countryCode: string | null, regionIsoCode: string | null) {
  const { others, top } = cityIndex();

  const primary = top.get(normalized);

  const candidates = [
    ...(primary === undefined ? [] : [primary]),
    ...(others.get(normalized) ?? []),
  ];

  for (const index of candidates) {
    const city = cityAt(index);

    if (countryCode !== null && city.country !== countryCode) {
      continue;
    }

    if (regionIsoCode !== null && cityRegionIso(index) !== regionIsoCode) {
      continue;
    }

    return index;
  }

  return null;
}

/**
 * A city of at least {@link CITY_OVER_REGION_POPULATION} with this name in the country, wherever its region.
 * @param normalized The folded place name.
 * @param countryCode The country the city must be in.
 * @returns The city's index, or null.
 */
function bigCityNamed(normalized: string, countryCode: string) {
  const index = findCity(normalized, countryCode, null);

  return index !== null && cityAt(index).population >= CITY_OVER_REGION_POPULATION ? index : null;
}

function cityWithRegionToken(segments: readonly PlaceSegment[]) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    const citySegment = segments[index];
    const tokenSegment = segments[index + 1];

    if (citySegment === undefined || tokenSegment === undefined) {
      continue;
    }

    const token = tokenSegment.normalized.replaceAll(" ", "");
    const tokenRegions = regionSuffixTokens.get(token) ?? [];

    const region = tokenRegions.find(
      (candidate) => findCity(citySegment.normalized, candidate.country, candidate.iso) !== null,
    );

    if (region === undefined) {
      continue;
    }

    const cityIndexValue = findCity(citySegment.normalized, region.country, region.iso);

    if (cityIndexValue !== null) {
      return { cityIndex: cityIndexValue, region };
    }
  }

  return null;
}

function cityRegionIso(index: number) {
  const city = cityAt(index);
  const legacy = `${city.country}.${city.admin1}`;

  return dataset.regionIso[legacy] ?? null;
}

function cityResult(index: number, remote: boolean) {
  const city = cityAt(index);
  const legacy = regionByLegacy.get(`${city.country}.${city.admin1}`);

  return resolvedQuery({
    kind: "city",
    continentCodes: [countryContinents.get(city.country) ?? "NA"],
    countryCodes: [city.country],
    regionIsoCode: cityRegionIso(index),
    legacyRegionCode: legacy?.legacy ?? null,
    regionName: legacy?.name ?? null,
    cityName: city.name,
    cityGeonameId: city.id,
    lat: city.lat,
    lon: city.lon,
    remote,
  });
}

function emptyQuery() {
  return {
    kind: null,
    continentCodes: [],
    countryCodes: [],
    regionIsoCode: null,
    legacyRegionCode: null,
    regionName: null,
    cityName: null,
    cityGeonameId: null,
    lat: null,
    lon: null,
    metroName: null,
    metroBbox: null,
    remote: false,
    remoteScope: null,
  } satisfies ResolvedPlaceQuery;
}

function resolvedQuery(overrides: Partial<ResolvedPlaceQuery>) {
  const query: ResolvedPlaceQuery = { ...emptyQuery(), ...overrides };

  return query;
}

/**
 * Resolves one location group (a single comma-delimited place string) to every geo level it names.
 * The read is right-to-left: the country is settled first, then the ISO-3166-2 region, then the city,
 * so `"London, ON, Canada"` can never fall through to London, England.
 * @param group One location string, e.g. `"London, ON, Canada"` or `"Ontario"`.
 * @returns The resolved levels, with `kind` naming the most specific one.
 */
export function resolvePlaceQuery(group: string) {
  const normalizedGroup = normalizePlaceName(group);
  const remote = isRemoteLocationText(group);

  if (normalizedGroup === "") {
    return resolvedQuery({ remote });
  }

  const metro = metros.get(normalizedGroup);

  if (metro !== undefined) {
    const metroQuery: ResolvedPlaceQuery = {
      ...emptyQuery(),
      kind: "metro",
      metroName: metro.name,
      metroBbox: metro.bbox,
      continentCodes: [metro.continentCode],
      countryCodes: [metro.countryCode],
      regionIsoCode: metro.isoRegionCode,
      remote,
    };

    return metroQuery;
  }

  const segments = segmentsOf(group);

  if (segments.length === 0) {
    return resolvedQuery({ remote });
  }

  const continentHit = continentAliases.get(normalizedGroup) ?? null;

  if (segments.length === 1 && continentHit !== null) {
    return resolvedQuery({ kind: "continent", continentCodes: continentHit, remote });
  }

  const shortPair = cityWithRegionToken(segments);

  if (shortPair !== null) {
    const { cityIndex: matchedCity, region } = shortPair;
    const city = cityAt(matchedCity);

    return resolvedQuery({
      kind: "city",
      continentCodes: [countryContinents.get(city.country) ?? "NA"],
      countryCodes: [city.country],
      regionIsoCode: region.iso,
      legacyRegionCode: region.legacy,
      regionName: region.name,
      cityName: city.name,
      cityGeonameId: city.id,
      lat: city.lat,
      lon: city.lon,
      remote,
    });
  }

  let countryCode: string | null = null;
  let countryIndex = -1;
  let region: RegionRef | null = null;
  let regionIndex = -1;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];

    if (segment === undefined) {
      continue;
    }

    const code = countryForSegment(segment);

    if (code !== null) {
      countryCode = code;
      countryIndex = index;
      break;
    }
  }

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (index === countryIndex) {
      continue;
    }

    const segment = segments[index];

    if (segment === undefined) {
      continue;
    }

    const match = regionForSegment(segment, countryCode);

    if (match !== null) {
      region = match;
      regionIndex = index;
      break;
    }
  }

  if (countryCode === null && region !== null) {
    countryCode = region.country;
  }

  if (segments.length === 1 && region !== null) {
    const capitalIndex = findCity(normalizePlaceName(region.name), region.country, region.iso);

    if (capitalIndex !== null) {
      const capital = cityAt(capitalIndex);

      if (capital.population >= 250_000) {
        return resolvedQuery({
          kind: "city",
          continentCodes: [countryContinents.get(capital.country) ?? "NA"],
          countryCodes: [capital.country],
          regionIsoCode: region.iso,
          legacyRegionCode: region.legacy,
          regionName: region.name,
          cityName: capital.name,
          cityGeonameId: capital.id,
          lat: capital.lat,
          lon: capital.lon,
          remote,
        });
      }
    }
  }

  if (segments.length === 1 && region !== null) {
    const bigCity = bigCityNamed(normalizedGroup, region.country);

    if (bigCity !== null) {
      return cityResult(bigCity, remote);
    }
  }

  if (segments.length === 1 && countryIndex === 0 && countryCode !== null) {
    const cityStateIndex = findCity(normalizedGroup, countryCode, null);

    if (cityStateIndex !== null) {
      const cityState = cityAt(cityStateIndex);

      if (cityState.population >= 10_000) {
        const legacy = regionByLegacy.get(`${cityState.country}.${cityState.admin1}`);

        return resolvedQuery({
          kind: "city",
          continentCodes: [countryContinents.get(countryCode) ?? "NA"],
          countryCodes: [countryCode],
          regionIsoCode: cityRegionIso(cityStateIndex),
          legacyRegionCode: legacy?.legacy ?? null,
          regionName: legacy?.name ?? null,
          cityName: cityState.name,
          cityGeonameId: cityState.id,
          lat: cityState.lat,
          lon: cityState.lon,
          remote,
        });
      }
    }
  }

  const regionIsoCode = region?.iso ?? null;

  let matchedCityIndex: number | null = null;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (index === countryIndex) {
      continue;
    }

    if (index === regionIndex && segments.length === 1) {
      continue;
    }

    const segment = segments[index];

    if (segment === undefined) {
      continue;
    }

    let match = findCity(segment.normalized, countryCode, regionIsoCode);

    if (match === null && index === regionIndex && countryCode !== null) {
      // "Sofia, Bulgaria": the segment read as Sofia Province names the capital, which sits in its own region.
      match = bigCityNamed(segment.normalized, countryCode);

      if (match !== null) {
        region = null;
      }
    }

    if (match !== null) {
      matchedCityIndex = match;
      break;
    }
  }

  const city = matchedCityIndex === null ? null : cityAt(matchedCityIndex);

  if (city !== null) {
    countryCode = city.country;
  }

  const resolvedRegion =
    region ??
    (city === null ? null : (regionByLegacy.get(`${city.country}.${city.admin1}`) ?? null));

  const continentCodes = countryCode === null ? [] : [countryContinents.get(countryCode) ?? "NA"];

  if (city !== null && matchedCityIndex !== null) {
    return resolvedQuery({
      kind: "city",
      continentCodes,
      countryCodes: [countryCode ?? city.country],
      regionIsoCode: resolvedRegion?.iso ?? cityRegionIso(matchedCityIndex),
      legacyRegionCode: resolvedRegion?.legacy ?? null,
      regionName: resolvedRegion?.name ?? null,
      cityName: city.name,
      cityGeonameId: city.id,
      lat: city.lat,
      lon: city.lon,
      remote,
    });
  }

  if (region !== null) {
    return resolvedQuery({
      kind: "region",
      continentCodes,
      countryCodes: [region.country],
      regionIsoCode: region.iso,
      legacyRegionCode: region.legacy,
      regionName: region.name,
      remote,
    });
  }

  if (countryCode !== null) {
    return resolvedQuery({
      kind: "country",
      continentCodes,
      countryCodes: [countryCode],
      remote,
    });
  }

  for (const segment of segments) {
    const codes = continentAliases.get(segment.normalized);

    if (codes !== undefined) {
      return resolvedQuery({ kind: "continent", continentCodes: [...codes], remote });
    }
  }

  if (continentHit !== null) {
    return resolvedQuery({ kind: "continent", continentCodes: continentHit, remote });
  }

  return resolvedQuery({ remote });
}

/**
 * Resolves every location group in a free-text place, one entry per group. A multi-location string such
 * as `"Toronto; Vancouver"` returns two entries instead of silently keeping only the first.
 * @param raw The place a person typed or a Posting published.
 * @returns One resolved query per group; empty when nothing parses.
 */
export function resolveLocationQuery(raw: string | null | undefined) {
  if (raw === undefined || raw === null) {
    return [];
  }

  return locationGroups(raw)
    .map((group) => resolvePlaceQuery(group))
    .filter((resolved) => resolved.kind !== null || resolved.remote);
}

/**
 * The four-field location an old caller expects. Kept exactly as before so tag rules, onboarding and
 * answer derivations keep their contract: `region` is the display name and `regionCode` the legacy
 * GeoNames code (`CA.08`), while the ISO-3166-2 code is available from {@link resolvePlaceQuery}.
 * @param locationRaw The raw location.
 * @returns The country, region name, legacy region code and city name.
 */
export function resolveLocation(locationRaw: string | null | undefined) {
  if (locationRaw === undefined || locationRaw === null) {
    return { countryCode: null, region: null, regionCode: null, city: null };
  }

  const resolved = resolvePlaceQuery(locationGroups(locationRaw)[0] ?? locationRaw);

  const regionCode = resolved.legacyRegionCode ?? resolved.regionIsoCode?.replace("-", ".") ?? null;

  return {
    countryCode: resolved.countryCodes[0] ?? null,
    region:
      resolved.regionName ?? (regionCode === null ? null : (dataset.regions[regionCode] ?? null)),
    regionCode: resolved.legacyRegionCode,
    city: resolved.cityName,
  };
}

/**
 * The countries a piece of free text names, for the answer derivations that scan prose.
 * @param text Any text.
 * @returns Sorted ISO country codes.
 */
export function countryCodesNamedIn(text: string) {
  const normalized = ` ${normalizePlaceName(text)} `;
  const codes = new Set<string>();

  if (/\bU\.?S\.?(?![A-Za-z])/u.test(text)) {
    codes.add("US");
  }

  if (/\bU\.?K\.?(?![A-Za-z])/u.test(text)) {
    codes.add("GB");
  }

  for (const [name, code] of countryNameLookup) {
    if (normalized.includes(` ${name} `)) {
      codes.add(code);
    }
  }

  return [...codes].toSorted();
}

export function countryNameFor(code: string) {
  return countryNameByCode.get(code) ?? null;
}

export function continentCodeForCountry(code: string) {
  return countryContinents.get(code) ?? null;
}

export function countryCodesForContinent(code: string) {
  return [...countryContinents.entries()]
    .flatMap(([country, continent]) => (continent === code ? [country] : []))
    .toSorted();
}

export function regionNameFor(countryCode: string | null, region: string | null) {
  if (region === null || region === "") {
    return null;
  }

  const direct = regionByIso.get(region) ?? regionByLegacy.get(region);

  if (direct !== undefined) {
    return direct.name;
  }

  if (countryCode === null) {
    return region;
  }

  const legacy = regionByLegacy.get(`${countryCode}.${region}`);

  if (legacy !== undefined) {
    return legacy.name;
  }

  const named = regionByName
    .get(normalizePlaceName(region))
    ?.find((row) => row.country === countryCode);

  return named?.name ?? region;
}

/**
 * Whether two region values name the same region. A posting tagged before the region name was stored keeps
 * the bare admin1 code ("08"), so compare the resolved names rather than the raw values.
 * @param countryCode The country both values belong to.
 * @param left One region value, a name or an admin1 code.
 * @param right The other region value.
 * @returns True when both resolve to the same region name.
 */
export function sameRegion(countryCode: string | null, left: string | null, right: string | null) {
  const leftName = regionNameFor(countryCode, left);
  const rightName = regionNameFor(countryCode, right);

  return (
    leftName !== null && rightName !== null && leftName.toLowerCase() === rightName.toLowerCase()
  );
}

export function usStateNames() {
  return Object.entries(dataset.regions)
    .filter(([code]) => code.startsWith("US."))
    .map(([, name]) => normalizePlaceName(name));
}

export function isCountryCode(code: string) {
  return Object.hasOwn(dataset.countries, code);
}

export function continentNameFor(code: string) {
  return CONTINENTS.get(code) ?? null;
}

export interface GeoCityRow {
  geonameId: number;
  name: string;
  countryCode: string;
  legacyRegionCode: string;
  isoRegionCode: string;
  lat: number;
  lon: number;
  population: number;
  altNames: string;
}

/**
 * Every city row of the committed dataset.
 * @returns The city rows the ETL seeds into `geo_places`.
 */
export function geoCities() {
  return geoDataJson.cities.flatMap((row) => {
    const parsed = cityTupleSchema.safeParse(row);

    if (!parsed.success) {
      return [];
    }

    const [id, name, country, admin1, lat, lon, population, altNames] = parsed.data;

    return [
      {
        geonameId: id,
        name,
        countryCode: country,
        legacyRegionCode: `${country}.${admin1}`,
        isoRegionCode: dataset.regionIso[`${country}.${admin1}`] ?? `${country}-${admin1}`,
        lat,
        lon,
        population,
        altNames,
      },
    ];
  });
}

export function geoCountries() {
  return Object.entries(dataset.countries).map(([code, name]) => ({
    code,
    name,
    continentCode: countryContinents.get(code) ?? "NA",
  }));
}

export function geoRegions() {
  return Object.entries(dataset.regions).map(([legacy, name]) => {
    const [country] = legacy.split(".");

    return {
      legacyCode: legacy,
      isoCode: dataset.regionIso[legacy] ?? legacy.replace(".", "-"),
      name,
      countryCode: country ?? legacy.slice(0, 2),
      continentCode: countryContinents.get(country ?? legacy.slice(0, 2)) ?? "NA",
    };
  });
}

export function geoMetros() {
  return [...new Set(metros.values())];
}

export function geoContinents() {
  return [...CONTINENTS].map(([code, name]) => ({
    code,
    name,
    aliases: [
      name,
      ...Object.entries(CONTINENT_NAME_ALIASES)
        .filter(([, codes]) => codes.includes(code))
        .map(([alias]) => alias),
    ],
  }));
}

export function geoDatasetVersion() {
  return dataset.published;
}

function scopeForResolved(resolved: ResolvedPlaceQuery, baseKind: "onsite" | "hybrid" | "remote") {
  const remote = baseKind === "remote";

  let scopeKind: PostingScopeKind = "onsite";

  if (remote) {
    if (resolved.kind === "continent") {
      scopeKind = "remote_continent";
    } else if (resolved.kind === "country") {
      scopeKind = "remote_country";
    } else if (resolved.kind === "region" || resolved.kind === "metro") {
      scopeKind = "remote_region";
    } else if (resolved.kind === "city") {
      scopeKind = "remote_city";
    } else {
      scopeKind = "remote_global";
    }
  } else if (baseKind === "hybrid") {
    scopeKind = "hybrid";
  }

  return {
    continentCode: resolved.continentCodes[0] ?? null,
    countryCode: resolved.countryCodes[0] ?? null,
    regionCode: resolved.regionIsoCode,
    cityGeonameId: resolved.cityGeonameId,
    scopeKind,
  };
}

/**
 * Derives the `posting_locations` rows a Posting contributes. A remote Posting is scoped to every place
 * its text names (`"Remote - Canada"` → `remote_country` CA); an on-site or hybrid Posting keeps its city,
 * region, country and continent on each row so a coarser query still finds it.
 * @param input The raw location and the tagged workplace.
 * @returns Deduplicated rows, at most one per scope and place.
 */
export function postingLocationScopes(input: {
  locationRaw: string | null | undefined;
  workplace: string | null | undefined;
}) {
  const remote = input.workplace === "remote" || isRemoteLocationText(input.locationRaw);
  let baseKind: "onsite" | "hybrid" | "remote" = "onsite";

  if (remote) {
    baseKind = "remote";
  } else if (input.workplace === "hybrid") {
    baseKind = "hybrid";
  }

  const groups =
    input.locationRaw === null || input.locationRaw === undefined
      ? []
      : locationGroups(input.locationRaw);

  const rows: PostingLocationScope[] = [];
  const seen = new Set<string>();

  const add = (row: PostingLocationScope) => {
    const key = [
      row.scopeKind,
      row.continentCode ?? "",
      row.countryCode ?? "",
      row.regionCode ?? "",
      row.cityGeonameId ?? "",
    ].join("|");

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    rows.push(row);
  };

  for (const group of groups) {
    const resolved: ResolvedPlaceQuery = resolvePlaceQuery(group);

    if (resolved.kind === null && resolved.remote) {
      continue;
    }

    if (resolved.kind === null) {
      continue;
    }

    add(scopeForResolved(resolved, baseKind));
  }

  if (rows.length === 0 && remote) {
    add({
      continentCode: null,
      countryCode: null,
      regionCode: null,
      cityGeonameId: null,
      scopeKind: "remote_global",
    });
  }

  return rows;
}

/**
 * The bounding box a metro or radius search scans, rounded outward by one degree so the R-Tree overlap
 * test never misses a border city. `null` when the resolved place has no box.
 * @param bbox The metro box, if any.
 * @returns The same box, or null.
 */
export function metroBoundingBox(bbox: readonly [number, number, number, number] | null) {
  if (bbox === null) {
    return null;
  }

  const [minLat, maxLat, minLon, maxLon] = bbox;

  return [minLat, maxLat, minLon, maxLon] as const;
}

/**
 * The great-circle distance between two points, in kilometres.
 * @param left The first point.
 * @param right The second point.
 * @returns The distance in kilometres.
 */
export function haversineKm(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number },
) {
  const earthRadiusKm = 6371.0088;
  const toRadians = Math.PI / 180;
  const deltaLat = (right.lat - left.lat) * toRadians;
  const deltaLon = (right.lon - left.lon) * toRadians;
  const leftLat = left.lat * toRadians;
  const rightLat = right.lat * toRadians;

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function allMetroAreas() {
  return METRO_AREAS.map((metro) => ({
    name: metro.name,
    norm: normalizePlaceName(metro.name),
    aliases: metro.aliases,
    countryCode: metro.countryCode,
    isoRegionCode: metro.isoRegionCode,
    continentCode: metro.continentCode,
    bbox: metro.bbox,
  }));
}
