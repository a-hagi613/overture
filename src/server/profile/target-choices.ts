import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { EmploymentType, Seniority, Workplace } from "../../shared/tag-taxonomy.ts";

import { postings, postingTags } from "../platform/db/schema.ts";
import { countryNameFor } from "../catalog/geo.ts";
import { EMPLOYMENT_TYPES, SENIORITIES } from "../../shared/tag-taxonomy.ts";

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
 * empty.
 * @param db The application database.
 * @returns The choices for roles, locations, seniority, workplace and employment type.
 */
export function targetChoices(db: AppDatabase) {
  const open = isNull(postings.closedAt);

  const roleRows = db
    .select({ total: count(), value: postingTags.value })
    .from(postingTags)
    .innerJoin(postings, eq(postings.id, postingTags.postingId))
    .where(and(open, inArray(postingTags.dimension, ["role", "subrole"])))
    .groupBy(postingTags.value)
    .orderBy(desc(count()), postingTags.value)
    .all();

  const seniorityRows = db
    .select({ value: postingTags.value })
    .from(postingTags)
    .innerJoin(postings, eq(postings.id, postingTags.postingId))
    .where(and(open, eq(postingTags.dimension, "seniority")))
    .groupBy(postingTags.value)
    .all();

  const workplaceRows = db
    .select({ value: postings.workplace })
    .from(postings)
    .where(open)
    .groupBy(postings.workplace)
    .all();

  const employmentRows = db
    .select({ value: postings.employmentType })
    .from(postings)
    .where(open)
    .groupBy(postings.employmentType)
    .all();

  const seniorities = new Set(seniorityRows.map((row) => row.value));
  const workplaces = new Set(workplaceRows.map((row) => row.value));
  const employmentTypes = new Set(employmentRows.map((row) => row.value));

  return {
    employmentTypes: shownEmploymentTypes.filter((value) => employmentTypes.has(value)),
    locations: locationChoices(db),
    roles: roleRows.slice(0, MAX_ROLE_CHOICES).map((row) => row.value),
    seniorities: SENIORITIES.filter((value) => seniorities.has(value)),
    workplaces: shownWorkplaces.filter((value) => workplaces.has(value)),
  } satisfies TargetChoices;
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
