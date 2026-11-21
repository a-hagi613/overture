import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { EmploymentType, Seniority, Workplace } from "../../shared/tag-taxonomy.ts";

import { postings, postingTags } from "../platform/db/schema.ts";
import { countryNameFor } from "../catalog/geo.ts";
import { EMPLOYMENT_TYPES, SENIORITIES } from "../../shared/tag-taxonomy.ts";

const MAX_ROLE_CHOICES = 12;
const MAX_ROLE_CANDIDATES = 80;
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
 * empty.
 * @param db The application database.
 * @returns The choices for roles, locations, seniority, workplace and employment type.
 */
export function targetChoices(db: AppDatabase) {
  const open = isNull(postings.closedAt);

  const roleCandidates = db
    .select({ total: count(), value: postingTags.value })
    .from(postingTags)
    .where(inArray(postingTags.dimension, ["role", "subrole"]))
    .groupBy(postingTags.value)
    .orderBy(desc(count()), postingTags.value)
    .limit(MAX_ROLE_CANDIDATES)
    .all();

  const hasOpenPosting = (dimensions: ("role" | "subrole" | "seniority")[], value: string) =>
    db
      .select({ one: sql`1` })
      .from(postingTags)
      .innerJoin(postings, eq(postings.id, postingTags.postingId))
      .where(and(open, inArray(postingTags.dimension, dimensions), eq(postingTags.value, value)))
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
    roles: roleCandidates
      .filter((row) => hasOpenPosting(["role", "subrole"], row.value))
      .slice(0, MAX_ROLE_CHOICES)
      .map((row) => row.value),
    seniorities: SENIORITIES.filter(
      (value) => seniorityPresent.has(value) && hasOpenPosting(["seniority"], value),
    ),
    workplaces: shownWorkplaces.filter((value) => hasWorkplace(value)),
  } satisfies TargetChoices;
}

export function createTargetChoicesCache(deps: {
  db: AppDatabase;
  now: () => number;
  staleMs: number;
}) {
  const { db, now, staleMs } = deps;
  let cached: { at: number; stamp: number; value: TargetChoices } | null = null;
  let refreshing = false;

  function openPostingCount() {
    return (
      db.select({ total: count() }).from(postings).where(isNull(postings.closedAt)).get()?.total ??
      0
    );
  }

  function compute() {
    const stamp = openPostingCount();
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
      try {
        compute();
      } catch {
        refreshing = false;
      } finally {
        refreshing = false;
      }
    }, 0);
  }

  function read() {
    if (cached === null) {
      return compute();
    }

    if (now() - cached.at < staleMs) {
      return cached.value;
    }

    if (openPostingCount() === cached.stamp) {
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
 * Cities, remote forms and countries that open Postings actually name, most
 * common first.
 * @param db The application database.
 * @returns The location choices.
 */
export function locationChoices(db: AppDatabase) {
  const rows = db
    .select({
      city: postings.city,
      countryCode: postings.countryCode,
      locationRaw: postings.locationRaw,
      total: count(),
      workplace: postings.workplace,
    })
    .from(postings)
    .where(isNull(postings.closedAt))
    .groupBy(postings.city, postings.countryCode, postings.locationRaw, postings.workplace)
    .all();

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
