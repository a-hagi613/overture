import { and, desc, eq, exists, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import { applications, jobPlaces, jobs, skipCompanies } from "../platform/db/schema.ts";
import { getSettingNumber } from "../platform/settings/index.ts";
import { normalizeCompanyName } from "../profile/skip-companies.ts";
import { roleCategoryOf } from "../../shared/role-taxonomy.ts";
import {
  TAXONOMY_TO_FREEHIRE,
  categoriesForRoles,
  placesForLocations,
} from "../jobs/preferences.ts";

const DAY_MS = 86_400_000;
const POOL_QUERY_LIMIT = 5000;
const ID_CHUNK = 400;

const NON_JOB_TITLES = [
  "general application",
  "join our talent",
  "open application",
  "speculative application",
  "talent pipeline",
  "talent pool",
  "test job",
  "placeholder",
] as const;

const FREEHIRE_CATEGORIES = new Set<string>(Object.values(TAXONOMY_TO_FREEHIRE).flat());

export interface JobPoolCriteria {
  categories: readonly string[];
  titleWords: readonly string[];
  /** The categories the user named directly; absent means every category is treated as a direct match. */
  exactCategories?: readonly string[];
  /** The title words the user named directly; absent means every title word is treated as a direct match. */
  exactTitleWords?: readonly string[];
  /** The canonical place ids the user picked, including their remote scopes (issue #683). */
  placeIds: readonly string[];
  /** The user's spoken languages, lower case ISO-639-1. An undetected posting language always passes. */
  languages: readonly string[];
  /** Employer names already excluded by the user or current-employer rule, normalised. */
  excludedEmployers: readonly string[];
  /** Employers the user applied to inside the cooldown window, normalised. */
  cooldownEmployers: readonly string[];
  /** Job ids the user has already applied to. */
  appliedJobIds: readonly string[];
}

export interface PoolJob {
  id: string;
  company: string;
  companySlug: string | null;
  category: string | null;
  title: string;
  titleNorm: string;
  description: string | null;
  descriptionHash: string | null;
  locationRaw: string | null;
  workMode: "remote" | "hybrid" | "onsite" | null;
  postedAt: number | null;
  /** The canonical place ids the posting was published for, including its remote scope. */
  placeIds: readonly string[];
  /** The posting's own language when detection has run; null means undetected and never excludes a job. */
  language: string | null;
}

export interface RankedJob extends PoolJob {
  /** Exact category or title-word match before a category-only match; only decides which jobs are scored first. */
  exactRole: boolean;
}

function normalizeWord(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();
}

function lowerValues(values: readonly string[]) {
  return values.flatMap((value) => {
    const lower = value.trim().toLowerCase();

    return lower === "" ? [] : [lower];
  });
}

function lowerSet(values: readonly string[]) {
  return new Set(lowerValues(values));
}

function lowerList(values: readonly string[]) {
  return lowerValues(values);
}

export function isNonJobTitle(title: string) {
  const normalized = normalizeWord(title);

  return NON_JOB_TITLES.some((phrase) => normalized.includes(phrase));
}

/**
 * A posting's language passes when detection has not run, or when it is one the user speaks.
 * @param postingLanguage The posting's detected language, or null when undetected.
 * @param userLanguages The candidate's spoken languages.
 * @returns True when the job may reach the list.
 */
export function languageAccepted(postingLanguage: string | null, userLanguages: readonly string[]) {
  if (postingLanguage === null || postingLanguage.trim() === "") {
    return true;
  }

  return lowerSet(userLanguages).has(postingLanguage.trim().toLowerCase());
}

function roleCriteria(roles: readonly string[]) {
  const categories = new Set<string>();
  const titleWords = new Set<string>();
  const exactCategories = new Set<string>();
  const exactTitleWords = new Set<string>();

  for (const role of roles) {
    const trimmed = role.trim();

    if (trimmed === "") {
      continue;
    }

    const asCategory = normalizeWord(trimmed).replaceAll(" ", "_");

    if (FREEHIRE_CATEGORIES.has(asCategory)) {
      categories.add(asCategory);
      exactCategories.add(asCategory);

      continue;
    }

    if (roleCategoryOf(trimmed) !== null) {
      for (const category of categoriesForRoles([trimmed])) {
        categories.add(category);
      }

      continue;
    }

    const word = normalizeWord(trimmed);

    if (word !== "") {
      titleWords.add(word);
      exactTitleWords.add(word);
    }
  }

  return {
    categories: [...categories].toSorted(),
    exactCategories,
    exactTitleWords,
    titleWords: [...titleWords].toSorted(),
  };
}

function placeOverlap(job: PoolJob, criteria: JobPoolCriteria) {
  if (criteria.placeIds.length === 0) {
    return true;
  }

  const wanted = lowerSet(criteria.placeIds);

  return job.placeIds.some((placeId) => wanted.has(placeId.toLowerCase()));
}

function exactRoleOf(job: PoolJob, criteria: JobPoolCriteria) {
  const exactCategories = criteria.exactCategories ?? criteria.categories;
  const exactTitleWords = criteria.exactTitleWords ?? criteria.titleWords;

  if (job.category !== null && exactCategories.includes(job.category)) {
    return true;
  }

  return exactTitleWords.some((word) => job.titleNorm.includes(word));
}

function matchesRole(job: PoolJob, criteria: JobPoolCriteria) {
  if (criteria.categories.length === 0 && criteria.titleWords.length === 0) {
    return false;
  }

  if (job.category !== null && criteria.categories.includes(job.category)) {
    return true;
  }

  return criteria.titleWords.some((word) => job.titleNorm.includes(word));
}

/**
 * The whole code pool from ADR 0045, applied to jobs already in the shared freehire table. No AI and no network.
 * @param rows The open jobs to test.
 * @param criteria The user's roles, places, languages and exclusions.
 * @returns The surviving jobs with their exact/category-only flag.
 */
export function filterPoolJobs(rows: readonly PoolJob[], criteria: JobPoolCriteria) {
  const excluded = lowerSet(criteria.excludedEmployers);
  const cooldown = lowerSet(criteria.cooldownEmployers);
  const applied = new Set(criteria.appliedJobIds);

  const kept: RankedJob[] = [];

  for (const job of rows) {
    if (applied.has(job.id) || isNonJobTitle(job.title)) {
      continue;
    }

    if (excluded.has(normalizeCompanyName(job.company))) {
      continue;
    }

    if (cooldown.has(normalizeCompanyName(job.company))) {
      continue;
    }

    if (!languageAccepted(job.language, criteria.languages)) {
      continue;
    }

    if (!matchesRole(job, criteria) || !placeOverlap(job, criteria)) {
      continue;
    }

    kept.push({ ...job, exactRole: exactRoleOf(job, criteria) });
  }

  return kept.toSorted((left, right) => {
    if (left.exactRole !== right.exactRole) {
      return left.exactRole ? -1 : 1;
    }

    const posted = (right.postedAt ?? 0) - (left.postedAt ?? 0);

    return posted === 0 ? left.id.localeCompare(right.id) : posted;
  });
}

export function criteriaFor(input: {
  targets: TargetsInput;
  languages: readonly string[];
  excludedEmployers: readonly string[];
  cooldownEmployers: readonly string[];
  appliedJobIds: readonly string[];
}) {
  const roles = roleCriteria(input.targets.roles);
  const places = placesForLocations(input.targets.locations);

  return {
    appliedJobIds: [...new Set(input.appliedJobIds)],
    categories: roles.categories,
    cooldownEmployers: [...new Set(input.cooldownEmployers)],
    exactCategories: [...roles.exactCategories].toSorted(),
    exactTitleWords: [...roles.exactTitleWords].toSorted(),
    excludedEmployers: [...new Set(input.excludedEmployers)],
    languages: lowerList(input.languages),
    placeIds: places.placeIds,
    titleWords: roles.titleWords,
  } satisfies JobPoolCriteria;
}

interface JobsPoolDeps {
  db: AppDatabase;
  clock: Clock;
}

/**
 * Reads the user's clean job pool from `jobs`/`job_places` and applies the role, place, language and exclusion rules.
 * The database query is only a prefilter; `filterPoolJobs` is the single definition the tests exercise.
 * @param deps The app database and clock.
 * @returns The reader used by scoring and the Matches page.
 */
export function createJobsPool(deps: JobsPoolDeps) {
  const { db, clock } = deps;

  function placesFor(jobIds: readonly string[]) {
    const byJob = new Map<string, string[]>();

    for (const id of jobIds) {
      byJob.set(id, []);
    }

    for (let start = 0; start < jobIds.length; start += ID_CHUNK) {
      const chunk = jobIds.slice(start, start + ID_CHUNK);

      for (const row of db
        .select({ jobId: jobPlaces.jobId, placeId: jobPlaces.placeId })
        .from(jobPlaces)
        .where(inArray(jobPlaces.jobId, chunk))
        .all()) {
        byJob.get(row.jobId)?.push(row.placeId);
      }
    }

    return byJob;
  }

  function excludedEmployersFor(userId: string) {
    return db
      .select({ name: skipCompanies.name })
      .from(skipCompanies)
      .where(eq(skipCompanies.userId, userId))
      .all()
      .map((row) => row.name);
  }

  function appliedJobIdsFor(userId: string) {
    return db
      .select({ postingId: applications.postingId })
      .from(applications)
      .where(eq(applications.userId, userId))
      .all()
      .map((row) => row.postingId);
  }

  function cooldownEmployersFor(userId: string) {
    const days = getSettingNumber(db, "limits.company_cooldown_days");
    const since = clock.now() - days * DAY_MS;

    return db
      .select({ company: applications.companyNameNorm })
      .from(applications)
      .where(
        and(
          eq(applications.userId, userId),
          isNotNull(applications.sentAt),
          gte(applications.sentAt, since),
        ),
      )
      .all()
      .map((row) => row.company);
  }

  function read(userId: string, targets: TargetsInput, languages: readonly string[]) {
    const criteria = criteriaFor({
      appliedJobIds: appliedJobIdsFor(userId),
      cooldownEmployers: cooldownEmployersFor(userId),
      excludedEmployers: excludedEmployersFor(userId),
      languages,
      targets,
    });

    if (criteria.categories.length === 0 && criteria.titleWords.length === 0) {
      const ranked: RankedJob[] = [];

      return { criteria, jobs: ranked };
    }

    const roleConditions = [
      criteria.categories.length === 0
        ? undefined
        : inArray(jobs.category, [...criteria.categories]),
      ...criteria.titleWords.map((word) => sql`${jobs.titleNorm} like ${`%${word}%`}`),
    ].filter((condition) => condition !== undefined);

    const conditions = [
      eq(jobs.status, "open"),
      roleConditions.length === 0 ? sql`0` : or(...roleConditions),
    ];

    if (criteria.placeIds.length > 0) {
      conditions.push(
        exists(
          db
            .select({ one: jobPlaces.placeId })
            .from(jobPlaces)
            .where(
              and(eq(jobPlaces.jobId, jobs.id), inArray(jobPlaces.placeId, [...criteria.placeIds])),
            ),
        ),
      );
    }

    const rows = db
      .select({
        category: jobs.category,
        company: jobs.company,
        companySlug: jobs.companySlug,
        description: jobs.description,
        descriptionHash: jobs.descriptionHash,
        id: jobs.id,
        locationRaw: jobs.locationRaw,
        postedAt: jobs.postedAt,
        title: jobs.title,
        titleNorm: jobs.titleNorm,
        workMode: jobs.workMode,
      })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.postedAt))
      .limit(POOL_QUERY_LIMIT)
      .all();

    const places = placesFor(rows.map((row) => row.id));

    const poolRows: PoolJob[] = rows.map((row) => ({
      category: row.category,
      company: row.company,
      companySlug: row.companySlug,
      description: row.description,
      descriptionHash: row.descriptionHash,
      id: row.id,
      language: null,
      locationRaw: row.locationRaw,
      placeIds: places.get(row.id) ?? [],
      postedAt: row.postedAt,
      title: row.title,
      titleNorm: row.titleNorm,
      workMode: row.workMode,
    }));

    return { criteria, jobs: filterPoolJobs(poolRows, criteria) };
  }

  return { read };
}

export type JobsPool = ReturnType<typeof createJobsPool>;
