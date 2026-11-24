import { sql } from "drizzle-orm";

import { postings } from "../platform/db/catalog-schema.ts";
import { resolveLocation } from "./geo.ts";

/**
 * The SQL condition a free-text place becomes, shared by the candidate target count and the public
 * supply count so a city, region or country means the same thing everywhere. A place the geo dataset
 * cannot resolve falls back to a substring of the raw location.
 * @param raw The place a person typed.
 * @returns The condition over `postings`.
 */
export function resolvedLocationCondition(raw: string) {
  const resolved = resolveLocation(raw);

  if (resolved.countryCode === null) {
    const needle = raw.toLowerCase();

    return sql`lower(coalesce(${postings.locationRaw}, '')) like ${`%${needle}%`}`;
  }

  if (resolved.city !== null) {
    const city = resolved.city.toLowerCase();

    return sql`${postings.countryCode} = ${resolved.countryCode} and lower(${postings.city}) = ${city}`;
  }

  if (resolved.region !== null) {
    const region = resolved.region.toLowerCase();
    const legacyRegion = resolved.regionCode?.split(".")[1]?.toLowerCase();

    return legacyRegion === undefined
      ? sql`${postings.countryCode} = ${resolved.countryCode} and lower(${postings.region}) = ${region}`
      : sql`${postings.countryCode} = ${resolved.countryCode} and (lower(${postings.region}) = ${region} or lower(${postings.region}) = ${legacyRegion})`;
  }

  return sql`${postings.countryCode} = ${resolved.countryCode}`;
}
