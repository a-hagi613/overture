import { and, count, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";
import type { SupplyTotals } from "./supply-facets.ts";

import { postings, postingTags } from "../platform/db/catalog-schema.ts";
import { resolvedLocationCondition } from "./location-filter.ts";
import { catalogRevision } from "./revision.ts";
import { supplyFacetTotals } from "./supply-facets.ts";

export type { SupplyTotals } from "./supply-facets.ts";

interface SupplyCache {
  revision: string;
  entries: Map<string, SupplyTotals>;
}

const CACHE_MAX = 256;

const caches = new WeakMap<CatalogDatabase, SupplyCache>();

function cacheKeyOf(filters: SupplyFilters) {
  return JSON.stringify([
    filters.role,
    filters.granularRole,
    filters.location?.toLowerCase() ?? null,
    filters.radiusKm,
    filters.remote,
  ]);
}

function roleCondition(db: CatalogDatabase, value: string) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(postingTags)
      .where(
        and(
          eq(postingTags.postingId, postings.id),
          inArray(postingTags.dimension, ["role", "subrole", "granular_role"]),
          eq(postingTags.value, value),
        ),
      ),
  );
}

function filtersCondition(db: CatalogDatabase, filters: SupplyFilters) {
  const conditions: SQL[] = [
    isNull(postings.closedAt),
    eq(postings.status, "open"),
    eq(postings.applySupported, true),
  ];

  const roleValue = filters.granularRole ?? filters.role;

  if (roleValue !== null) {
    conditions.push(roleCondition(db, roleValue));
  }

  if (filters.location !== null) {
    conditions.push(
      resolvedLocationCondition(db, filters.location, { radiusKm: filters.radiusKm }),
    );
  }

  if (filters.remote) {
    conditions.push(eq(postings.workplace, "remote"));
  }

  return and(...conditions);
}

function countByAts(db: CatalogDatabase, filters: SupplyFilters) {
  const rows = db
    .select({ ats: postings.ats, total: count() })
    .from(postings)
    .where(filtersCondition(db, filters))
    .groupBy(postings.ats)
    .all()
    .toSorted((left, right) => right.total - left.total || left.ats.localeCompare(right.ats));

  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    byAts: rows.map((row) => ({ ats: row.ats, count: row.total })),
  } satisfies SupplyTotals;
}

/**
 * The live, index-backed count. It is the fallback behind the `supply_facets` rollup for city and raw-text
 * places, and the oracle the rollup's parity tests compare against (issue #631).
 * @param db The catalog database.
 * @param filters The validated public filters.
 * @returns The supported open Posting count, split by the ATS that hosts the board.
 */
export function countSupplyLive(db: CatalogDatabase, filters: SupplyFilters) {
  return countByAts(db, filters);
}

function countSupply(db: CatalogDatabase, filters: SupplyFilters) {
  return supplyFacetTotals(db, filters) ?? countByAts(db, filters);
}

/**
 * Counts the open Postings Overture can apply to for the public landing's supply preview (issue #567):
 * `status = 'open'`, `apply_supported = 1`, and the optional role, location and remote filters. It answers
 * from the precomputed `supply_facets` rollup when the filters are a combination the rollup stores (role,
 * country/region, remote), and falls back to the indexed live query for city or raw-text places (issue
 * #631). Neither path returns a company, title or other per-row field, so the response is public aggregate
 * data only.
 *
 * Results are cached per catalog handle under `catalogRevision`, exactly as the candidate match count is,
 * so a burst of landing requests reads one scan and the next sweep or import invalidates every entry.
 * @param db The catalog database.
 * @param filters The validated public filters.
 * @returns The supported open Posting count, split by the ATS that hosts the board.
 */
export function countSupportedSupply(db: CatalogDatabase, filters: SupplyFilters) {
  const revision = catalogRevision(db);

  if (revision === null) {
    return countSupply(db, filters);
  }

  let cache = caches.get(db);

  if (cache === undefined || cache.revision !== revision) {
    cache = { entries: new Map(), revision };
    caches.set(db, cache);
  }

  const key = cacheKeyOf(filters);
  const cached = cache.entries.get(key);

  if (cached !== undefined) {
    cache.entries.delete(key);
    cache.entries.set(key, cached);

    return cached;
  }

  const totals = countSupply(db, filters);

  cache.entries.set(key, totals);

  if (cache.entries.size > CACHE_MAX) {
    const oldest = cache.entries.keys().next().value;

    if (oldest !== undefined) {
      cache.entries.delete(oldest);
    }
  }

  return totals;
}
