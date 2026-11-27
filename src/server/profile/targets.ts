import { and, count, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { jobPlaces, jobs, targets } from "../platform/db/schema.ts";
import { isFreehireCategory } from "../../shared/freehire-categories.ts";
import { nonJobTitleCondition } from "../jobs/non-job.ts";
import { emptyTargets, targetsInputSchema } from "../../shared/targets.ts";
import { promotePlaceValues } from "../places/resolve.ts";

const storedSchema = z.object({
  roles: z.string(),
  unresolvedRoles: z.string(),
  locations: z.string(),
  unresolvedLocations: z.string(),
  version: z.number(),
});

const MATCH_COUNT_CACHE_MAX = 512;

interface MatchFilters {
  categories: string[];
  titleWords: string[];
  placeIds: string[];
}

interface MatchCountCache {
  revision: string;
  entries: Map<string, number>;
}

const matchCountCaches = new WeakMap<AppDatabase, MatchCountCache>();

function stringArrayFromColumn(value: string) {
  return z.array(z.string()).parse(JSON.parse(value));
}

function sortedUnique<T extends string>(values: readonly T[]) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function normalizeFilters(parsed: z.infer<typeof targetsInputSchema>) {
  const roles = sortedUnique(parsed.roles.map((role) => role.trim()).filter(Boolean));

  return {
    categories: roles.filter((role) => isFreehireCategory(role)),
    placeIds: sortedUnique(parsed.locations),
    titleWords: roles.filter((role) => !isFreehireCategory(role)),
  } satisfies MatchFilters;
}

function roleCondition(filters: MatchFilters) {
  const parts: SQL[] = [];

  if (filters.categories.length > 0) {
    parts.push(inArray(jobs.category, filters.categories));
  }

  for (const word of filters.titleWords) {
    parts.push(sql`instr(${jobs.titleNorm}, ${word.toLowerCase()}) > 0`);
  }

  return parts.length === 0 ? null : or(...parts);
}

function countMatches(db: AppDatabase, filters: MatchFilters, languages: readonly string[]) {
  const role = roleCondition(filters);

  if (role === null || filters.placeIds.length === 0) {
    return 0;
  }

  const language =
    languages.length === 0
      ? undefined
      : or(
          isNull(jobs.language),
          eq(jobs.language, ""),
          inArray(
            sql`lower(${jobs.language})`,
            languages.map((languageValue) => languageValue.toLowerCase()),
          ),
        );

  const rows = db
    .select({ total: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "open"),
        nonJobTitleCondition(jobs.titleNorm),
        language,
        role,
        exists(
          db
            .select({ one: jobPlaces.placeId })
            .from(jobPlaces)
            .where(and(eq(jobPlaces.jobId, jobs.id), inArray(jobPlaces.placeId, filters.placeIds))),
        ),
      ),
    )
    .all();

  return rows.at(0)?.total ?? 0;
}

function cacheKeyOf(filters: MatchFilters, languages: readonly string[]) {
  return JSON.stringify([
    filters.categories,
    filters.titleWords,
    filters.placeIds,
    languages.map((language) => language.toLowerCase()).toSorted(),
  ]);
}

function databaseRevision(db: AppDatabase) {
  const client = db.$client;

  const dataVersion = client
    .query<{ data_version: number }, []>("PRAGMA data_version")
    .get()?.data_version;

  const totalChanges = client
    .query<{ total: number }, []>("SELECT total_changes() AS total")
    .get()?.total;

  if (dataVersion === undefined || totalChanges === undefined) {
    return null;
  }

  return `${String(dataVersion)}:${String(totalChanges)}`;
}

/**
 * Counts the open jobs a candidate's preferences match. Role and location are the only hard filters (issue #684):
 * a job passes when its freehire category is picked or its title contains a picked title word, and one of its place
 * ids is picked. Non-jobs are never counted, and a job in a language the candidate does not read is not counted.
 * The store keeps only jobs with an apply adapter, so every open row is apply-supported.
 *
 * The cache key is the normalized filters plus a cheap database revision (`PRAGMA data_version` plus
 * `total_changes()`), so any write to the job tables invalidates every entry. The store is a 512-entry LRU.
 * @param db The application database.
 * @param input The candidate's preferences.
 * @param languages The languages the candidate reads; empty keeps the language gate open.
 * @returns How many open jobs pass the filters, or 0 when a required filter is empty.
 */
export function countMatchingJobs(
  db: AppDatabase,
  input: z.input<typeof targetsInputSchema>,
  languages: readonly string[] = [],
) {
  const parsed = targetsInputSchema.parse(input);
  const filters = normalizeFilters(parsed);

  if (filters.categories.length === 0 && filters.titleWords.length === 0) {
    return 0;
  }

  if (filters.placeIds.length === 0) {
    return 0;
  }

  const revision = databaseRevision(db);

  if (revision === null) {
    return countMatches(db, filters, languages);
  }

  let cache = matchCountCaches.get(db);

  if (cache === undefined || cache.revision !== revision) {
    cache = { entries: new Map(), revision };
    matchCountCaches.set(db, cache);
  }

  const key = cacheKeyOf(filters, languages);
  const cached = cache.entries.get(key);

  if (cached !== undefined) {
    cache.entries.delete(key);
    cache.entries.set(key, cached);

    return cached;
  }

  const value = countMatches(db, filters, languages);

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
        unresolvedRoles: stringArrayFromColumn(stored.unresolvedRoles),
        locations: places.ids,
        unresolvedLocations: places.unresolved,
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
        unresolvedRoles: JSON.stringify(parsed.unresolvedRoles),
        locations: JSON.stringify(parsed.locations),
        unresolvedLocations: JSON.stringify(parsed.unresolvedLocations),
        version,
        updatedAt: new Date(clock.now()),
      })
      .onConflictDoUpdate({
        target: targets.userId,
        set: {
          roles: JSON.stringify(parsed.roles),
          unresolvedRoles: JSON.stringify(parsed.unresolvedRoles),
          locations: JSON.stringify(parsed.locations),
          unresolvedLocations: JSON.stringify(parsed.unresolvedLocations),
          version,
          updatedAt: new Date(clock.now()),
        },
      });

    return { targets: parsed, version };
  }

  return { read, save };
}
