import { and, eq, exists, inArray, isNull, notExists, or, sql } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";

import { postingTags, postings } from "../platform/db/catalog-schema.ts";
import { SENIORITIES } from "../../shared/tag-taxonomy.ts";

/**
 * A Posting that leaves an optional field blank is still a candidate: most feeds never say the workplace,
 * employment type or seniority, so treating "not stated" as "no" hid about nine in ten Postings from everyone.
 * A stated value that differs from the Targets still filters, and one exception stays strict: someone who wants
 * remote work only never sees a Posting whose workplace is unknown, because it may be on-site.
 */

type Workplace = (typeof postings.$inferSelect)["workplace"];

type EmploymentType = (typeof postings.$inferSelect)["employmentType"];

/**
 * @param wanted The workplaces the Targets allow.
 * @returns Whether an unknown workplace is accepted: only when on-site or hybrid work is.
 */
export function acceptsUnknownWorkplace(wanted: readonly Workplace[]) {
  return wanted.includes("onsite") || wanted.includes("hybrid");
}

/**
 * @param workplace The Posting's workplace.
 * @param wanted The workplaces the Targets allow.
 * @returns Whether the Posting passes the workplace filter.
 */
export function workplaceAccepted(workplace: Workplace, wanted: readonly Workplace[]) {
  return wanted.includes(workplace) || (workplace === "unknown" && acceptsUnknownWorkplace(wanted));
}

/**
 * @param employmentType The Posting's employment type.
 * @param wanted The employment types the Targets allow.
 * @returns Whether the Posting passes the employment-type filter; an unknown type always does.
 */
export function employmentAccepted(
  employmentType: EmploymentType,
  wanted: readonly EmploymentType[],
) {
  return employmentType === "unknown" || wanted.includes(employmentType);
}

/**
 * @param language The Posting's detected language, or null when none was detected.
 * @param wanted The profile's posting languages.
 * @returns Whether the Posting passes the language filter; an undetected language always does.
 */
export function languageAccepted(language: string | null, wanted: readonly string[]) {
  if (language === null || language.trim() === "") {
    return true;
  }

  const folded = language.toLowerCase();

  return wanted.some((candidate) => candidate.toLowerCase() === folded);
}

const SENIORITY_LEVEL = new Map<string, number>([
  ["intern", 0],
  ["entry", 1],
  ["mid", 2],
  ["senior", 3],
  ["staff", 4],
  ["manager", 4],
  ["principal", 5],
  ["director", 5],
]);

/** Levels apart at which a stated seniority blocks a Posting. */
export const SENIORITY_BLOCK_DISTANCE = 3;

/**
 * How far a seniority sits from the nearest wanted one. Managers sit level with staff and directors with
 * principals, so the two career tracks compare.
 * @param value A seniority tag.
 * @param wanted The seniorities the Targets allow.
 * @returns 0 for a wanted seniority, the level gap otherwise, or Infinity when either side has no level.
 */
export function seniorityDistance(value: string, wanted: readonly string[]) {
  if (wanted.includes(value)) {
    return 0;
  }

  const level = SENIORITY_LEVEL.get(value);

  if (level === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    Number.POSITIVE_INFINITY,
    ...wanted.flatMap((target) => {
      const targetLevel = SENIORITY_LEVEL.get(target);

      return targetLevel === undefined ? [] : [Math.abs(targetLevel - level)];
    }),
  );
}

/**
 * @param postingSeniorities The Posting's seniority tags.
 * @param wanted The seniorities the Targets allow.
 * @returns The smallest distance among the Posting's tags, or null when it has none.
 */
export function nearestSeniorityDistance(
  postingSeniorities: readonly string[],
  wanted: readonly string[],
) {
  if (postingSeniorities.length === 0) {
    return null;
  }

  return Math.min(...postingSeniorities.map((value) => seniorityDistance(value, wanted)));
}

/**
 * @param postingSeniorities The Posting's seniority tags.
 * @param wanted The seniorities the Targets allow.
 * @returns Whether the Posting passes the seniority filter: it has no seniority tag, or one fewer than
 * {@link SENIORITY_BLOCK_DISTANCE} levels from a wanted seniority.
 */
export function seniorityAccepted(
  postingSeniorities: readonly string[],
  wanted: readonly string[],
) {
  const distance = nearestSeniorityDistance(postingSeniorities, wanted);

  return distance === null || distance < SENIORITY_BLOCK_DISTANCE;
}

/**
 * The SQL form of the four filters above, for the candidate pool and the onboarding match count.
 * @param db The catalog database.
 * @param filters The Targets' workplaces, employment types and seniorities, and the profile's languages.
 * @returns One condition per filter, to be joined with `and`.
 */
export function optionalFieldConditions(
  db: CatalogDatabase,
  filters: {
    workplaces: readonly Workplace[];
    employmentTypes: readonly EmploymentType[];
    seniorities: readonly string[];
    languages: readonly string[];
  },
) {
  const seniorityTag = (values?: readonly string[]) =>
    db
      .select({ one: sql`1` })
      .from(postingTags)
      .where(
        and(
          eq(postingTags.postingId, postings.id),
          eq(postingTags.dimension, "seniority"),
          values === undefined ? undefined : inArray(postingTags.value, [...values]),
        ),
      );

  const workplaces = acceptsUnknownWorkplace(filters.workplaces)
    ? [...new Set<Workplace>([...filters.workplaces, "unknown"])]
    : [...filters.workplaces];

  return [
    inArray(postings.workplace, workplaces),
    inArray(postings.employmentType, [
      ...new Set<EmploymentType>([...filters.employmentTypes, "unknown"]),
    ]),
    or(
      isNull(postings.language),
      eq(postings.language, ""),
      inArray(
        sql`lower(${postings.language})`,
        filters.languages.map((language) => language.toLowerCase()),
      ),
    ),
    or(
      exists(
        seniorityTag([
          ...new Set([
            ...filters.seniorities,
            ...SENIORITIES.filter(
              (value) => seniorityDistance(value, filters.seniorities) < SENIORITY_BLOCK_DISTANCE,
            ),
          ]),
        ]),
      ),
      notExists(seniorityTag()),
    ),
  ];
}
