import type { RoleCategoryId } from "./role-taxonomy.ts";
import type { Seniority } from "./tag-taxonomy.ts";
import { pickableRoles, roleCategoryOf } from "./role-taxonomy.ts";

/** Seniority levels offered during onboarding in universal career progression order. */
export const ONBOARDING_SENIORITIES: readonly Seniority[] = [
  "intern",
  "entry",
  "mid",
  "senior",
  "manager",
  "director",
];

/** Curated North American and European hiring hubs and remote regions for location selection. */
export const CURATED_LOCATIONS: readonly string[] = [
  "Remote",
  "Remote (US)",
  "Remote (Canada)",
  "Remote (UK)",
  "Remote (Europe)",
  "Toronto",
  "Vancouver",
  "Montreal",
  "New York",
  "San Francisco",
  "Seattle",
  "Austin",
  "Boston",
  "Chicago",
  "Los Angeles",
  "London",
  "Berlin",
  "Amsterdam",
  "Dublin",
  "Paris",
  "Singapore",
  "Sydney",
];

function dedupeStrings(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();

    if (trimmed !== "" && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/** The category the onboarding role picker opens on when nothing is saved yet. */
export const DEFAULT_ONBOARDING_CATEGORY: RoleCategoryId = "software-it";

/** How many role chips appear before collapsing the rest behind a toggle (issue #668). */
export const ONBOARDING_ROLE_CHIP_LIMIT = 8;

/**
 * The role chips one onboarding category offers: its specific roles in the role taxonomy (issue #660), so a chosen
 * chip is a target that matches exactly that role.
 * @param category The selected category id.
 * @returns Role names in taxonomy order.
 */
export function onboardingRolesForCategory(category: RoleCategoryId) {
  return pickableRoles(category).map((role) => role.name);
}

/**
 * Orders a category's role chips by open-job count descending, keeping taxonomy order for ties.
 * @param roles Role names in taxonomy order.
 * @param roleCounts Open-posting counts keyed by canonical role name.
 * @returns A new ordered array of role names.
 */
export function orderOnboardingRoles(
  roles: readonly string[],
  roleCounts?: Readonly<Record<string, number>>,
) {
  if (roleCounts === undefined) {
    return [...roles];
  }

  return roles
    .map((role, index) => ({ count: roleCounts[role] ?? 0, index, role }))
    .toSorted((left, right) => right.count - left.count || left.index - right.index)
    .map((entry) => entry.role);
}

/**
 * Computes the visible slice of a category's role chips, always keeping selected roles visible while collapsed.
 * @param orderedRoles Ordered role names for the current category.
 * @param selectedRoles Currently selected role names.
 * @param expanded Whether the user expanded the full role list.
 * @param limit Maximum unexpanded chip count.
 * @returns The visible role list and how many roles remain collapsed.
 */
export function visibleOnboardingRoles(
  orderedRoles: readonly string[],
  selectedRoles: readonly string[],
  expanded: boolean,
  limit = ONBOARDING_ROLE_CHIP_LIMIT,
) {
  if (expanded || orderedRoles.length <= limit) {
    return { hiddenCount: 0, visible: [...orderedRoles] };
  }

  const head = orderedRoles.slice(0, limit);
  const headSet = new Set(head);

  const selectedTail = orderedRoles
    .slice(limit)
    .filter((role) => !headSet.has(role) && selectedRoles.includes(role));

  const visible = [...head, ...selectedTail];

  return { hiddenCount: orderedRoles.length - visible.length, visible };
}

/**
 * The category the onboarding picker opens on for a saved role.
 * @param role A selected or saved role name.
 * @returns Its category, or the default category for a retired label or free text.
 */
export function onboardingCategoryForRole(role: string) {
  return roleCategoryOf(role) ?? DEFAULT_ONBOARDING_CATEGORY;
}

/**
 * Combines selected locations, live catalog choices, and curated hubs into a deduplicated list.
 * @param catalogLocations Locations observed in open postings.
 * @param selected Currently selected locations.
 * @returns Ordered, unique location choices for multi-select dropdowns.
 */
export function onboardingLocationChoices(
  catalogLocations: readonly string[],
  selected: readonly string[],
) {
  return dedupeStrings([...selected, ...catalogLocations, ...CURATED_LOCATIONS]);
}
