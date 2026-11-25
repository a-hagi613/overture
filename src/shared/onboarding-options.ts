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
