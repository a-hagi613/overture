import { and, count, eq, exists, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { postings, postingTags, targets } from "../platform/db/schema.ts";
import { normalizeTitle } from "../catalog/normalize.ts";
import { resolveLocation } from "../catalog/geo.ts";
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

function stringArrayFromColumn(value: string) {
  const parsed: unknown = JSON.parse(value);

  return z.array(z.string()).parse(parsed);
}

function wordsOf(value: string) {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 0 && !STOP_WORDS.has(word));
}

export function roleTargetMatches(target: string, tagValues: readonly string[]) {
  const targetWords = new Set(wordsOf(target));

  return tagValues.some((tag) => wordsOf(tag).some((word) => targetWords.has(word)));
}

function locationCondition(raw: string) {
  const resolved = resolveLocation(raw);

  if (resolved.countryCode === null) {
    return sql`lower(coalesce(${postings.locationRaw}, '')) like ${`%${raw.toLowerCase()}%`}`;
  }

  if (resolved.city !== null) {
    return and(
      eq(postings.countryCode, resolved.countryCode),
      sql`lower(${postings.city}) = ${resolved.city.toLowerCase()}`,
    );
  }

  if (resolved.region !== null) {
    return and(
      eq(postings.countryCode, resolved.countryCode),
      sql`lower(${postings.region}) = ${resolved.region.toLowerCase()}`,
    );
  }

  return eq(postings.countryCode, resolved.countryCode);
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

export function matchedRoleTags(db: AppDatabase, roles: readonly string[]) {
  const tagRows = db
    .selectDistinct({ value: postingTags.value })
    .from(postingTags)
    .where(inArray(postingTags.dimension, ["role", "subrole"]))
    .all();

  const values = tagRows.map((row) => roleTagSchema.parse(row).value);

  return values.filter((value) => roles.some((role) => roleTargetMatches(role, [value])));
}

export function countMatchingPostings(
  db: AppDatabase,
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

  const roleTags = matchedRoleTags(db, parsed.roles);

  if (roleTags.length === 0) {
    return 0;
  }

  const conditions: (SQL | null | undefined)[] = [
    isNull(postings.closedAt),
    inArray(postings.workplace, parsed.workplaces),
    inArray(postings.employmentType, parsed.employmentTypes),
    inArray(
      sql`lower(${postings.language})`,
      languages.map((language) => language.toLowerCase()),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(postingTags)
        .where(
          and(
            eq(postingTags.postingId, postings.id),
            inArray(postingTags.dimension, ["role", "subrole"]),
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
            inArray(postingTags.value, parsed.seniorities),
          ),
        ),
    ),
    or(...parsed.locations.map((location) => locationCondition(location))),
    salaryCondition(parsed.salaryFloorMinor, parsed.salaryCurrency),
  ];

  const usable = conditions.filter((condition) => condition !== undefined && condition !== null);

  const rows = db
    .select({ total: count() })
    .from(postings)
    .where(and(...usable))
    .all();

  return rows.at(0)?.total ?? 0;
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
