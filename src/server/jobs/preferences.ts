import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { RoleCategoryId } from "../../shared/role-taxonomy.ts";
import type { TargetsInput } from "../../shared/targets.ts";

import type { AppDatabase } from "../platform/db/client.ts";

import { grants } from "../platform/db/schema.ts";
import { roleCategoryOf } from "../../shared/role-taxonomy.ts";
import { countryCodesNamedIn, resolveLocation } from "../catalog/geo.ts";
import type { JobSearchQuery } from "./source.ts";

/** The freehire category slugs each Overture role category reaches. One category maps to several freehire ones. */
export const TAXONOMY_TO_FREEHIRE = {
  "software-it": [
    "software_engineering",
    "backend",
    "frontend",
    "fullstack",
    "mobile",
    "devops",
    "sre",
    "network_engineering",
    "system_administration",
    "it_support",
    "security",
    "qa",
    "embedded",
  ],
  "data-ai": ["data_analytics", "data_engineering", "data_science", "ml_ai", "ai_engineering"],
  "product-design": ["product", "design", "creative", "project_management"],
  engineering: [
    "engineering_design",
    "industrial_engineering",
    "occupational_safety",
    "architecture",
  ],
  science: ["science"],
  healthcare: ["healthcare"],
  "care-health-support": ["healthcare", "social_services", "personal_services"],
  education: ["education"],
  sales: ["sales", "solutions_engineering"],
  "marketing-communications": ["marketing", "creative", "developer_relations", "technical_writing"],
  "customer-service": ["support", "customer_success"],
  "finance-accounting": ["finance"],
  "people-hr": ["hr", "recruiting"],
  "business-operations": ["operations", "business_analysis", "project_management"],
  management: ["operations", "project_management"],
  legal: ["legal"],
  "admin-office": ["administration"],
  "hospitality-food": ["hospitality", "retail"],
  "cleaning-grounds": ["personal_services"],
  "skilled-trades": ["skilled_trades"],
  "maintenance-repair": ["skilled_trades"],
  manufacturing: ["manufacturing", "industrial_engineering"],
  "transport-logistics": ["logistics"],
  "protective-services": ["public_safety", "security"],
  "community-social-services": ["social_services"],
  "arts-media": ["creative"],
  "personal-services": ["personal_services"],
  "agriculture-outdoors": ["other"],
  military: ["public_safety", "other"],
} as const satisfies Record<RoleCategoryId, readonly string[]>;

export interface PullPreferences {
  /** freehire category slugs. Empty means every category. */
  categories: readonly string[];
  /** ISO alpha-2 country codes, lower case. */
  countries: readonly string[];
  /** freehire region slugs. */
  regions: readonly string[];
  /** City names as freehire spells them. */
  cities: readonly string[];
  /** Free-text role targets, searched as title words. */
  titleWords: readonly string[];
}

/**
 * The freehire categories a user's saved roles reach. A picker target is a taxonomy id, name or subcategory, which
 * `roleCategoryOf` folds to its 29-category root; anything else is free text and becomes a title word instead.
 * @param roles The saved role targets.
 * @returns The categories, deduplicated and sorted.
 */
export function categoriesForRoles(roles: readonly string[]) {
  const categories = new Set<string>();

  for (const role of roles) {
    const category = roleCategoryOf(role);

    if (category !== null) {
      for (const freehire of TAXONOMY_TO_FREEHIRE[category]) {
        categories.add(freehire);
      }
    }
  }

  return [...categories].toSorted();
}

/**
 * The free-text role targets, which freehire searches as title words rather than categories.
 * @param roles The saved role targets.
 * @returns The trimmed free-text values.
 */
export function titleWordsForRoles(roles: readonly string[]) {
  const words = new Set<string>();

  for (const role of roles) {
    if (roleCategoryOf(role) !== null) {
      continue;
    }

    const trimmed = role.trim();

    if (trimmed !== "") {
      words.add(trimmed);
    }
  }

  return [...words].toSorted();
}

/**
 * Turns saved location strings into freehire's geography facets. Geography is one OR group in freehire, so a user
 * with two places gets both in one query. A location that names no country contributes nothing; freehire is never
 * asked to guess.
 * @param locations The saved location targets.
 * @returns The country, region and city facets.
 */
export function placesForLocations(locations: readonly string[]) {
  const countries = new Set<string>();
  const cities = new Set<string>();

  for (const location of locations) {
    const resolved = resolveLocation(location);

    if (resolved.countryCode === null) {
      for (const code of countryCodesNamedIn(location)) {
        countries.add(code.toLowerCase());
      }
    } else {
      countries.add(resolved.countryCode.toLowerCase());
    }

    if (resolved.city !== null && resolved.city.trim() !== "") {
      cities.add(resolved.city.trim());
    }
  }

  return {
    cities: [...cities].toSorted(),
    countries: [...countries].toSorted(),
    regions: [],
  };
}

/**
 * The search a user's saved targets turn into.
 * @param targets The saved targets.
 * @returns The freehire categories, geography and free-text title words.
 */
export function pullPreferencesFor(targets: Pick<TargetsInput, "roles" | "locations">) {
  const places = placesForLocations(targets.locations);

  return {
    categories: categoriesForRoles(targets.roles),
    cities: places.cities,
    countries: places.countries,
    regions: places.regions,
    titleWords: titleWordsForRoles(targets.roles),
  };
}

/**
 * The stable key shared by every user whose preferences make the same freehire request, so one request serves them
 * all.
 * @param preferences One user's pull preferences.
 * @returns A canonical string.
 */
export function queryKeyOf(preferences: PullPreferences) {
  return JSON.stringify([
    [...preferences.categories].toSorted(),
    [...preferences.countries].toSorted(),
    [...preferences.regions].toSorted(),
    [...preferences.cities].toSorted(),
    [...preferences.titleWords].toSorted(),
  ]);
}

/**
 * The freehire search query for one group. Work mode is deliberately absent: freehire leaves it blank on most
 * postings, so it is never a hard filter.
 * @param preferences The group's preferences.
 * @returns The query every member of the group shares.
 */
export function searchQueryFor(preferences: PullPreferences) {
  return {
    categories: preferences.categories,
    cities: preferences.cities,
    countries: preferences.countries,
    keywords: preferences.titleWords,
    regions: preferences.regions,
  } satisfies JobSearchQuery;
}

/**
 * Whether a save changed the inputs the pull searches on (roles or places), which is when a full pull is due again.
 * @param before The saved targets before the save.
 * @param after The saved targets after it.
 * @returns True when roles or locations differ.
 */
export function preferencesChanged(
  before: Pick<TargetsInput, "roles" | "locations">,
  after: Pick<TargetsInput, "roles" | "locations">,
) {
  return (
    JSON.stringify([...before.roles].toSorted()) !== JSON.stringify([...after.roles].toSorted()) ||
    JSON.stringify([...before.locations].toSorted()) !==
      JSON.stringify([...after.locations].toSorted())
  );
}

/**
 * Every user on a paid Weekly or Monthly plan right now, in one query so a tick does not ask per account.
 * @param db The application database.
 * @param now The instant to test against.
 * @returns The paying user ids.
 */
export function paidUserIds(db: AppDatabase, now: number) {
  const rows = db
    .selectDistinct({ userId: grants.userId })
    .from(grants)
    .where(
      and(
        eq(grants.source, "period"),
        lte(grants.startsAt, now),
        or(isNull(grants.expiresAt), gt(grants.expiresAt, now)),
      ),
    )
    .all();

  return new Set(rows.map((row) => row.userId));
}

/**
 * Whether a user is on a paid Weekly or Monthly plan right now: an active `period` grant from a Stripe period. The
 * free trial grants `trial` applications instead, and gets no repeating pulls.
 * @param db The application database.
 * @param userId The account.
 * @param now The instant to test against.
 * @returns True for a paying user.
 */
export function isPaidUser(db: AppDatabase, userId: string, now: number) {
  const row = db
    .select({ id: grants.id })
    .from(grants)
    .where(
      and(
        eq(grants.userId, userId),
        eq(grants.source, "period"),
        lte(grants.startsAt, now),
        or(isNull(grants.expiresAt), gt(grants.expiresAt, now)),
      ),
    )
    .limit(1)
    .get();

  return row !== undefined;
}
