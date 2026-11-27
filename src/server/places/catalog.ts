import {
  FREEHIRE_REGION_BY_CONTINENT,
  placeFallbackLabel,
  parsePlaceId,
  placeSlug,
  regionSlug,
} from "../../shared/places.ts";
import type { ParsedPlaceId, PlaceKind, PlaceSuggestion } from "../../shared/places.ts";

import {
  cityCandidatesFor,
  cityNameForPlace,
  continentNameFor,
  countryCodeForPlaceName,
  countryCodesForContinent,
  countryNameFor,
  metroCandidatesFor,
  metroNameForPlace,
} from "../catalog/geo.ts";

const REGION_NAME_BY_SLUG = new Map<string, string>(
  Object.entries(FREEHIRE_REGION_BY_CONTINENT).map(([code, slug]) => [
    slug,
    continentNameFor(code) ?? "",
  ]),
);

function countryName(code: string | null) {
  return (code === null ? null : countryNameFor(code.toUpperCase())) ?? (code ?? "").toUpperCase();
}

function regionName(slug: string | null) {
  const name = slug === null ? null : (REGION_NAME_BY_SLUG.get(slug) ?? null);

  return name ?? humanize(slug);
}

function humanize(slug: string | null) {
  return (slug ?? "")
    .split(/[-_]/u)
    .filter((word) => word !== "")
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function cityDisplay(countryCode: string, slug: string) {
  const name = cityNameForPlace(countryCode, slug) ?? humanize(slug);

  const candidate = cityCandidatesFor(name).find(
    (row) => row.countryCode.toUpperCase() === countryCode.toUpperCase(),
  );

  const meta = [candidate?.regionName ?? null, countryName(countryCode)]
    .filter((part) => part !== null && part !== "")
    .join(", ");

  return { label: name, meta };
}

const displayCache = new Map<string, PlaceSuggestion>();

/**
 * The label, quiet second line and kind a picker, pill or drawer shows for one canonical place id.
 * @param id The canonical place id.
 * @returns The display record; a humanised fallback for an id outside the catalog.
 */
export function describePlaceId(id: string) {
  const cached = displayCache.get(id);

  if (cached !== undefined) {
    return cached;
  }

  const parsed = parsePlaceId(id);
  const kind: PlaceKind = parsed?.kind ?? "country";
  let display: PlaceSuggestion;

  if (parsed === null) {
    display = { id, kind, label: placeFallbackLabel(id), meta: "" };
  } else if (parsed.kind === "country") {
    display = { id, kind, label: countryName(parsed.countryCode), meta: "" };
  } else if (parsed.kind === "region") {
    display = { id, kind, label: regionName(parsed.slug), meta: "" };
  } else if (parsed.kind === "metro") {
    const name = metroNameForPlace(parsed.slug ?? "") ?? humanize(parsed.slug);

    display = { id, kind, label: name, meta: "Metro" };
  } else if (parsed.kind === "city") {
    const { label, meta } = cityDisplay(parsed.countryCode ?? "", parsed.slug ?? "");

    display = { id, kind, label, meta };
  } else if (parsed.kind === "remote_country") {
    const name = countryName(parsed.countryCode);

    display = { id, kind, label: `Remote · ${name}`, meta: name };
  } else if (parsed.kind === "remote_continent") {
    const name = continentNameFor(parsed.continentCode ?? "") ?? humanize(parsed.slug);

    display = { id, kind, label: `Remote · ${name}`, meta: name };
  } else {
    display = { id, kind, label: "Remote · Worldwide", meta: "Anywhere" };
  }

  displayCache.set(id, display);

  return display;
}

/**
 * The display records for a saved target's place ids, in saved order.
 * @param ids The canonical place ids.
 * @returns One record per id, deduplicated.
 */
export function describePlaceIds(ids: readonly string[]) {
  const seen = new Set<string>();

  return ids.flatMap((id) => {
    if (seen.has(id)) {
      return [];
    }

    seen.add(id);

    return [describePlaceId(id)];
  });
}

/**
 * The readable text a legacy reader can resolve with the geo parser: "Toronto, Canada", "Canada", "Europe". Remote
 * countries and continents lose their remote prefix because the retired catalog expresses remote work as a workplace
 * flag, not as a place; the freehire path matches on place ids directly.
 * @param id A canonical place id.
 * @returns The text, or an empty string for an unknown id.
 */
export function locationTextOfPlaceId(id: string) {
  const parsed = parsePlaceId(id);

  if (parsed === null) {
    return id;
  }

  if (parsed.kind === "country" || parsed.kind === "remote_country") {
    return countryName(parsed.countryCode);
  }

  if (parsed.kind === "region") {
    return regionName(parsed.slug);
  }

  if (parsed.kind === "remote_continent") {
    return continentNameFor(parsed.continentCode ?? "NA") ?? "Remote";
  }

  if (parsed.kind === "remote_worldwide") {
    return "Remote";
  }

  if (parsed.kind === "metro") {
    return metroNameForPlace(parsed.slug ?? "") ?? humanize(parsed.slug);
  }

  const name =
    cityNameForPlace(parsed.countryCode ?? "", parsed.slug ?? "") ?? humanize(parsed.slug);

  const country = countryName(parsed.countryCode);

  return country === "" ? name : `${name}, ${country}`;
}

/**
 * The readable text of every saved place, for the retired catalog readers that still resolve raw location strings.
 * @param ids The canonical place ids.
 * @returns One text per id.
 */
export function locationTextsOfPlaceIds(ids: readonly string[]) {
  return ids.flatMap((id) => {
    const text = locationTextOfPlaceId(id);

    return text === "" ? [] : [text];
  });
}

/**
 * The countries a saved place set reaches, for country-scoped facts and form answers.
 * @param ids The canonical place ids.
 * @returns Sorted upper-case ISO alpha-2 codes.
 */
export function countryCodesOfPlaceIds(ids: readonly string[]) {
  const codes = new Set<string>();

  for (const id of ids) {
    const parsed = parsePlaceId(id);

    if (parsed?.countryCode !== undefined && parsed.countryCode !== null) {
      codes.add(parsed.countryCode.toUpperCase());
    }

    if (parsed?.kind === "metro" && parsed.slug !== null) {
      const metro = metroCandidatesFor(metroNameForPlace(parsed.slug) ?? parsed.slug);

      for (const row of metro) {
        codes.add(row.countryCode.toUpperCase());
      }
    }

    const continent = continentOf(parsed);

    if (continent !== null) {
      for (const country of countryCodesForContinent(continent)) {
        codes.add(country);
      }
    }
  }

  return [...codes].toSorted();
}

function continentOf(parsed: ParsedPlaceId | null) {
  if (parsed?.kind === "remote_continent") {
    return parsed.continentCode;
  }

  if (parsed?.kind === "region") {
    return continentCodeOfRegionSlug(parsed.slug);
  }

  return null;
}

function continentCodeOfRegionSlug(slug: string | null) {
  if (slug === null) {
    return null;
  }

  const match = Object.entries(FREEHIRE_REGION_BY_CONTINENT).find(([, region]) => region === slug);

  return match?.[0] ?? null;
}

/** The freehire search facets one saved place set turns into. Geography widens in freehire, so every facet is OR. */
export interface PlaceSearchFacets {
  countries: string[];
  regions: string[];
  metros: string[];
  cities: string[];
  placeIds: string[];
}

/**
 * Turns saved place ids into the freehire search facets that pull every job that could match them. A city contributes
 * its country too, so a spelling freehire does not recognise still pulls that country's jobs; the exact match then
 * happens on the place ids.
 * @param ids The canonical place ids.
 * @returns The facets, sorted, plus the ids the reader filters on.
 */
export function placeSearchFacets(ids: readonly string[]) {
  const countries = new Set<string>();
  const regions = new Set<string>();
  const metros = new Set<string>();
  const cities = new Set<string>();

  for (const id of ids) {
    const parsed = parsePlaceId(id);

    if (parsed === null) {
      continue;
    }

    if (
      (parsed.kind === "country" || parsed.kind === "remote_country") &&
      parsed.countryCode !== null
    ) {
      countries.add(parsed.countryCode);
    }

    if (parsed.kind === "region" && parsed.slug !== null) {
      regions.add(parsed.slug);
    }

    if (parsed.kind === "remote_continent" && parsed.continentCode !== null) {
      regions.add(FREEHIRE_REGION_BY_CONTINENT[parsed.continentCode]);
    }

    if (parsed.kind === "metro" && parsed.slug !== null) {
      metros.add(metroNameForPlace(parsed.slug) ?? humanize(parsed.slug));
    }

    if (parsed.kind === "city" && parsed.countryCode !== null) {
      countries.add(parsed.countryCode);
      cities.add(cityNameForPlace(parsed.countryCode, parsed.slug ?? "") ?? humanize(parsed.slug));
    }
  }

  return {
    cities: [...cities].toSorted(),
    countries: [...countries].toSorted(),
    metros: [...metros].toSorted(),
    placeIds: [...new Set(ids)].toSorted(),
    regions: [...regions].toSorted(),
  } satisfies PlaceSearchFacets;
}

/**
 * The slug of a freehire region value, so a job's own region spelling and a saved region id compare equal.
 * @param value The freehire region value.
 * @returns The region slug.
 */
export function freehireRegionSlug(value: string) {
  return regionSlug(value);
}

/**
 * The city slug a freehire city value maps to inside one of the job's countries, using the dataset's spelling when it
 * knows the city and the raw value otherwise.
 * @param value The freehire city value.
 * @param countryCode The job's country.
 * @returns The slug.
 */
export function freehireCitySlug(value: string, countryCode: string) {
  const candidate = cityCandidatesFor(value).find(
    (row) => row.countryCode.toLowerCase() === countryCode.toLowerCase(),
  );

  return placeSlug(candidate?.canonicalName ?? value);
}

/**
 * Whether a freehire "city" value is really a country name freehire puts in the city facet ("Canada" on a remote
 * posting), which must not become a city id.
 * @param value The freehire city value.
 * @returns True when the value names a country.
 */
export function cityValueNamesCountry(value: string) {
  return countryCodeForPlaceName(value) !== null;
}
