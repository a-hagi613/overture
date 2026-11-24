import { and, count, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { postings, postingTags } from "../platform/db/catalog-schema.ts";
import { resolvedLocationCondition } from "./location-filter.ts";
import { catalogRevision } from "./revision.ts";

export interface SupplyTotals {
  total: number;
  byAts: { ats: string; count: number }[];
}

interface SupplyCache {
  revision: string;
  entries: Map<string, SupplyTotals>;
}

const CACHE_MAX = 256;

const caches = new WeakMap<CatalogDatabase, SupplyCache>();

function cacheKeyOf(filters: SupplyFilters) {
  return JSON.stringify([filters.role, filters.location?.toLowerCase() ?? null, filters.remote]);
}

function roleCondition(db: CatalogDatabase, role: NonNullable<SupplyFilters["role"]>) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(postingTags)
      .where(
        and(
          eq(postingTags.postingId, postings.id),
          inArray(postingTags.dimension, ["role", "subrole"]),
          eq(postingTags.value, role),
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

  if (filters.role !== null) {
    conditions.push(roleCondition(db, filters.role));
  }

  if (filters.location !== null) {
    conditions.push(resolvedLocationCondition(filters.location));
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
 * Counts the open Postings Overture can apply to for the public landing's supply preview (issue #567):
 * `status = 'open'`, `apply_supported = 1`, and the optional role, location and remote filters. The
 * grouped count reads through `postings_apply_supported_status` and returns no company, title or other
 * per-row field, so the response is public aggregate data only.
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
    return countByAts(db, filters);
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

  const totals = countByAts(db, filters);

  cache.entries.set(key, totals);

  if (cache.entries.size > CACHE_MAX) {
    const oldest = cache.entries.keys().next().value;

    if (oldest !== undefined) {
      cache.entries.delete(oldest);
    }
  }

  return totals;
}
