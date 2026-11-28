import { inArray, or, sql } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";

import { postings } from "../platform/db/catalog-schema.ts";
import { countryCodesForContinent, haversineKm, resolveLocationQuery } from "./geo.ts";
import type { ResolvedPlaceQuery } from "./geo.ts";

export interface LocationFilterOptions {
  /** A radius in kilometres around a resolved city; null keeps an exact city match. */
  radiusKm?: number | null;
  /** Whether a place query also accepts remote scopes. Defaults to true. */
  includeRemote?: boolean;
}

const ONSITE_SCOPES = ["onsite", "hybrid"] as const;

const REMOTE_SCOPES = [
  "remote_city",
  "remote_region",
  "remote_country",
  "remote_continent",
  "remote_global",
] as const;

interface CityBoxRow {
  geonameId: number;
  lat: number;
  lon: number;
}

function latitudeDelta(radiusKm: number) {
  return radiusKm / 111.32;
}

function longitudeDelta(radiusKm: number, lat: number) {
  const cosine = Math.cos((lat * Math.PI) / 180);

  return radiusKm / (111.32 * Math.max(0.05, Math.abs(cosine)));
}

function cityIdsInBox(
  db: CatalogDatabase,
  box: { maxLat: number; maxLon: number; minLat: number; minLon: number },
  radiusKm: number | null,
  center: { lat: number; lon: number } | null,
) {
  const rows = db.all<CityBoxRow>(sql`
    select g.geoname_id as geonameId, g.lat as lat, g.lon as lon
    from geo_places_rtree r
    join geo_places g on g.geoname_id = r.geoname_id
    where r.max_lat >= ${box.minLat} and r.min_lat <= ${box.maxLat}
      and r.max_lon >= ${box.minLon} and r.min_lon <= ${box.maxLon}
  `);

  if (radiusKm === null || center === null) {
    return rows.map((row) => row.geonameId);
  }

  return rows
    .filter((row) => haversineKm(center, { lat: row.lat, lon: row.lon }) <= radiusKm)
    .map((row) => row.geonameId);
}

function inScopeKinds(options: LocationFilterOptions, remote: boolean) {
  if (remote) {
    return options.includeRemote === false
      ? sql`1 = 0`
      : inArray(sql`pl.scope_kind`, [...REMOTE_SCOPES]);
  }

  return options.includeRemote === false
    ? inArray(sql`pl.scope_kind`, [...ONSITE_SCOPES])
    : sql`1 = 1`;
}

function scopeCondition(
  db: CatalogDatabase,
  resolved: ResolvedPlaceQuery,
  options: LocationFilterOptions,
) {
  const scopes = inScopeKinds(options, resolved.remote);

  if (resolved.kind === "continent" && resolved.continentCodes.length > 0) {
    return sql`exists (
      select 1 from posting_locations pl
      where pl.posting_id = ${postings.id}
        and ${inArray(sql`pl.continent_code`, [...resolved.continentCodes])}
        and ${scopes}
    )`;
  }

  if (resolved.kind === "country" && resolved.countryCodes.length > 0) {
    return sql`exists (
      select 1 from posting_locations pl
      where pl.posting_id = ${postings.id}
        and ${inArray(sql`pl.country_code`, [...resolved.countryCodes])}
        and ${scopes}
    )`;
  }

  if (resolved.kind === "region" && resolved.regionIsoCode !== null) {
    return sql`exists (
      select 1 from posting_locations pl
      where pl.posting_id = ${postings.id}
        and pl.region_code = ${resolved.regionIsoCode}
        and ${scopes}
    )`;
  }

  if (resolved.kind === "metro" && resolved.metroBbox !== null) {
    const [minLat, maxLat, minLon, maxLon] = resolved.metroBbox;
    const ids = cityIdsInBox(db, { maxLat, maxLon, minLat, minLon }, null, null);

    if (ids.length === 0) {
      return sql`exists (
        select 1 from posting_locations pl
        where pl.posting_id = ${postings.id}
          and pl.country_code = ${resolved.countryCodes[0] ?? ""}
          and ${scopes}
      )`;
    }

    return sql`exists (
      select 1 from posting_locations pl
      where pl.posting_id = ${postings.id}
        and ${inArray(sql`pl.city_geoname_id`, ids)}
        and ${scopes}
    )`;
  }

  if (resolved.kind === "city" && resolved.cityGeonameId !== null) {
    const radiusKm = options.radiusKm ?? null;
    const ids = new Set<number>([resolved.cityGeonameId]);

    if (radiusKm !== null && resolved.lat !== null && resolved.lon !== null) {
      const latDelta = latitudeDelta(radiusKm);
      const lonDelta = longitudeDelta(radiusKm, resolved.lat);

      for (const id of cityIdsInBox(
        db,
        {
          maxLat: resolved.lat + latDelta,
          maxLon: resolved.lon + lonDelta,
          minLat: resolved.lat - latDelta,
          minLon: resolved.lon - lonDelta,
        },
        radiusKm,
        { lat: resolved.lat, lon: resolved.lon },
      )) {
        ids.add(id);
      }
    }

    return sql`exists (
      select 1 from posting_locations pl
      where pl.posting_id = ${postings.id}
        and ${inArray(sql`pl.city_geoname_id`, [...ids])}
        and ${scopes}
    )`;
  }

  return null;
}

function legacyCondition(resolved: ResolvedPlaceQuery, raw: string) {
  const countryCode = resolved.countryCodes[0] ?? null;

  if (resolved.remote) {
    if (countryCode !== null) {
      return sql`${postings.workplace} = 'remote' and ${postings.countryCode} = ${countryCode}`;
    }

    return sql`${postings.workplace} = 'remote'`;
  }

  if (resolved.kind === "city" && resolved.cityName !== null && countryCode !== null) {
    return sql`${postings.countryCode} = ${countryCode} and lower(${postings.city}) = ${resolved.cityName.toLowerCase()}`;
  }

  if (resolved.kind === "region" && resolved.regionName !== null && countryCode !== null) {
    const suffix = resolved.legacyRegionCode?.split(".")[1]?.toLowerCase() ?? null;

    return suffix === null
      ? sql`${postings.countryCode} = ${countryCode} and lower(${postings.region}) = ${resolved.regionName.toLowerCase()}`
      : sql`${postings.countryCode} = ${countryCode} and (lower(${postings.region}) = ${resolved.regionName.toLowerCase()} or lower(${postings.region}) = ${suffix})`;
  }

  if (resolved.kind === "country" && countryCode !== null) {
    return sql`${postings.countryCode} = ${countryCode}`;
  }

  if (resolved.kind === "continent" && resolved.continentCodes.length > 0) {
    const codes = resolved.continentCodes.flatMap((code) => countryCodesForContinent(code));

    if (codes.length > 0) {
      return inArray(postings.countryCode, codes);
    }
  }

  if (resolved.kind === "metro" && countryCode !== null) {
    return sql`${postings.countryCode} = ${countryCode}`;
  }

  const needle = raw.toLowerCase();

  return sql`lower(coalesce(${postings.locationRaw}, '')) like ${`%${needle}%`}`;
}

function groupCondition(
  db: CatalogDatabase,
  resolved: ResolvedPlaceQuery,
  raw: string,
  options: LocationFilterOptions,
) {
  const scope = scopeCondition(db, resolved, options);
  const legacy = legacyCondition(resolved, raw);

  if (scope === null) {
    return legacy;
  }

  return sql`(
    ${scope}
    or (not exists (select 1 from posting_locations pl0 where pl0.posting_id = ${postings.id}) and ${legacy})
  )`;
}

/**
 * The SQL condition a free-text place becomes, shared by the candidate target count and the catalog search
 * so a country, region, city, radius or metro means the same thing everywhere. Coarse
 * levels read `posting_locations` B-tree indexes; a city with a radius or a metro box reads the tiny
 * `geo_places_rtree`; a row with no derived location falls back to its own columns.
 * @param db The catalog database that holds the geo tables.
 * @param raw The place a person typed.
 * @param options The radius and whether remote scopes are eligible.
 * @returns The condition over `postings`.
 */
export function resolvedLocationCondition(
  db: CatalogDatabase,
  raw: string,
  options: LocationFilterOptions = {},
) {
  const resolved = resolveLocationQuery(raw).filter((group) => group.kind !== null || group.remote);

  if (resolved.length === 0) {
    const needle = raw.toLowerCase();

    return sql`lower(coalesce(${postings.locationRaw}, '')) like ${`%${needle}%`}`;
  }

  const conditions = resolved.map((group) => groupCondition(db, group, raw, options));
  const combined = conditions.length === 1 ? conditions[0] : or(...conditions);

  return combined ?? sql`1 = 1`;
}
