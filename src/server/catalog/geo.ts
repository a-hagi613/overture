import citiesDataJson from "./tag-data/geonames-cities.json";

const dataset: {
  cities: string[][];
  regions: Record<string, string>;
  countries: Record<string, string>;
} = citiesDataJson;

interface CityRow {
  name: string;
  country: string;
  admin1: string;
}

const countries = new Map<string, string>();

for (const [code, name] of Object.entries(dataset.countries)) {
  countries.set(normalizePlaceName(name), code);
  countries.set(code.toLowerCase(), code);
}

const nonCountryNames = new Set([
  "europe",
  "emea",
  "apac",
  "latam",
  "european union",
  "north america",
  "south america",
  "worldwide",
  "global",
  "africa",
  "north england",
  "dc area",
]);

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
]);

const remoteKeywords = new Set([
  "remote",
  "anywhere",
  "work from home",
  "wfh",
  "distributed",
  "worldwide",
]);

const countryNameLookup = new Map<string, string>();

for (const [code, name] of Object.entries(dataset.countries)) {
  for (const candidate of [name, name.replace(/^the /iu, "")]) {
    const normalized = normalizePlaceName(candidate);

    if (normalized.length >= 3) {
      countryNameLookup.set(normalized, code);
    }
  }
}

for (const [alias, code] of countryAliases) {
  countryNameLookup.set(alias, code);
}

const regionNames = new Map<string, string>();
const regionNameLookup = new Map<string, string>();
const regionAbbreviations = new Map<string, string>();

for (const [code, name] of Object.entries(dataset.regions)) {
  regionNames.set(code, name);
  const [country, suffix] = code.split(".");

  if (name.length > 2) {
    regionNameLookup.set(normalizePlaceName(name), code);
  }

  if (suffix?.length === 2 && country?.length === 2) {
    regionAbbreviations.set(suffix.toLowerCase(), code);
  }
}

const citiesByName = new Map<string, CityRow>();
const citiesByUsState = new Map<string, CityRow>();

const nonCityNames = new Set<string>([
  ...countries.keys(),
  ...countryNameLookup.keys(),
  ...nonCountryNames,
  ...remoteKeywords,
]);

const cities = dataset.cities.flatMap((row) => {
  const [name, country, admin1, ...aliases] = row;

  if (name === undefined || country === undefined || admin1 === undefined) {
    return [];
  }

  return [{ aliases, city: { name, country, admin1 } }];
});

for (const { city } of cities) {
  const normalized = normalizePlaceName(city.name);

  if (normalized !== "" && !citiesByName.has(normalized)) {
    citiesByName.set(normalized, city);
  }

  if (city.country === "US" && /^[A-Z]{2}$/u.test(city.admin1)) {
    const stateKey = `${normalizePlaceName(city.name)}|${city.admin1}`;

    if (!citiesByUsState.has(stateKey)) {
      citiesByUsState.set(stateKey, city);
    }
  }
}

for (const { aliases, city } of cities) {
  for (const alias of aliases) {
    const normalized = normalizePlaceName(alias);

    if (normalized === "" || nonCityNames.has(normalized) || citiesByName.has(normalized)) {
      continue;
    }

    citiesByName.set(normalized, city);
  }
}

function findUsCityWithState(segments: readonly string[]) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    const city = normalizePlaceName(segments[index] ?? "");
    const state = (segments[index + 1] ?? "").trim().toUpperCase();

    if (city === "" || !/^[A-Z]{2}$/u.test(state)) {
      continue;
    }

    const row = citiesByUsState.get(`${city}|${state}`);

    if (row !== undefined) {
      return row;
    }
  }

  return null;
}

export function normalizePlaceName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function isRemoteLocationText(text: string | null | undefined) {
  if (text === undefined || text === null) {
    return false;
  }

  const normalized = normalizePlaceName(text);

  return [...remoteKeywords].some((keyword) => normalized.includes(keyword));
}

export function resolveLocation(locationRaw: string | null | undefined) {
  if (locationRaw === undefined || locationRaw === null) {
    return { countryCode: null, region: null, regionCode: null, city: null };
  }

  const flattened = locationRaw.replaceAll(/\[|\]/gu, " ");

  const segments = flattened
    .split(/[,;|()•·]/u)
    .flatMap((segment) => segment.split(/\s[-–—]\s/u))
    .map((segment) => segment.trim().replaceAll(/\s+/gu, " "))
    .filter((segment) => {
      const normalized = normalizePlaceName(segment);

      return (
        segment.length > 1 && !remoteKeywords.has(normalized) && !nonCountryNames.has(normalized)
      );
    });

  const usCity = findUsCityWithState(segments);
  const countryCode = usCity?.country ?? findCountry(segments);
  const city = usCity ?? findCity(segments, countryCode);

  const cityRegionCode =
    city === null || city.admin1 === "" ? null : `${city.country}.${city.admin1}`;

  const regionCode =
    usCity === null ? (findRegion(segments, countryCode) ?? cityRegionCode) : cityRegionCode;

  return {
    countryCode:
      city?.country ?? countryCode ?? (regionCode === null ? null : regionCode.slice(0, 2)),
    region: regionCode === null ? null : (regionNames.get(regionCode) ?? regionCode),
    regionCode,
    city: city?.name ?? null,
  };
}

function findCountry(segments: string[]) {
  for (const segment of segments.toReversed()) {
    const normalized = normalizePlaceName(segment);
    const aliasCode = countryAliases.get(normalized);

    if (aliasCode !== undefined) {
      return aliasCode;
    }

    const code = countries.get(normalized);

    if (code !== undefined && code !== "") {
      return code;
    }
  }

  return null;
}

function findRegion(segments: string[], countryCode: string | null) {
  for (const segment of segments) {
    const normalized = normalizePlaceName(segment);

    if (/^[a-z]{2}$/u.test(normalized)) {
      const abbreviation = regionAbbreviations.get(normalized);

      if (abbreviation && (countryCode === null || abbreviation.startsWith(countryCode))) {
        return abbreviation;
      }

      continue;
    }

    const full = regionNameLookup.get(normalized);

    if (full && (countryCode === null || full.startsWith(countryCode))) {
      return full;
    }
  }

  return null;
}

function findCity(segments: string[], countryCode: string | null) {
  for (const segment of segments) {
    const normalized = normalizePlaceName(segment);

    if (regionAbbreviations.has(normalized)) {
      continue;
    }

    const row = citiesByName.get(normalized);

    if (row && (countryCode === null || row.country === countryCode)) {
      return row;
    }
  }

  return null;
}

const US_ABBREVIATION = /\bU\.?S\.?(?![A-Za-z])/u;
const UK_ABBREVIATION = /\bU\.?K\.?(?![A-Za-z])/u;

export function countryCodesNamedIn(text: string) {
  const normalized = ` ${normalizePlaceName(text)} `;
  const codes = new Set<string>();

  if (US_ABBREVIATION.test(text)) {
    codes.add("US");
  }

  if (UK_ABBREVIATION.test(text)) {
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
  return dataset.countries[code] ?? null;
}

export function regionNameFor(countryCode: string | null, region: string | null) {
  if (region === null || region === "") {
    return null;
  }

  if (regionNames.has(region)) {
    return regionNames.get(region) ?? null;
  }

  if (countryCode === null) {
    return region;
  }

  return regionNames.get(`${countryCode}.${region}`) ?? region;
}

/**
 * Whether two region values name the same region. A posting tagged before the
 * region name was stored keeps the bare admin1 code ("08"), so compare the
 * resolved names rather than the raw values.
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
