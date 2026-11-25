import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { postingTags, postings } from "../platform/db/catalog-schema.ts";
import { legacyTargetToTaxonomy } from "../catalog/legacy-roles.ts";
import { normalizeTitle } from "../catalog/normalize.ts";
import { ROLE_CATEGORIES, ROLE_SUBCATEGORIES, ROLES } from "../../shared/role-taxonomy.ts";

/** Role-depth points a Posting earns by how closely its role matches one of the person's role targets. */
export const ROLE_MATCH_SCORE = {
  exact: 40,
  subcategory: 30,
  freeText: 30,
  category: 20,
} as const;

const ROLE_TAG_DIMENSIONS = ["role", "subrole", "granular_role"] as const;

const STOP_WORDS = new Set(["and", "or", "the", "of", "at", "in", "on", "for", "to", "a", "an"]);

const roleIds = new Set(ROLES.map((role) => role.id));
const subcategoryIds = new Set(ROLE_SUBCATEGORIES.map((sub) => sub.id));
const categoryIds = new Set<string>(ROLE_CATEGORIES.map((category) => category.id));

/**
 * What a person's role targets mean once every saved value is read as taxonomy ids. A role target admits only that
 * role: a neighbour in the same subcategory often needs another licence or level (a nurse practitioner for a
 * registered nurse), so a wider reach is chosen by targeting the subcategory or the category.
 */
export interface RoleTargetPlan {
  readonly exactRoleIds: ReadonlySet<string>;
  readonly subcategoryIds: ReadonlySet<string>;
  readonly categoryIds: ReadonlySet<string>;
  readonly freeTextWords: readonly (readonly string[])[];
}

function wordsOf(value: string) {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * Reads saved role targets (ids, current or retired names, or free text) as one plan.
 * @param values The person's role targets as stored.
 * @returns The ids and free-text word groups the targets mean.
 */
export function planRoleTargets(values: readonly string[]) {
  const exact = new Set<string>();
  const subcategories = new Set<string>();
  const categories = new Set<string>();
  const freeText: string[][] = [];

  for (const value of values) {
    for (const id of legacyTargetToTaxonomy(value)) {
      if (roleIds.has(id)) {
        exact.add(id);
      } else if (subcategoryIds.has(id)) {
        subcategories.add(id);
      } else if (categoryIds.has(id)) {
        categories.add(id);
      } else {
        const words = wordsOf(id);

        if (words.length > 0) {
          freeText.push(words);
        }
      }
    }
  }

  return {
    exactRoleIds: exact,
    subcategoryIds: subcategories,
    categoryIds: categories,
    freeTextWords: freeText,
  } satisfies RoleTargetPlan;
}

/**
 * The tag values a role filter could be stored under: its taxonomy ids, plus the value as given so a catalog built
 * before the role taxonomy still answers while it is rebuilt.
 * @param value A role id, a current or retired role name, or free text.
 * @returns The distinct tag values, the value as given last.
 */
export function roleFilterTagValues(value: string) {
  const plan = planRoleTargets([value]);

  return [
    ...new Set([...plan.exactRoleIds, ...plan.subcategoryIds, ...plan.categoryIds, value.trim()]),
  ];
}

function tagValueIn(dimension: (typeof ROLE_TAG_DIMENSIONS)[number], values: ReadonlySet<string>) {
  return values.size === 0
    ? null
    : and(eq(postingTags.dimension, dimension), inArray(postingTags.value, [...values]));
}

function planTagClauses(plan: RoleTargetPlan) {
  return [
    tagValueIn("granular_role", plan.exactRoleIds),
    tagValueIn("subrole", plan.subcategoryIds),
    tagValueIn("role", plan.categoryIds),
  ].filter((clause) => clause !== null && clause !== undefined);
}

function postingsTagged(clauses: readonly SQL[]) {
  const searches = clauses.map(
    (clause) => sql`select ${postingTags.postingId} from ${postingTags} where ${clause}`,
  );

  return sql`${postings.id} in (${sql.join(searches, sql` union `)})`;
}

function titleHasWords(words: readonly string[]) {
  return and(
    ...words.map((word) => sql`instr(' ' || ${postings.titleNorm} || ' ', ${` ${word} `}) > 0`),
  );
}

/**
 * The SQL condition a Posting must meet to enter the person's pool: its role is a target role, it sits in a target
 * subcategory or category, or its title holds every word of a free-text target.
 * @param plan A plan from `planRoleTargets`.
 * @returns The condition, or null when the plan names nothing.
 */
export function roleTargetCondition(plan: RoleTargetPlan) {
  const tagClauses = planTagClauses(plan);

  const parts = [
    tagClauses.length === 0 ? null : postingsTagged(tagClauses),
    ...plan.freeTextWords.map((words) => titleHasWords(words)),
  ].filter((part) => part !== null && part !== undefined);

  return parts.length === 0 ? null : or(...parts);
}

/**
 * The SQL condition for one role filter on the catalog counts and search: the filter read as taxonomy ids, or a role
 * tag holding the value exactly as given, so a catalog built before the taxonomy still answers while it is rebuilt.
 * @param value The filter value: a taxonomy id or name, or a retired category or ESCO name.
 * @returns The condition.
 */
export function roleFilterCondition(value: string) {
  const plan = planRoleTargets([value]);

  const asGiven = sql`${inArray(postingTags.dimension, [...ROLE_TAG_DIMENSIONS])} and ${eq(postingTags.value, value.trim())}`;

  const tagged = postingsTagged([asGiven, ...planTagClauses(plan)]);

  return or(tagged, ...plan.freeTextWords.map((words) => titleHasWords(words))) ?? tagged;
}

/**
 * The role-depth points for one Posting: the closest way its role tags or title meet the plan.
 * @param plan A plan from `planRoleTargets`.
 * @param posting The Posting's normalized title and role tags.
 * @returns The points, or 0 when nothing matches.
 */
export function roleMatchScore(
  plan: RoleTargetPlan,
  posting: { titleNorm: string; tags: readonly { dimension: string; value: string }[] },
) {
  const values = (dimension: string) =>
    posting.tags.filter((tag) => tag.dimension === dimension).map((tag) => tag.value);

  const roles = values("granular_role");
  const subcategories = values("subrole");
  const categories = values("role");
  const title = ` ${posting.titleNorm} `;

  const scores = [
    roles.some((role) => plan.exactRoleIds.has(role)) ? ROLE_MATCH_SCORE.exact : 0,
    subcategories.some((sub) => plan.subcategoryIds.has(sub)) ? ROLE_MATCH_SCORE.subcategory : 0,
    plan.freeTextWords.some((words) => words.every((word) => title.includes(` ${word} `)))
      ? ROLE_MATCH_SCORE.freeText
      : 0,
    categories.some((category) => plan.categoryIds.has(category)) ? ROLE_MATCH_SCORE.category : 0,
  ];

  return Math.max(...scores);
}
