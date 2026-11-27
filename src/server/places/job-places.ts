import type { FreehireJobRecord } from "../../shared/freehire.ts";
import {
  cityPlaceId,
  continentCodeForRegionValue,
  countryPlaceId,
  isContinentCode,
  metroPlaceId,
  parsePlaceId,
  regionPlaceId,
  remoteContinentPlaceId,
  remoteCountryPlaceId,
  REMOTE_WORLDWIDE_ID,
} from "../../shared/places.ts";
import type { ContinentCode, PlaceKind } from "../../shared/places.ts";

import { continentCodeForCountry, countryCodeForPlaceName, isCountryCode } from "../catalog/geo.ts";
import { cityValueNamesCountry, freehireCitySlug, freehireRegionSlug } from "./catalog.ts";

type PlaceJob = Pick<
  FreehireJobRecord,
  "countries" | "regions" | "metros" | "cities" | "work_mode"
>;

function countryCode(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 2 && isCountryCode(trimmed.toUpperCase())) {
    return trimmed.toLowerCase();
  }

  return countryCodeForPlaceName(trimmed)?.toLowerCase();
}

function countryCodes(job: PlaceJob) {
  const codes = new Set<string>();

  for (const value of job.countries ?? []) {
    const code = countryCode(value);

    if (code !== undefined) {
      codes.add(code);
    }
  }

  return [...codes].toSorted();
}

function regionSlugs(job: PlaceJob) {
  return [
    ...new Set(
      (job.regions ?? []).map((value) => freehireRegionSlug(value)).filter((slug) => slug !== ""),
    ),
  ].toSorted();
}

function continentOfRegion(slug: string) {
  const continent = continentCodeForRegionValue(slug);

  return continent === null ? [] : [continent];
}

/**
 * The canonical place ids a freehire posting is published for, from the same lists a person picks from. A posting
 * freehire gives no country to is left out unless it is remote, in which case only `Remote · Worldwide` matches it
 * (SPEC §6.4). A remote posting also carries its country, continent and worldwide scopes.
 * @param job The freehire record.
 * @returns Sorted, deduplicated place ids.
 */
export function jobPlaceIds(job: PlaceJob) {
  const countries = countryCodes(job);
  const remote = job.work_mode === "remote";

  if (countries.length === 0) {
    return remote ? [REMOTE_WORLDWIDE_ID] : [];
  }

  const ids = new Set<string>();

  for (const code of countries) {
    ids.add(countryPlaceId(code));
  }

  const regions = regionSlugs(job);

  for (const slug of regions) {
    ids.add(regionPlaceId(slug));
  }

  for (const value of job.metros ?? []) {
    const slug = value.trim().toLowerCase().replaceAll(/\s+/gu, "-");

    if (slug !== "") {
      ids.add(metroPlaceId(slug));
    }
  }

  for (const value of job.cities ?? []) {
    if (value.trim() === "" || cityValueNamesCountry(value)) {
      continue;
    }

    for (const code of countries) {
      ids.add(cityPlaceId(code, freehireCitySlug(value, code)));
    }
  }

  if (remote) {
    const continents = new Set<ContinentCode>();

    for (const code of countries) {
      ids.add(remoteCountryPlaceId(code));

      const continent = continentCodeForCountry(code.toUpperCase());

      if (continent !== null && isContinentCode(continent)) {
        continents.add(continent);
      }
    }

    for (const slug of regions) {
      for (const continent of continentOfRegion(slug)) {
        continents.add(continent);
      }
    }

    for (const continent of continents) {
      ids.add(remoteContinentPlaceId(continent));
    }

    ids.add(REMOTE_WORLDWIDE_ID);
  }

  return [...ids].toSorted();
}

/** One `job_places` row: the canonical id and the kind the id parses to. */
export interface JobPlaceRow {
  placeId: string;
  kind: PlaceKind;
}

/**
 * The rows `job_places` stores for one posting.
 * @param job The freehire record.
 * @returns One row per place id.
 */
export function jobPlaceRows(job: PlaceJob) {
  return jobPlaceIds(job).flatMap((placeId) => {
    const parsed = parsePlaceId(placeId);

    return parsed === null ? [] : [{ kind: parsed.kind, placeId } satisfies JobPlaceRow];
  });
}
