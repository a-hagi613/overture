import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { supplyFacets } from "../platform/db/catalog-schema.ts";
import { resolveLocationQuery } from "./geo.ts";

/**
 * The `role` value of a facet row that counts every open apply-supported Posting once, regardless of its
 * role tags. It is not a valid role group, so it can never collide with a real tag value (issue #631).
 */
export const ANY_ROLE_FACET = "*";

/** The public count and its split by ATS, shared by the live query and the `supply_facets` rollup. */
export interface SupplyTotals {
  total: number;
  byAts: { ats: string; count: number }[];
}

interface FacetLocation {
  countryCode: string;
  regions: string[] | null;
}

/**
 * Rebuilds the `/api/supply` rollup from the open, apply-supported Postings (issue #631). It runs at the
 * end of an ETL/import pass, before the snapshot is sealed and hot-swapped, and is deterministic: the same
 * catalog always produces the same rows.
 *
 * Two passes keep the unfiltered total truthful. The first writes one `*` row per `(ats, country, region,
 * workplace)` with `count(*)`, so a Posting with two role tags is still counted once. The second joins the
 * role and subrole tags and writes one row per distinct `(role value, ats, country, region, workplace)`
 * with `count(distinct posting_id)`, so a Posting tagged both `role: X` and `subrole: X` is counted once.
 * @param db The catalog database.
 */
export function rebuildSupplyFacets(db: CatalogDatabase) {
  db.transaction((tx) => {
    tx.run(sql`delete from ${supplyFacets}`);

    tx.run(sql`
      insert into ${supplyFacets} (role, country_code, region, workplace, ats, postings)
      select ${ANY_ROLE_FACET}, coalesce(p.country_code, ''), coalesce(lower(p.region), ''),
             p.workplace, p.ats, count(*)
        from postings p
       where p.status = 'open' and p.apply_supported = 1 and p.closed_at is null
       group by coalesce(p.country_code, ''), coalesce(lower(p.region), ''), p.workplace, p.ats
    `);

    tx.run(sql`
      insert into ${supplyFacets} (role, country_code, region, workplace, ats, postings)
      select pt.value, coalesce(p.country_code, ''), coalesce(lower(p.region), ''),
             p.workplace, p.ats, count(distinct p.id)
        from postings p
        join posting_tags pt
          on pt.posting_id = p.id and pt.dimension in ('role', 'subrole')
       where p.status = 'open' and p.apply_supported = 1 and p.closed_at is null
       group by pt.value, coalesce(p.country_code, ''), coalesce(lower(p.region), ''), p.workplace, p.ats
    `);
  });
}

/**
 * The catalog's `supply_facets` rollup, if it is present and has at least one row. A legacy or test catalog
 * that was migrated before the rollup existed simply falls through to the live indexed query, and an empty
 * catalog reads zero either way.
 * @param db The catalog database.
 * @returns True when a facet query can answer the request.
 */
export function hasSupplyFacets(db: CatalogDatabase) {
  try {
    return db.$client.query("select 1 from supply_facets limit 1").get() !== null;
  } catch (error) {
    if (error instanceof Error && /no such table: supply_facets/u.test(error.message)) {
      return false;
    }

    throw error;
  }
}

function facetLocation(raw: string | null, radiusKm: number | null) {
  if (raw === null || radiusKm !== null) {
    return null;
  }

  const groups = resolveLocationQuery(raw);

  if (groups.length !== 1) {
    return null;
  }

  const [group] = groups;

  if (group === undefined || group.remote) {
    return null;
  }

  if (group.kind === "country") {
    if (group.countryCodes.length !== 1) {
      return null;
    }

    const [countryCode] = group.countryCodes;

    return countryCode === undefined ? null : { countryCode, regions: null };
  }

  if (group.kind !== "region" || group.regionName === null) {
    return null;
  }

  const [countryCode] = group.countryCodes;

  if (countryCode === undefined) {
    return null;
  }

  const region = group.regionName.toLowerCase();

  const legacy = group.legacyRegionCode?.split(".")[1]?.toLowerCase();

  const iso = group.regionIsoCode?.toLowerCase();

  const regions = [region, legacy, iso].filter(
    (candidate): candidate is string => candidate !== undefined && candidate !== "",
  );

  return { countryCode, regions: [...new Set(regions)] };
}

/**
 * Answers `/api/supply` from the precomputed rollup when the filters are a combination it groups by:
 * role (or the any-role total), one country or region, and remote. A city, metro, remote-scoped or
 * multi-place query, or any radius, returns null so the caller falls back to the indexed live query and
 * its R-Tree (issue #630, #631).
 * @param db The catalog database.
 * @param filters The validated public filters.
 * @returns The totals, or null when the rollup cannot answer or has not been built.
 */
export function supplyFacetTotals(db: CatalogDatabase, filters: SupplyFilters) {
  const location: FacetLocation | null =
    filters.location === null ? null : facetLocation(filters.location, filters.radiusKm);

  if (filters.location !== null && location === null) {
    return null;
  }

  if (!hasSupplyFacets(db)) {
    return null;
  }

  const conditions: SQL[] = [eq(supplyFacets.role, filters.role ?? ANY_ROLE_FACET)];

  if (location !== null) {
    conditions.push(eq(supplyFacets.countryCode, location.countryCode));

    if (location.regions !== null) {
      conditions.push(inArray(supplyFacets.region, location.regions));
    }
  }

  if (filters.remote) {
    conditions.push(eq(supplyFacets.workplace, "remote"));
  }

  const rows = db
    .select({ ats: supplyFacets.ats, total: sql<number>`sum(${supplyFacets.postings})` })
    .from(supplyFacets)
    .where(and(...conditions))
    .groupBy(supplyFacets.ats)
    .all()
    .toSorted((left, right) => right.total - left.total || left.ats.localeCompare(right.ats));

  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    byAts: rows.map((row) => ({ ats: row.ats, count: row.total })),
  };
}
