import { and, count, eq, exists, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { APPLY_SUPPORTED_ATS } from "../../shared/ats.ts";
import { isFreehireCategory } from "../../shared/freehire-categories.ts";
import { normalizeJobTitle } from "../../shared/non-job.ts";
import { cityPlaceId, parsePlaceId, placeSlug } from "../../shared/places.ts";
import { ROLE_CATEGORIES, ROLE_SUBCATEGORIES, ROLES } from "../../shared/role-taxonomy.ts";
import { geoCities, haversineKm } from "../catalog/geo.ts";
import { legacyTargetToTaxonomy } from "../catalog/legacy-roles.ts";
import { jobPlaces, jobs } from "../platform/db/schema.ts";
import { resolvePlaceText } from "../places/resolve.ts";
import { freehireCategoryForLegacyRole } from "../profile/role-migration.ts";
import { nonJobTitleCondition } from "./non-job.ts";

/** The public count and its split by ATS, shared by the route and the job tables it reads (issues #567, #742). */
export interface SupplyTotals {
  total: number;
  byAts: { ats: string; count: number }[];
}

const CACHE_MAX = 256;
const CACHE_TTL_MS = 30_000;

const categoryFamilies = new Map<string, readonly string[]>();

const ROLE_STOP_WORDS = new Set([
  "and",
  "or",
  "the",
  "of",
  "at",
  "in",
  "on",
  "for",
  "to",
  "a",
  "an",
]);

interface CachedTotals {
  at: number;
  totals: SupplyTotals;
}

interface CityPoint {
  countryCode: string;
  lat: number;
  lon: number;
  name: string;
}

const caches = new WeakMap<AppDatabase, Map<string, CachedTotals>>();

let cityPoints: readonly CityPoint[] | null = null;

function cityPointsList() {
  cityPoints ??= geoCities();

  return cityPoints;
}

function cacheKeyOf(filters: SupplyFilters) {
  return JSON.stringify([
    filters.role,
    filters.granularRole,
    filters.location?.toLowerCase() ?? null,
    filters.radiusKm,
    filters.remote,
  ]);
}

function familyOfCategory(categoryId: string) {
  const cached = categoryFamilies.get(categoryId);

  if (cached !== undefined) {
    return cached;
  }

  const ids = new Set<string>();

  for (const subcategory of ROLE_SUBCATEGORIES) {
    if (subcategory.categoryId !== categoryId) {
      continue;
    }

    const mapped = freehireCategoryForLegacyRole(subcategory.id);

    if (mapped !== null) {
      ids.add(mapped);
    }
  }

  for (const role of ROLES) {
    if (role.categoryId !== categoryId) {
      continue;
    }

    const mapped = freehireCategoryForLegacyRole(role.id);

    if (mapped !== null) {
      ids.add(mapped);
    }
  }

  const family = [...ids].toSorted();

  categoryFamilies.set(categoryId, family);

  return family;
}

function taxonomyCategoryOf(value: string) {
  const direct = ROLE_CATEGORIES.find(
    (category) => category.id === value || category.name === value,
  );

  if (direct !== undefined) {
    return direct.id;
  }

  const ids = legacyTargetToTaxonomy(value);
  const [only] = ids;

  if (only === undefined || ids.length !== 1) {
    return null;
  }

  return ROLE_CATEGORIES.some((category) => category.id === only) ? only : null;
}

function roleCondition(value: string | null) {
  if (value === null) {
    return null;
  }

  if (isFreehireCategory(value)) {
    return eq(jobs.category, value);
  }

  const categoryId = taxonomyCategoryOf(value);

  if (categoryId !== null) {
    const family = familyOfCategory(categoryId);

    if (family.length === 1 && family[0] !== undefined) {
      return eq(jobs.category, family[0]);
    }

    if (family.length > 1) {
      return inArray(jobs.category, family);
    }
  }

  const category = freehireCategoryForLegacyRole(value);

  if (category !== null) {
    return eq(jobs.category, category);
  }

  const words = normalizeJobTitle(value)
    .split(" ")
    .filter((word) => word.length > 1 && !ROLE_STOP_WORDS.has(word));

  if (words.length === 0) {
    return sql`0 = 1`;
  }

  const clauses = words.map(
    (word) => sql`instr(' ' || ${jobs.titleNorm} || ' ', ${` ${word} `}) > 0`,
  );

  return and(...clauses) ?? sql`0 = 1`;
}

function withRadius(placeIds: readonly string[], radiusKm: number | null) {
  if (radiusKm === null) {
    return [...placeIds];
  }

  const all = cityPointsList();

  const centres = placeIds.flatMap((placeId) => {
    const parsed = parsePlaceId(placeId);

    if (parsed?.kind !== "city" || parsed.countryCode === null || parsed.slug === null) {
      return [];
    }

    const city = all.find(
      (candidate) =>
        candidate.countryCode.toLowerCase() === parsed.countryCode &&
        placeSlug(candidate.name) === parsed.slug,
    );

    return city === undefined ? [] : [city];
  });

  if (centres.length === 0) {
    return [...placeIds];
  }

  const expanded = new Set(placeIds);

  for (const city of all) {
    const within = centres.some((centre) => haversineKm(centre, city) <= radiusKm);

    if (within) {
      expanded.add(cityPlaceId(city.countryCode, city.name));
    }
  }

  return [...expanded];
}

function locationCondition(db: AppDatabase, raw: string, radiusKm: number | null) {
  const { ids } = resolvePlaceText(raw);
  const placeIds = withRadius(ids, radiusKm);

  if (placeIds.length > 0) {
    return exists(
      db
        .select({ one: jobPlaces.placeId })
        .from(jobPlaces)
        .where(and(eq(jobPlaces.jobId, jobs.id), inArray(jobPlaces.placeId, placeIds))),
    );
  }

  const needle = raw.trim().toLowerCase();

  if (needle === "") {
    return null;
  }

  return sql`instr(lower(coalesce(${jobs.locationRaw}, '')), ${needle}) > 0`;
}

function filtersCondition(db: AppDatabase, filters: SupplyFilters) {
  const conditions: SQL[] = [
    eq(jobs.status, "open"),
    nonJobTitleCondition(jobs.titleNorm),
    inArray(jobs.source, [...APPLY_SUPPORTED_ATS]),
  ];

  const role = roleCondition(filters.granularRole ?? filters.role);

  if (role !== null) {
    conditions.push(role);
  }

  if (filters.location !== null) {
    const location = locationCondition(db, filters.location, filters.radiusKm);

    if (location !== null) {
      conditions.push(location);
    }
  }

  if (filters.remote) {
    conditions.push(eq(jobs.workMode, "remote"));
  }

  return and(...conditions) ?? sql`1 = 1`;
}

function countByAts(db: AppDatabase, filters: SupplyFilters) {
  const rows = db
    .select({ ats: jobs.source, total: count() })
    .from(jobs)
    .where(filtersCondition(db, filters))
    .groupBy(jobs.source)
    .all()
    .toSorted((left, right) => right.total - left.total || left.ats.localeCompare(right.ats));

  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    byAts: rows.map((row) => ({ ats: row.ats, count: row.total })),
  } satisfies SupplyTotals;
}

/**
 * Counts the open, apply-supported freehire jobs the public landing preview describes (issues #567, #742): open
 * `jobs` in `app.sqlite`, a supported ATS, the same non-job exclusion the reader and the matching pool apply, an
 * optional freehire category (or retired label), a canonical `job_places` place with an optional city radius, and
 * `work_mode = 'remote'`. A freehire category id is used as given; a retired taxonomy category id or name (and a
 * retired role-group label) expands to the whole family of freehire categories under it, a granular role maps to the
 * single freehire category the target migration gives it, and a label that names none falls back to its title words
 * like a free-text target. A place the resolver cannot name falls back to the job's own location text; a resolved
 * place never falls back, so the count matches what the Matches page can show.
 *
 * Every new job is written here, so the public count follows the same rows the Matches page can show; the legacy
 * `catalog.sqlite` postings are never read. Neither path returns a company, title or other per-row field, so the
 * response stays public aggregate data. A short per-handle cache keeps a landing burst to one scan; it is keyed by
 * the validated filters and expires after {@link CACHE_TTL_MS}, because ordinary app traffic moves
 * `PRAGMA data_version` far more often than the job rows do.
 * @param db The application database that holds `jobs` and `job_places`.
 * @param filters The validated public filters.
 * @param nowMs The clock reading the cache window uses.
 * @returns The supported open job count, split by the ATS that hosts the board.
 */
export function countSupportedJobs(db: AppDatabase, filters: SupplyFilters, nowMs: number) {
  const key = cacheKeyOf(filters);
  let cache = caches.get(db);

  if (cache === undefined) {
    cache = new Map();
    caches.set(db, cache);
  }

  const cached = cache.get(key);

  if (cached !== undefined && nowMs - cached.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, cached);

    return cached.totals;
  }

  const totals = countByAts(db, filters);

  cache.delete(key);
  cache.set(key, { at: nowMs, totals });

  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;

    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }

  return totals;
}
