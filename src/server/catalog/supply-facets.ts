import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { supplyFacets } from "../platform/db/catalog-schema.ts";
import { resolveLocation } from "./geo.ts";

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

function facetLocation(raw: string | null) {
  if (raw === null) {
    return null;
  }

  const resolved = resolveLocation(raw);

  if (resolved.countryCode === null || resolved.city !== null) {
    return null;
  }

  if (resolved.region === null) {
    return { countryCode: resolved.countryCode, regions: null };
  }

  const region = resolved.region.toLowerCase();
  const legacyRegion = resolved.regionCode?.split(".")[1]?.toLowerCase();

  return {
    countryCode: resolved.countryCode,
    regions:
      legacyRegion === undefined || legacyRegion === region ? [region] : [region, legacyRegion],
  };
}

/**
 * Answers `/api/supply` from the precomputed rollup when the filters are a combination it groups by:
 * role (or the any-role total), country/region and remote. City and raw-text places return null so the
 * caller falls back to the indexed live query (issue #631).
 * @param db The catalog database.
 * @param filters The validated public filters.
 * @returns The totals, or null when the rollup cannot answer or has not been built.
 */
export function supplyFacetTotals(db: CatalogDatabase, filters: SupplyFilters) {
  const location: FacetLocation | null =
    filters.location === null ? null : facetLocation(filters.location);

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
