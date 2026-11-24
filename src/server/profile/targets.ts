import { and, count, eq, exists, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { targets } from "../platform/db/schema.ts";
import { postings, postingTags } from "../platform/db/catalog-schema.ts";
import { normalizeTitle } from "../catalog/normalize.ts";
import { resolveLocation } from "../catalog/geo.ts";
import { resolvedLocationCondition } from "../catalog/location-filter.ts";
import { catalogRevision } from "../catalog/revision.ts";
import { ESCO_ROLE_NAMES } from "../../shared/esco-roles.ts";
import { ROLE_GROUPS } from "../../shared/tag-taxonomy.ts";
import { emptyTargets, targetsInputSchema } from "../../shared/targets.ts";

const roleTagSchema = z.object({ value: z.string() });

const storedSchema = z.object({
  roles: z.string(),
  seniorities: z.string(),
  workplaces: z.string(),
  locations: z.string(),
  employmentTypes: z.string(),
  salaryFloorMinor: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  salaryPeriod: z.enum(["year", "month", "hour"]),
  version: z.number(),
});

const STOP_WORDS = new Set(["and", "or", "the", "of", "at", "in", "on", "for", "to", "a", "an"]);

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

function wordsOf(value: string) {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

const KNOWN_LABELS = new Set(
  [...ROLE_GROUPS, ...ESCO_ROLE_NAMES].map((label) => label.toLowerCase()),
);

/**
 * Whether one target role names one of a Posting's role tags. A target that is a known Level-1 category or Level-2
 * ESCO role must match that exact label, case-insensitively, so `Software Engineering` never picks up
 * `Civil Engineering` (WS-17b). A free-text target keeps the original word-overlap behaviour.
 * @param target The target role.
 * @param tagValues The Posting's role tags.
 * @returns True when the target names one of them.
 */
export function roleTargetMatches(target: string, tagValues: readonly string[]) {
  const normalized = target.trim().toLowerCase();

  if (KNOWN_LABELS.has(normalized)) {
    return tagValues.some((tag) => tag.trim().toLowerCase() === normalized);
  }

  const targetWords = new Set(wordsOf(target));

  return tagValues.some((tag) => wordsOf(tag).some((word) => targetWords.has(word)));
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

  for (const location of parsed.locations) {
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

/**
 * The role tags a candidate's target roles match. A target that is a known Level-1 category or a known Level-2
 * ESCO role must match that exact label (WS-17b), so choosing `Software Engineering` never picks up every posting
 * whose granular role merely shares a word. A free-text target keeps the original word-overlap behaviour.
 * @param db The catalog database.
 * @param roles The candidate's target roles, as typed or picked.
 * @returns The tag values that should be searched.
 */
export function matchedRoleTags(db: CatalogDatabase, roles: readonly string[]) {
  if (roles.length === 0) {
    return [];
  }

  const tagRows = db
    .selectDistinct({ value: postingTags.value })
    .from(postingTags)
    .where(inArray(postingTags.dimension, ["role", "subrole", "granular_role"]))
    .all();

  const values = tagRows.map((row) => roleTagSchema.parse(row).value);
  const wanted = new Set(roles.map((role) => role.toLowerCase()));
  const exact = values.filter((value) => wanted.has(value.toLowerCase()));

  const freeTextWords = new Set(
    roles.filter((role) => !KNOWN_LABELS.has(role.toLowerCase())).flatMap((role) => wordsOf(role)),
  );

  if (freeTextWords.size === 0) {
    return [...new Set(exact)];
  }

  const fuzzy = values.filter(
    (value) => !exact.includes(value) && wordsOf(value).some((word) => freeTextWords.has(word)),
  );

  return [...new Set([...exact, ...fuzzy])];
}

function countMatches(db: CatalogDatabase, filters: MatchFilters) {
  const roleTags = matchedRoleTags(db, filters.roles);

  if (roleTags.length === 0) {
    return 0;
  }

  const conditions: (SQL | null | undefined)[] = [
    isNull(postings.closedAt),
    eq(postings.status, "open"),
    eq(postings.applySupported, true),
    inArray(postings.workplace, filters.workplaces),
    inArray(postings.employmentType, filters.employmentTypes),
    inArray(sql`lower(${postings.language})`, filters.languages),
    exists(
      db
        .select({ one: sql`1` })
        .from(postingTags)
        .where(
          and(
            eq(postingTags.postingId, postings.id),
            inArray(postingTags.dimension, ["role", "subrole", "granular_role"]),
            inArray(postingTags.value, roleTags),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(postingTags)
        .where(
          and(
            eq(postingTags.postingId, postings.id),
            eq(postingTags.dimension, "seniority"),
            inArray(postingTags.value, filters.seniorities),
          ),
        ),
    ),
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

    return {
      targets: targetsInputSchema.parse({
        roles: stringArrayFromColumn(stored.roles),
        seniorities: stringArrayFromColumn(stored.seniorities),
        workplaces: stringArrayFromColumn(stored.workplaces),
        locations: stringArrayFromColumn(stored.locations),
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
