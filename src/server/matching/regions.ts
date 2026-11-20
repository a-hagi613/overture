const EU_COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
];

const REGION_COUNTRIES = new Map<string, readonly string[]>([
  ["EU", EU_COUNTRIES],
  ["EEA", [...EU_COUNTRIES, "IS", "LI", "NO"]],
  ["EMEA", [...EU_COUNTRIES, "GB", "CH", "IS", "LI", "NO", "IL", "AE", "ZA", "NG", "KE", "EG"]],
  ["APAC", ["JP", "KR", "CN", "TW", "HK", "SG", "AU", "NZ", "IN", "ID", "MY", "PH", "TH", "VN"]],
  ["LATAM", ["BR", "AR", "CL", "CO", "MX", "PE", "UY", "CR", "PA"]],
  ["NORTH AMERICA", ["US", "CA", "MX"]],
]);

const REGION_ALIASES: readonly { phrase: string; region: string }[] = [
  { phrase: "european union", region: "EU" },
  { phrase: "europe", region: "EU" },
  { phrase: "eu", region: "EU" },
  { phrase: "eea", region: "EEA" },
  { phrase: "emea", region: "EMEA" },
  { phrase: "asia pacific", region: "APAC" },
  { phrase: "asia", region: "APAC" },
  { phrase: "apac", region: "APAC" },
  { phrase: "latin america", region: "LATAM" },
  { phrase: "south america", region: "LATAM" },
  { phrase: "latam", region: "LATAM" },
  { phrase: "north america", region: "NORTH AMERICA" },
];

const WORLDWIDE_ALIASES = ["worldwide", "anywhere", "global", "remote"];

function normalizedPlace(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function remoteRegionOf(locationRaw: string | null) {
  if (locationRaw === null) {
    return null;
  }

  const normalized = normalizedPlace(locationRaw);
  const padded = ` ${normalized} `;

  for (const alias of REGION_ALIASES) {
    if (padded.includes(` ${alias.phrase} `)) {
      return alias.region;
    }
  }

  for (const alias of WORLDWIDE_ALIASES) {
    if (padded.includes(` ${alias} `)) {
      return "WORLDWIDE";
    }
  }

  return null;
}

export function countryInRegion(countryCode: string, region: string) {
  const countries = REGION_COUNTRIES.get(region);

  if (countries === undefined) {
    return false;
  }

  return countries.includes(countryCode);
}
