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

for (const row of dataset.cities) {
  const [name, country, admin1, ...aliases] = row;

  if (name === undefined || country === undefined || admin1 === undefined) {
    continue;
  }

  const city: CityRow = { name, country, admin1 };

  for (const candidate of [name, ...aliases]) {
    const normalized = normalizePlaceName(candidate);

    if (normalized === "" || citiesByName.has(normalized)) {
      continue;
    }

    citiesByName.set(normalized, city);
  }
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
    return { countryCode: null, region: null, city: null };
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

  const countryCode = findCountry(segments);

  const regionCode =
    findRegion(segments, countryCode) ?? findCity(segments, countryCode)?.admin1 ?? null;

  const city = findCity(segments, countryCode);

  return {
    countryCode:
      city?.country ?? countryCode ?? (regionCode === null ? null : regionCode.slice(0, 2)),
    region: regionCode === null ? null : (regionNames.get(regionCode) ?? regionCode),
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
