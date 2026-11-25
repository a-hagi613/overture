import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { EmploymentType, Seniority, Workplace } from "../../shared/tag-taxonomy.ts";

import { retryWhenBusy } from "../platform/db/busy.ts";
import { postings, postingTags } from "../platform/db/catalog-schema.ts";
import { logError } from "../platform/log.ts";
import { countryNameFor } from "../catalog/geo.ts";
import { EMPLOYMENT_TYPES, SENIORITIES } from "../../shared/tag-taxonomy.ts";
import { roleTaxonomyName } from "../../shared/role-taxonomy.ts";

const MAX_ROLE_CHOICES = 12;
const MAX_LOCATION_CHOICES = 8;

const shownWorkplaces = ["remote", "hybrid", "onsite"] as const satisfies readonly Workplace[];

const shownEmploymentTypes = EMPLOYMENT_TYPES.filter(
  (type): type is Exclude<EmploymentType, "unknown"> => type !== "unknown",
);

export interface TargetChoices {
  roles: string[];
  locations: string[];
  seniorities: Seniority[];
  workplaces: Workplace[];
  employmentTypes: EmploymentType[];
}

/**
 * Every value Onboarding offers as a target, taken from Postings that are still
 * open. A value with no open Posting is never offered, so a pick can never be
 * empty. Roles are the most common role ids by name; a category or subcategory
 * is chosen in the category picker instead.
 * @param db The application database.
 * @returns The choices for roles, locations, seniority, workplace and employment type.
 */
export function targetChoices(db: CatalogDatabase) {
  const open = isNull(postings.closedAt);

  const roleCandidates = db
    .select({ total: count(), value: postingTags.value })
    .from(postingTags)
    .innerJoin(postings, eq(postings.id, postingTags.postingId))
    .where(and(open, eq(postingTags.dimension, "granular_role")))
    .groupBy(postingTags.value)
    .orderBy(desc(count()), postingTags.value)
    .limit(MAX_ROLE_CHOICES)
    .all();

  const hasOpenSeniority = (value: string) =>
    db
      .select({ one: sql`1` })
      .from(postingTags)
      .innerJoin(postings, eq(postings.id, postingTags.postingId))
      .where(and(open, eq(postingTags.dimension, "seniority"), eq(postingTags.value, value)))
      .limit(1)
      .get() !== undefined;

  const seniorityValues = db
    .selectDistinct({ value: postingTags.value })
    .from(postingTags)
    .where(eq(postingTags.dimension, "seniority"))
    .all()
    .map((row) => row.value);

  const seniorityPresent = new Set(seniorityValues);

  const hasWorkplace = (value: Workplace) =>
    db
      .select({ one: sql`1` })
      .from(postings)
      .where(and(open, eq(postings.workplace, value)))
      .limit(1)
      .get() !== undefined;

  const hasEmploymentType = (value: EmploymentType) =>
    db
      .select({ one: sql`1` })
      .from(postings)
      .where(and(open, eq(postings.employmentType, value)))
      .limit(1)
      .get() !== undefined;

  return {
    employmentTypes: shownEmploymentTypes.filter((value) => hasEmploymentType(value)),
    locations: locationChoices(db),
    roles: roleCandidates.map((row) => roleTaxonomyName(row.value)),
    seniorities: SENIORITIES.filter(
      (value) => seniorityPresent.has(value) && hasOpenSeniority(value),
    ),
    workplaces: shownWorkplaces.filter((value) => hasWorkplace(value)),
  } satisfies TargetChoices;
}

/**
 * Serves the onboarding choices from memory. After `staleMs` the stamp (open Posting count and the
 * newest Posting row) is compared; a change refreshes the choices, in the background unless
 * `staleMs` is 0.
 * @param deps The database, a clock reading in milliseconds, how long a copy is trusted and where a failed refresh is reported (the log by default).
 * @returns `read` for the current choices and `warm` to fill the cache without waiting.
 */
export function createTargetChoicesCache(deps: {
  catalogDb: CatalogDatabase;
  now: () => number;
  onError?: (cause: unknown) => void;
  staleMs: number;
}) {
  const {
    catalogDb: db,
    now,
    onError = (cause) => logError("onboarding choices refresh", cause),
    staleMs,
  } = deps;

  let cached: { at: number; stamp: string; value: TargetChoices } | null = null;
  let refreshing = false;

  function postingStamp() {
    const row = db
      .select({ newest: sql<number>`max(rowid)`, open: count() })
      .from(postings)
      .where(isNull(postings.closedAt))
      .get();

    return `${String(row?.open ?? 0)}:${String(row?.newest ?? 0)}`;
  }

  function compute() {
    const stamp = postingStamp();
    const value = targetChoices(db);

    cached = { at: now(), stamp, value };

    return value;
  }

  function refreshInBackground() {
    if (refreshing) {
      return;
    }

    refreshing = true;

    setTimeout(() => {
      void refresh();
    }, 0);
  }

  async function refresh() {
    try {
      await retryWhenBusy(compute, "onboarding choices refresh");
    } catch (error) {
      onError(error);
    } finally {
      refreshing = false;
    }
  }

  function read() {
    if (cached === null) {
      return compute();
    }

    if (now() - cached.at < staleMs) {
      return cached.value;
    }

    if (postingStamp() === cached.stamp) {
      cached = { ...cached, at: now() };

      return cached.value;
    }

    if (staleMs === 0) {
      return compute();
    }

    refreshInBackground();

    return cached.value;
  }

  function warm() {
    refreshInBackground();
  }

  return { read, warm };
}

function locationLabel(row: {
  city: string | null;
  countryCode: string | null;
  locationRaw: string | null;
  workplace: string;
}) {
  const city = row.city?.trim() ?? "";

  if (city !== "") {
    return city;
  }

  if (row.workplace === "remote") {
    const raw = row.locationRaw?.trim() ?? "";

    if (raw !== "") {
      return raw;
    }

    if (row.countryCode !== null) {
      return `Remote, ${countryNameFor(row.countryCode) ?? row.countryCode}`;
    }
  }

  if (row.countryCode !== null) {
    return countryNameFor(row.countryCode) ?? row.countryCode;
  }

  return null;
}

/**
 * The open Postings grouped by the four columns a location choice is read from.
 * @param db The application database.
 * @returns One row per city, country, raw location and workplace, with its open Posting count.
 */
export function locationChoiceCounts(db: CatalogDatabase) {
  return db
    .select({
      city: postings.city,
      countryCode: postings.countryCode,
      locationRaw: postings.locationRaw,
      total: count(),
      workplace: postings.workplace,
    })
    .from(postings)
    .where(isNull(postings.closedAt))
    .groupBy(postings.city, postings.countryCode, postings.locationRaw, postings.workplace);
}

/**
 * Cities, remote forms and countries that open Postings actually name, most
 * common first.
 * @param db The application database.
 * @returns The location choices.
 */
export function locationChoices(db: CatalogDatabase) {
  const rows = locationChoiceCounts(db).all();

  const totals = new Map<string, number>();

  for (const row of rows) {
    const label = locationLabel(row);

    if (label === null) {
      continue;
    }

    totals.set(label, (totals.get(label) ?? 0) + row.total);
  }

  return [...totals.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_LOCATION_CHOICES)
    .map(([label]) => label);
}
