import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { TargetsInput } from "../../shared/targets.ts";

import type { AppDatabase } from "../platform/db/client.ts";

import { grants } from "../platform/db/schema.ts";
import { isFreehireCategory } from "../../shared/freehire-categories.ts";
import { placeSearchFacets } from "../places/catalog.ts";
import type { JobSearchQuery } from "./source.ts";

export interface PullPreferences {
  /** freehire category slugs. Empty means every category. */
  categories: readonly string[];
  /** ISO alpha-2 country codes, lower case. */
  countries: readonly string[];
  /** freehire region slugs. */
  regions: readonly string[];
  /** City names as freehire spells them. */
  cities: readonly string[];
  /** freehire metro names. */
  metros: readonly string[];
  /** The canonical place ids the user picked, which the reader matches job places against. */
  placeIds: readonly string[];
  /** Free-text role targets, searched as title words rather than categories. */
  titleWords: readonly string[];
  /** The languages the person reads; a posting in another language is not a match. Empty means no language gate. */
  languages?: readonly string[];
}

/**
 * The freehire categories a user's saved roles pick. A role target is a freehire category id or a title word, so only
 * ids that freehire still knows are sent as categories.
 * @param roles The saved role targets.
 * @returns The categories, deduplicated and sorted.
 */
export function categoriesForRoles(roles: readonly string[]) {
  const categories = new Set<string>();

  for (const role of roles) {
    const trimmed = role.trim();

    if (isFreehireCategory(trimmed)) {
      categories.add(trimmed);
    }
  }

  return [...categories].toSorted();
}

function titleWordsForRoles(roles: readonly string[]) {
  const words = new Set<string>();

  for (const role of roles) {
    const trimmed = role.trim();

    if (trimmed !== "" && !isFreehireCategory(trimmed)) {
      words.add(trimmed);
    }
  }

  return [...words].toSorted();
}

/**
 * Turns saved place ids into freehire's geography facets. Geography is one OR group in freehire, so a user with two
 * places gets both in one query. The same ids are returned for the reader, so the pull and the match use one list.
 * @param placeIds The saved canonical place ids.
 * @returns The country, region, metro and city facets plus the ids.
 */
export function placesForLocations(placeIds: readonly string[]) {
  return placeSearchFacets(placeIds);
}

/**
 * The search a user's saved targets turn into.
 * @param targets The saved targets.
 * @param languages The languages the person reads, for the reader's language gate; empty keeps every posting.
 * @returns The freehire categories, geography and free-text title words.
 */
export function pullPreferencesFor(
  targets: Pick<TargetsInput, "roles" | "locations">,
  languages: readonly string[] = [],
) {
  const places = placesForLocations(targets.locations);

  return {
    categories: categoriesForRoles(targets.roles),
    cities: places.cities,
    countries: places.countries,
    languages: languages.flatMap((language) => {
      const folded = language.trim().toLowerCase();

      return folded === "" ? [] : [folded];
    }),
    metros: places.metros,
    placeIds: places.placeIds,
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
    [...preferences.metros].toSorted(),
    [...preferences.placeIds].toSorted(),
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
    metros: preferences.metros,
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
