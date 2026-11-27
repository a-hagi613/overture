import { and, count, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { targets } from "../platform/db/schema.ts";
import { postings } from "../platform/db/catalog-schema.ts";
import { resolveLocation } from "../catalog/geo.ts";
import { resolvedLocationCondition } from "../catalog/location-filter.ts";
import { locationTextsOfPlaceIds } from "../places/catalog.ts";
import { catalogRevision } from "../catalog/revision.ts";
import { optionalFieldConditions } from "../matching/optional-fields.ts";
import { planRoleTargets, roleTargetCondition } from "../matching/role-targets.ts";
import { emptyTargets, targetsInputSchema } from "../../shared/targets.ts";
import { promotePlaceValues } from "../places/resolve.ts";

const storedSchema = z.object({
  roles: z.string(),
  seniorities: z.string(),
  workplaces: z.string(),
  locations: z.string(),
  unresolvedLocations: z.string(),
  employmentTypes: z.string(),
  salaryFloorMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.enum(["year", "month", "hour"]),
  version: z.number(),
});

const MATCH_COUNT_CACHE_MAX = 512;

interface LocationFilter {
  key: string;
  condition: SQL;
}

interface MatchFilters {
  roles: string[];
  seniorities: string[];
  workplaces: (typeof postings.$inferSelect)["workplace"][];
  employmentTypes: (typeof postings.$inferSelect)["employmentType"][];
  locations: LocationFilter[];
  salaryFloorMinor: number | null;
  salaryCurrency: string | null;
  languages: string[];
}

interface MatchCountCache {
  revision: string;
  entries: Map<string, number>;
}

const matchCountCaches = new WeakMap<CatalogDatabase, MatchCountCache>();

function stringArrayFromColumn(value: string) {
  const parsed: unknown = JSON.parse(value);

  return z.array(z.string()).parse(parsed);
}

function sortedUnique<T extends string>(values: readonly T[]) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function locationFilter(db: CatalogDatabase, raw: string) {
  const resolved = resolveLocation(raw);
  const condition = resolvedLocationCondition(db, raw);

  if (resolved.countryCode === null) {
    return { condition, key: `raw:${raw.toLowerCase()}` } satisfies LocationFilter;
  }

  if (resolved.city !== null) {
    return {
      condition,
      key: `city:${resolved.countryCode}:${resolved.city.toLowerCase()}`,
    } satisfies LocationFilter;
  }

  if (resolved.region !== null) {
    return {
      condition,
      key: `region:${resolved.countryCode}:${resolved.region.toLowerCase()}`,
    } satisfies LocationFilter;
  }

  return { condition, key: `country:${resolved.countryCode}` } satisfies LocationFilter;
}

function normalizeFilters(
  db: CatalogDatabase,
  parsed: z.infer<typeof targetsInputSchema>,
  languages: readonly string[],
) {
  const locations = new Map<string, SQL>();

  for (const location of locationTextsOfPlaceIds(parsed.locations)) {
    const filter = locationFilter(db, location);

    if (!locations.has(filter.key)) {
      locations.set(filter.key, filter.condition);
    }
  }

  return {
    roles: sortedUnique(parsed.roles.map((role) => role.trim())),
    seniorities: sortedUnique(parsed.seniorities),
    workplaces: sortedUnique(parsed.workplaces),
    employmentTypes: sortedUnique(parsed.employmentTypes),
    locations: [...locations.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, condition]) => ({ condition, key })),
    salaryFloorMinor: parsed.salaryFloorMinor,
    salaryCurrency: parsed.salaryCurrency,
    languages: sortedUnique(languages.map((language) => language.trim().toLowerCase())),
  } satisfies MatchFilters;
}

function cacheKeyOf(filters: MatchFilters) {
  return JSON.stringify([
    filters.roles.map((role) => role.toLowerCase()),
    filters.seniorities,
    filters.workplaces,
    filters.employmentTypes,
    filters.locations.map((location) => location.key),
    filters.salaryFloorMinor,
    filters.salaryCurrency,
    filters.languages,
  ]);
}

function salaryCondition(floorMinor: number | null, currency: string | null) {
  if (floorMinor === null || currency === null) {
    return null;
  }

  return or(
    isNull(postings.salaryMinMinor),
    isNull(postings.salaryCurrency),
    sql`lower(${postings.salaryCurrency}) <> ${currency.toLowerCase()}`,
    gte(postings.salaryMinMinor, floorMinor),
  );
}

function countMatches(db: CatalogDatabase, filters: MatchFilters) {
  const roleCondition = roleTargetCondition(planRoleTargets(filters.roles));

  if (roleCondition === null) {
    return 0;
  }

  const conditions: (SQL | null | undefined)[] = [
    isNull(postings.closedAt),
    eq(postings.status, "open"),
    eq(postings.applySupported, true),
    ...optionalFieldConditions(db, filters),
    roleCondition,
    or(...filters.locations.map((location) => location.condition)),
    salaryCondition(filters.salaryFloorMinor, filters.salaryCurrency),
  ];

  const usable = conditions.filter((condition) => condition !== undefined && condition !== null);

  const rows = db
    .select({ total: count() })
    .from(postings)
    .where(and(...usable))
    .all();

  return rows.at(0)?.total ?? 0;
}

/**
 * Counts the open Postings a candidate's Targets match, caching per catalog handle.
 *
 * The cache key is the normalized filters (roles reduced to their meaningful words, arrays sorted and deduplicated,
 * locations reduced to the geo tuple they resolve to, languages lowercased) plus the catalog revision: `PRAGMA
 * data_version` moves when another connection — the sweep worker — commits, and `total_changes()` moves when this
 * connection writes, so either kind of catalog change invalidates every entry. The store is a 512-entry LRU, so
 * memory is capped, and the call is synchronous: two requests can never interleave inside one count, so the second
 * of a burst reads the entry the first stored rather than starting another scan.
 * @param db The catalog database.
 * @param input The candidate's Targets.
 * @param languages The profile's posting languages.
 * @returns How many open Postings pass the catalog filters, or 0 when a filter is empty.
 */
export function countMatchingPostings(
  db: CatalogDatabase,
  input: z.input<typeof targetsInputSchema>,
  languages: readonly string[],
) {
  const parsed = targetsInputSchema.parse(input);

  if (
    parsed.roles.length === 0 ||
    parsed.seniorities.length === 0 ||
    parsed.workplaces.length === 0 ||
    parsed.locations.length === 0 ||
    parsed.employmentTypes.length === 0 ||
    languages.length === 0 ||
    (parsed.salaryFloorMinor !== null && parsed.salaryCurrency === null)
  ) {
    return 0;
  }

  const filters = normalizeFilters(db, parsed, languages);
  const revision = catalogRevision(db);

  if (revision === null) {
    return countMatches(db, filters);
  }

  let cache = matchCountCaches.get(db);

  if (cache === undefined || cache.revision !== revision) {
    cache = { entries: new Map(), revision };
    matchCountCaches.set(db, cache);
  }

  const key = cacheKeyOf(filters);
  const cached = cache.entries.get(key);

  if (cached !== undefined) {
    cache.entries.delete(key);
    cache.entries.set(key, cached);

    return cached;
  }

  const value = countMatches(db, filters);

  cache.entries.set(key, value);

  if (cache.entries.size > MATCH_COUNT_CACHE_MAX) {
    const oldest = cache.entries.keys().next().value;

    if (oldest !== undefined) {
      cache.entries.delete(oldest);
    }
  }

  return value;
}

export function createTargetsService(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  async function read(userId: string) {
    const rows = await db.select().from(targets).where(eq(targets.userId, userId)).limit(1);
    const row = rows.at(0);

    if (row === undefined) {
      return { targets: emptyTargets, version: 0 };
    }

    const stored = storedSchema.parse(row);

    const places = promotePlaceValues([
      ...stringArrayFromColumn(stored.locations),
      ...stringArrayFromColumn(stored.unresolvedLocations),
    ]);

    return {
      targets: targetsInputSchema.parse({
        roles: stringArrayFromColumn(stored.roles),
        seniorities: stringArrayFromColumn(stored.seniorities),
        workplaces: stringArrayFromColumn(stored.workplaces),
        locations: places.ids,
        unresolvedLocations: places.unresolved,
        employmentTypes: stringArrayFromColumn(stored.employmentTypes),
        salaryFloorMinor: stored.salaryFloorMinor,
        salaryCurrency: stored.salaryCurrency,
        salaryPeriod: stored.salaryPeriod,
      }),
      version: stored.version,
    };
  }

  async function save(userId: string, input: z.input<typeof targetsInputSchema>) {
    const parsed = targetsInputSchema.parse(input);
    const current = await read(userId);
    const version = current.version + 1;

    await db
      .insert(targets)
      .values({
        userId,
        roles: JSON.stringify(parsed.roles),
        seniorities: JSON.stringify(parsed.seniorities),
        workplaces: JSON.stringify(parsed.workplaces),
        locations: JSON.stringify(parsed.locations),
        unresolvedLocations: JSON.stringify(parsed.unresolvedLocations),
        employmentTypes: JSON.stringify(parsed.employmentTypes),
        salaryFloorMinor: parsed.salaryFloorMinor,
        salaryCurrency: parsed.salaryCurrency,
        salaryPeriod: parsed.salaryPeriod,
        version,
        updatedAt: new Date(clock.now()),
      })
      .onConflictDoUpdate({
        target: targets.userId,
        set: {
          roles: JSON.stringify(parsed.roles),
          seniorities: JSON.stringify(parsed.seniorities),
          workplaces: JSON.stringify(parsed.workplaces),
          locations: JSON.stringify(parsed.locations),
          unresolvedLocations: JSON.stringify(parsed.unresolvedLocations),
          employmentTypes: JSON.stringify(parsed.employmentTypes),
          salaryFloorMinor: parsed.salaryFloorMinor,
          salaryCurrency: parsed.salaryCurrency,
          salaryPeriod: parsed.salaryPeriod,
          version,
          updatedAt: new Date(clock.now()),
        },
      });

    return { targets: parsed, version };
  }

  return { read, save };
}
