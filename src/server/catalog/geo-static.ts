export const CONTINENTS = new Map(
  Object.entries({
    AF: "Africa",
    AN: "Antarctica",
    AS: "Asia",
    EU: "Europe",
    NA: "North America",
    OC: "Oceania",
    SA: "South America",
  } satisfies Record<string, string>),
);

export const CONTINENT_ALIASES = new Map(
  Object.entries({
    apac: ["AS", "OC"],
    emea: ["EU", "AF", "AS"],
    "europe middle east africa": ["EU", "AF", "AS"],
    "latin america": ["SA"],
    latam: ["SA"],
    "middle east": ["AS"],
  } satisfies Record<string, readonly string[]>),
);

export interface MetroArea {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly countryCode: string;
  readonly isoRegionCode: string | null;
  readonly continentCode: string;
  readonly bbox: readonly [number, number, number, number];
}

export const METRO_AREAS: readonly MetroArea[] = [
  {
    name: "Bay Area",
    aliases: ["sf bay area", "san francisco bay area", "silicon valley", "south bay"],
    countryCode: "US",
    isoRegionCode: "US-CA",
    continentCode: "NA",
    bbox: [36.85, 38.75, -123.15, -121.15],
  },
  {
    name: "GTA",
    aliases: ["greater toronto area", "toronto area", "toronto metro"],
    countryCode: "CA",
    isoRegionCode: "CA-ON",
    continentCode: "NA",
    bbox: [43.15, 44.45, -80.05, -78.75],
  },
  {
    name: "Tri-State",
    aliases: ["tri state area", "tri state", "nyc metro", "new york metro", "greater new york"],
    countryCode: "US",
    isoRegionCode: null,
    continentCode: "NA",
    bbox: [39.6, 41.75, -75.6, -72],
  },
  {
    name: "DMV",
    aliases: ["dc area", "washington metro", "washington dc metro", "district of columbia area"],
    countryCode: "US",
    isoRegionCode: null,
    continentCode: "NA",
    bbox: [38.1, 39.5, -78.1, -76.4],
  },
  {
    name: "Greater Boston",
    aliases: ["boston metro", "boston area"],
    countryCode: "US",
    isoRegionCode: "US-MA",
    continentCode: "NA",
    bbox: [41.95, 42.85, -71.7, -70.4],
  },
  {
    name: "Chicagoland",
    aliases: ["greater chicago", "chicago metro", "chicago area"],
    countryCode: "US",
    isoRegionCode: "US-IL",
    continentCode: "NA",
    bbox: [41.1, 42.6, -88.7, -87.3],
  },
  {
    name: "Greater Los Angeles",
    aliases: ["la metro", "los angeles metro", "socal", "southern california"],
    countryCode: "US",
    isoRegionCode: "US-CA",
    continentCode: "NA",
    bbox: [33.35, 34.65, -119.1, -117.3],
  },
  {
    name: "DFW",
    aliases: ["dallas fort worth", "dallas-fort worth", "dallas metro"],
    countryCode: "US",
    isoRegionCode: "US-TX",
    continentCode: "NA",
    bbox: [32.15, 33.65, -97.7, -96.1],
  },
  {
    name: "Greater Seattle",
    aliases: ["seattle metro", "puget sound", "seattle area"],
    countryCode: "US",
    isoRegionCode: "US-WA",
    continentCode: "NA",
    bbox: [46.9, 48.25, -122.9, -121.3],
  },
  {
    name: "Greater London",
    aliases: ["london metro", "london area"],
    countryCode: "GB",
    isoRegionCode: "GB-ENG",
    continentCode: "EU",
    bbox: [51.2, 51.8, -0.75, 0.4],
  },
  {
    name: "Greater Manchester",
    aliases: ["manchester metro", "manchester area"],
    countryCode: "GB",
    isoRegionCode: "GB-ENG",
    continentCode: "EU",
    bbox: [53.3, 53.65, -2.6, -1.9],
  },
  {
    name: "Île-de-France",
    aliases: ["paris metro", "greater paris", "paris area"],
    countryCode: "FR",
    isoRegionCode: "FR-IDF",
    continentCode: "EU",
    bbox: [48.1, 49.25, 1.4, 3.6],
  },
  {
    name: "Randstad",
    aliases: ["amsterdam metro", "greater amsterdam"],
    countryCode: "NL",
    isoRegionCode: null,
    continentCode: "EU",
    bbox: [51.85, 52.75, 4.2, 5.25],
  },
  {
    name: "Greater Sydney",
    aliases: ["sydney metro", "sydney area"],
    countryCode: "AU",
    isoRegionCode: "AU-NSW",
    continentCode: "OC",
    bbox: [-34.3, -33.35, 150.2, 151.35],
  },
  {
    name: "Greater Melbourne",
    aliases: ["melbourne metro", "melbourne area"],
    countryCode: "AU",
    isoRegionCode: "AU-VIC",
    continentCode: "OC",
    bbox: [-38.25, -37.45, 144.45, 145.55],
  },
];

export const ADMIN1_TO_ISO = new Map(
  Object.entries({
    "CA.01": "CA-AB",
    "CA.02": "CA-BC",
    "CA.03": "CA-MB",
    "CA.04": "CA-NB",
    "CA.05": "CA-NL",
    "CA.07": "CA-NS",
    "CA.08": "CA-ON",
    "CA.09": "CA-PE",
    "CA.10": "CA-QC",
    "CA.11": "CA-SK",
    "CA.12": "CA-YT",
    "CA.13": "CA-NT",
    "CA.14": "CA-NU",
    "AU.01": "AU-ACT",
    "AU.02": "AU-NSW",
    "AU.03": "AU-NT",
    "AU.04": "AU-QLD",
    "AU.05": "AU-SA",
    "AU.06": "AU-TAS",
    "AU.07": "AU-VIC",
    "AU.08": "AU-WA",
    "FR.11": "FR-IDF",
    "FR.24": "FR-CVL",
    "FR.27": "FR-BFC",
    "FR.28": "FR-NOR",
    "FR.32": "FR-HDF",
    "FR.44": "FR-GES",
    "FR.52": "FR-PDL",
    "FR.53": "FR-BRE",
    "FR.75": "FR-NAQ",
    "FR.76": "FR-OCC",
    "FR.84": "FR-ARA",
    "FR.93": "FR-PAC",
    "FR.94": "FR-COR",
  } satisfies Record<string, string>),
);

/**
 * The ISO-3166-2 code for a GeoNames admin1 code.
 * @param countryCode The two-letter country code.
 * @param admin1 The GeoNames admin1 code, e.g. `08` for Ontario.
 * @returns The ISO-3166-2 code (`CA-ON`) or a stable `CA-08` fallback.
 */
export function isoRegionCodeFor(countryCode: string, admin1: string) {
  return ADMIN1_TO_ISO.get(`${countryCode}.${admin1}`) ?? `${countryCode}-${admin1}`;
}

/**
 * The reverse index used to read a short region token ("ON") as its ISO code.
 * @returns A map from the uppercase subdivision suffix to the ISO-3166-2 code.
 */
export function isoSubdivisionTokens() {
  const tokens = new Map<string, string[]>();

  for (const iso of ADMIN1_TO_ISO.values()) {
    const suffix = iso.slice(3);

    tokens.set(suffix, [...(tokens.get(suffix) ?? []), iso]);
  }

  return tokens;
}
