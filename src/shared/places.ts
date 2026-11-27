import { z } from "zod";

/**
 * The canonical place ids both sides of a location match use (issue #683, SPEC §6.4). Physical places follow
 * freehire's own lists: `country:<iso2>`, `region:<slug>`, `metro:<slug>` and `city:<iso2>:<slug>`. Remote work is
 * an explicit scope on top: `remote:country:<iso2>`, `remote:continent:<code>` and `remote:worldwide`.
 */
export const PLACE_KINDS = [
  "country",
  "region",
  "metro",
  "city",
  "remote_country",
  "remote_continent",
  "remote_worldwide",
] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

/** The continent codes the geo dataset and freehire's regions use. */
export const CONTINENT_CODES = ["AF", "AN", "AS", "EU", "NA", "OC", "SA"] as const;

export type ContinentCode = (typeof CONTINENT_CODES)[number];

/**
 * Whether a string is one of the continent codes.
 * @param value The candidate.
 * @returns True for AF, AN, AS, EU, NA, OC or SA.
 */
export function isContinentCode(value: string): value is ContinentCode {
  return CONTINENT_CODE_SET.has(value);
}

const CONTINENT_CODE_SET: ReadonlySet<string> = new Set(CONTINENT_CODES);

/** freehire's region slug for each continent. `eu` and `north_america` match values freehire sends today. */
export const FREEHIRE_REGION_BY_CONTINENT = {
  AF: "africa",
  AN: "antarctica",
  AS: "asia",
  EU: "eu",
  NA: "north_america",
  OC: "oceania",
  SA: "south_america",
} as const satisfies Record<ContinentCode, string>;

/** A worldwide remote scope: any remote job, wherever freehire places it. */
export const REMOTE_WORLDWIDE_ID = "remote:worldwide";

const PLACE_ID_MAX = 120;

const countryIdPattern = /^country:(?<code>[a-z]{2})$/u;
const regionIdPattern = /^region:(?<slug>[a-z0-9]+(?:_[a-z0-9]+)*)$/u;
const metroIdPattern = /^metro:(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const cityIdPattern = /^city:(?<code>[a-z]{2}):(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$/u;
const remoteCountryIdPattern = /^remote:country:(?<code>[a-z]{2})$/u;
const remoteContinentIdPattern = /^remote:continent:(?<code>AF|AN|AS|EU|NA|OC|SA)$/u;

export interface ParsedPlaceId {
  id: string;
  kind: PlaceKind;
  /** The ISO alpha-2 country code for a country or city id, lower case. */
  countryCode: string | null;
  /** The slug of a region, metro or city id. */
  slug: string | null;
  continentCode: ContinentCode | null;
}

/**
 * Folds a place name to the slug a place id carries: lower case, accents removed, every run of other characters
 * one hyphen. "New York City" and "new-york-city" both become `new-york-city`.
 * @param value The place name or an existing slug.
 * @returns The slug.
 */
export function placeSlug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036F]/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

/**
 * Folds a region name to a freehire region slug, which uses underscores ("north_america").
 * @param value The region name or an existing freehire slug.
 * @returns The region slug.
 */
export function regionSlug(value: string) {
  return placeSlug(value).replaceAll("-", "_");
}

export function countryPlaceId(code: string) {
  return `country:${code.trim().toLowerCase()}`;
}

export function regionPlaceId(value: string) {
  return `region:${regionSlug(value)}`;
}

export function metroPlaceId(value: string) {
  return `metro:${placeSlug(value)}`;
}

export function cityPlaceId(countryCode: string, city: string) {
  return `city:${countryCode.trim().toLowerCase()}:${placeSlug(city)}`;
}

export function remoteCountryPlaceId(code: string) {
  return `remote:country:${code.trim().toLowerCase()}`;
}

export function remoteContinentPlaceId(code: ContinentCode) {
  return `remote:continent:${code}`;
}

/**
 * Reads a canonical place id without touching any catalog, so a stored target can be validated on the edge.
 * @param value The candidate id.
 * @returns The parsed id, or null when the value is not a place id.
 */
export function parsePlaceId(value: string) {
  const id = value.trim();
  const remoteCountry = remoteCountryIdPattern.exec(id);
  const remoteContinent = remoteContinentIdPattern.exec(id);
  const remoteContinentCode = remoteContinent?.groups?.code ?? "";
  const country = countryIdPattern.exec(id);
  const region = regionIdPattern.exec(id);
  const metro = metroIdPattern.exec(id);
  const city = cityIdPattern.exec(id);

  let parsed: ParsedPlaceId | null = null;

  if (id === REMOTE_WORLDWIDE_ID) {
    parsed = { continentCode: null, countryCode: null, id, kind: "remote_worldwide", slug: null };
  } else if (remoteCountry !== null) {
    parsed = {
      continentCode: null,
      countryCode: remoteCountry.groups?.code ?? null,
      id,
      kind: "remote_country",
      slug: null,
    };
  } else if (remoteContinent !== null && isContinentCode(remoteContinentCode)) {
    parsed = {
      continentCode: remoteContinentCode,
      countryCode: null,
      id,
      kind: "remote_continent",
      slug: null,
    };
  } else if (country !== null) {
    parsed = {
      continentCode: null,
      countryCode: country.groups?.code ?? null,
      id,
      kind: "country",
      slug: null,
    };
  } else if (region !== null) {
    parsed = {
      continentCode: null,
      countryCode: null,
      id,
      kind: "region",
      slug: region.groups?.slug ?? null,
    };
  } else if (metro !== null) {
    parsed = {
      continentCode: null,
      countryCode: null,
      id,
      kind: "metro",
      slug: metro.groups?.slug ?? null,
    };
  } else if (city !== null) {
    parsed = {
      continentCode: null,
      countryCode: city.groups?.code ?? null,
      id,
      kind: "city",
      slug: city.groups?.slug ?? null,
    };
  }

  return parsed;
}

/**
 * Whether a string is a canonical place id.
 * @param value The candidate.
 * @returns True for a country, region, metro, city or remote scope id.
 */
export function isPlaceId(value: string) {
  return parsePlaceId(value) !== null;
}

/** A saved place: a canonical id, validated by shape alone so a free-text string never becomes one. */
export const placeIdSchema = z
  .string()
  .trim()
  .min(6)
  .max(PLACE_ID_MAX)
  .refine(isPlaceId, { message: "not a canonical place id" });

/** One suggestion a place picker renders, and the only shape a picker may commit to a target. */
export const placeSuggestionSchema = z.object({
  id: placeIdSchema,
  label: z.string().min(1),
  meta: z.string(),
  kind: z.enum(PLACE_KINDS),
});

export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

export const placeSuggestionsResponseSchema = z.object({
  suggestions: z.array(placeSuggestionSchema),
});

export const placeSuggestQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

/** The words a person uses for remote work, which make a place string an explicit remote scope. */
export const REMOTE_PLACE_WORDS = [
  "remote",
  "fully remote",
  "work from home",
  "wfh",
  "anywhere",
  "worldwide",
  "distributed",
  "telecommute",
  "telework",
  "home based",
] as const;

/**
 * Splits a freehire or human region value into the continent it belongs to, when the value names one.
 * @param value A region slug or name, such as `north_america` or `Europe`.
 * @returns The continent code, or null for an unknown region.
 */
export function continentCodeForRegionValue(value: string) {
  const slug = regionSlug(value);
  const match = CONTINENT_CODES.find((code) => FREEHIRE_REGION_BY_CONTINENT[code] === slug);

  return match ?? null;
}

/**
 * The label and quiet second line a picker shows for an id it has no catalog data for. The server sends real labels;
 * this only keeps a stale or hand-written id readable.
 * @param id A canonical place id.
 * @returns The fallback label.
 */
export function placeFallbackLabel(id: string) {
  const parsed = parsePlaceId(id);

  if (parsed === null) {
    return id;
  }

  if (parsed.kind === "country") {
    return (parsed.countryCode ?? "").toUpperCase();
  }

  if (parsed.kind === "city") {
    return humanizeSlug(parsed.slug);
  }

  if (parsed.kind === "remote_country") {
    return `Remote · ${(parsed.countryCode ?? "").toUpperCase()}`;
  }

  if (parsed.kind === "remote_continent") {
    return `Remote · ${parsed.continentCode ?? ""}`;
  }

  if (parsed.kind === "remote_worldwide") {
    return "Remote · Worldwide";
  }

  return humanizeSlug(parsed.slug);
}

function humanizeSlug(value: string | null) {
  return (value ?? "")
    .split(/[-_]/u)
    .filter((word) => word !== "")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}
