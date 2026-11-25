import { escoRoleCategory, ESCO_GRANULAR_ROLE_OPTIONS } from "./esco-roles.ts";
import type { RoleGroup, Seniority, Workplace } from "./tag-taxonomy.ts";
import { ROLE_GROUPS } from "./tag-taxonomy.ts";

/** Workplace options offered during onboarding. */
export const ONBOARDING_WORKPLACES: readonly Workplace[] = ["remote", "hybrid"];

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

const EXCLUDED_OUTLIER_ROLES = new Set([
  "Chef",
  "Cleaner",
  "Construction Worker",
  "Delivery Driver",
  "Dentist",
  "Farmer",
  "Firefighter",
  "Flight Attendant",
  "Hotel Manager",
  "Insurance Agent",
  "Judge",
  "Machine Operator",
  "Midwife",
  "Police Officer",
  "Real Estate Agent",
  "Security Guard",
  "Soldier",
  "Veterinarian",
]);

const CURATED_ROLE_OVERRIDES: Partial<Record<RoleGroup, readonly string[]>> = {
  "Software Engineering": [
    "Software Engineer",
    "Frontend Engineer",
    "Backend Engineer",
    "Full-Stack Engineer",
    "Platform Engineer",
    "Mobile Engineer",
    "Software Architect",
    "Game Developer",
  ],
  "DevOps & Infrastructure": [
    "DevOps Engineer",
    "Site Reliability Engineer",
    "Cloud Engineer",
    "Network Engineer",
    "Database Administrator",
  ],
  "Machine Learning & AI": ["AI Engineer", "Machine Learning Engineer", "AI Research Scientist"],
  "Data & Analytics": [
    "Data Analyst",
    "Data Engineer",
    "Data Scientist",
    "Analytics Engineer",
    "Statistician",
  ],
  "Product Management": ["Product Manager", "Technical Product Manager", "Group Product Manager"],
  Design: [
    "Product Designer",
    "UI Designer",
    "UX Researcher",
    "Design Manager",
    "Graphic Designer",
    "Motion Designer",
  ],
};

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

const ROLES_BY_CATEGORY = new Map<RoleGroup, readonly string[]>(
  ROLE_GROUPS.map((group) => {
    const curated = CURATED_ROLE_OVERRIDES[group] ?? [];

    const escoRoles = ESCO_GRANULAR_ROLE_OPTIONS.filter(
      (option) => option.category === group && !EXCLUDED_OUTLIER_ROLES.has(option.role),
    ).map((option) => option.role);

    return [group, dedupeStrings([...curated, ...escoRoles])];
  }),
);

/**
 * Curated multi-select role options belonging to one onboarding category.
 * @param category Selected occupational category.
 * @returns Deduplicated role titles in display order.
 */
export function onboardingRolesForCategory(category: RoleGroup) {
  return ROLES_BY_CATEGORY.get(category) ?? [];
}

/**
 * Resolves the best matching onboarding category for an existing role name.
 * @param role A selected or saved role name.
 * @returns Matching category group, or Software Engineering when unknown.
 */
export function onboardingCategoryForRole(role: string) {
  for (const [group, roles] of ROLES_BY_CATEGORY) {
    if (roles.includes(role)) {
      return group;
    }
  }

  return escoRoleCategory(role) ?? ("Software Engineering" satisfies RoleGroup);
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
