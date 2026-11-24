import { sql } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";

import {
  geoContinents,
  geoCountries,
  geoDatasetVersion,
  geoMetros,
  geoRegions,
  geoCities,
  normalizePlaceName,
  postingLocationScopes,
} from "./geo.ts";

/**
 * Seeds `geo_places` (and its city R-Tree) from the committed open-data snapshot. The ETL runs this once
 * per build, and the template/seed scripts run it with a name filter so a fixture carries only the places
 * its postings use.
 * @param db The catalog database.
 * @param options The optional city-name filter; omitted seeds every city.
 * @returns How many places and cities were written.
 */
export function seedGeoPlaces(db: CatalogDatabase, options: { only?: readonly string[] } = {}) {
  const client = db.$client;

  const only =
    options.only === undefined
      ? null
      : new Set(options.only.map((name) => normalizePlaceName(name)));

  const insertPlace = client.prepare(
    `insert into geo_places
      (geoname_id, name, norm_name, alt_names, kind, continent_code, country_code, iso_region_code,
       lat, lon, min_lat, max_lat, min_lon, max_lon, population)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertBox = client.prepare(
    "insert into geo_places_rtree (geoname_id, min_lat, max_lat, min_lon, max_lon) values (?, ?, ?, ?, ?)",
  );

  let places = 0;
  let cities = 0;

  const continentByCountry = new Map(
    geoCountries().map((country) => [country.code, country.continentCode]),
  );

  client.run("BEGIN");

  try {
    client.run("DELETE FROM geo_places_rtree");
    client.run("DELETE FROM geo_places");

    for (const [index, continent] of geoContinents().entries()) {
      insertPlace.run(
        -(index + 1),
        continent.name,
        normalizePlaceName(continent.name),
        continent.aliases.join("|"),
        "continent",
        continent.code,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
      );
      places += 1;
    }

    for (const [index, country] of geoCountries().entries()) {
      insertPlace.run(
        -(1000 + index),
        country.name,
        normalizePlaceName(country.name),
        country.code.toLowerCase(),
        "country",
        country.continentCode,
        country.code,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
      );
      places += 1;
    }

    for (const [index, region] of geoRegions().entries()) {
      insertPlace.run(
        -(10_000 + index),
        region.name,
        normalizePlaceName(region.name),
        null,
        "region",
        region.continentCode,
        region.countryCode,
        region.isoCode,
        null,
        null,
        null,
        null,
        null,
        null,
        0,
      );
      places += 1;
    }

    for (const [index, metro] of geoMetros().entries()) {
      const [minLat, maxLat, minLon, maxLon] = metro.bbox;

      insertPlace.run(
        -(100_000 + index),
        metro.name,
        metro.norm,
        metro.aliases.join("|"),
        "metro",
        metro.continentCode,
        metro.countryCode,
        metro.isoRegionCode,
        (minLat + maxLat) / 2,
        (minLon + maxLon) / 2,
        minLat,
        maxLat,
        minLon,
        maxLon,
        0,
      );
      places += 1;
    }

    for (const city of geoCities()) {
      if (only !== null && !only.has(normalizePlaceName(city.name))) {
        continue;
      }

      insertPlace.run(
        city.geonameId,
        city.name,
        normalizePlaceName(city.name),
        city.altNames,
        "city",
        continentByCountry.get(city.countryCode) ?? null,
        city.countryCode,
        city.isoRegionCode,
        city.lat,
        city.lon,
        city.lat,
        city.lat,
        city.lon,
        city.lon,
        city.population,
      );

      insertBox.run(city.geonameId, city.lat, city.lat, city.lon, city.lon);

      places += 1;
      cities += 1;
    }

    client.run("COMMIT");
  } catch (error) {
    client.run("ROLLBACK");
    throw error;
  }

  return { cities, datasetVersion: geoDatasetVersion(), places };
}

/**
 * Rebuilds every `posting_locations` row for the open postings. The ETL runs it after the delta so an
 * edited location string never leaves a stale scope behind.
 * @param db The catalog database.
 * @param options The optional posting-id filter; omitted replaces every row.
 * @returns How many rows were written.
 */
export function rebuildPostingLocations(
  db: CatalogDatabase,
  options: { onlyPostingIds?: readonly string[] } = {},
) {
  const client = db.$client;

  const insertRow = client.prepare(
    `insert into posting_locations
      (posting_id, continent_code, country_code, region_code, city_geoname_id, scope_kind)
     values (?, ?, ?, ?, ?, ?)`,
  );

  const only = options.onlyPostingIds === undefined ? null : new Set(options.onlyPostingIds);

  const rows = db
    .all<{ id: string; locationRaw: string | null; workplace: string }>(
      sql`select id, location_raw as locationRaw, workplace from postings where closed_at is null`,
    )
    .filter((row) => only === null || only.has(row.id));

  let written = 0;

  client.run("BEGIN");

  try {
    if (only === null) {
      client.run("DELETE FROM posting_locations");
    } else {
      for (const postingId of only) {
        client.run("DELETE FROM posting_locations WHERE posting_id = ?", [postingId]);
      }
    }

    for (const row of rows) {
      for (const scope of postingLocationScopes({
        locationRaw: row.locationRaw,
        workplace: row.workplace,
      })) {
        insertRow.run(
          row.id,
          scope.continentCode,
          scope.countryCode,
          scope.regionCode,
          scope.cityGeonameId,
          scope.scopeKind,
        );
        written += 1;
      }
    }

    client.run("COMMIT");
  } catch (error) {
    client.run("ROLLBACK");
    throw error;
  }

  return written;
}

/**
 * Rebuilds the contentless FTS index from the postings. The migration recreates the virtual table empty,
 * and the triggers keep it current afterwards; a snapshot that predates the migration needs this pass.
 * @param db The catalog database.
 * @returns How many rows were indexed.
 */
export function rebuildPostingsFts(db: CatalogDatabase) {
  const client = db.$client;

  client.run("DELETE FROM postings_fts");
  client.run(
    `insert into postings_fts (rowid, title, company, department, skills_text, esco_synonyms, location_text)
     select p.rowid, p.title, c.name, coalesce(p.department, ''), coalesce(p.skills_json, ''),
       '', coalesce(p.location_raw, '')
     from postings p join companies c on c.id = p.company_id
     where p.closed_at is null`,
  );

  const rows = db.all<{ total: number }>(
    sql`select count(*) as total from postings where closed_at is null`,
  );

  return rows.at(0)?.total ?? 0;
}
