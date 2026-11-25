import { z } from "zod";

import { ROLE_GROUPS } from "./tag-taxonomy.ts";
import { isEscoRole } from "./esco-roles.ts";
import { isRoleTaxonomyValue } from "./role-taxonomy.ts";

const roleFilterValue = (accepts: (value: string) => boolean, message: string) =>
  z.string().trim().min(1).max(80).refine(accepts, { message }).optional();

const isCategoryValue = (value: string) =>
  ROLE_GROUPS.some((group) => group === value) || isRoleTaxonomyValue(value);

const isRoleValue = (value: string) => isEscoRole(value) || isRoleTaxonomyValue(value);

/**
 * The filters the public supply preview accepts (issue #567, WS-17b). They stay deliberately small and closed:
 * the landing asks about a Level-1 category, an optional Level-2 granular role and a place, and every value is one
 * the catalog's own tags use, so a stranger cannot make the server scan arbitrary columns.
 *
 * `role` is the original category parameter and `category` its explicit alias; `granularRole` names a role or
 * subcategory (issue #629). Each takes a role-taxonomy id or name (issue #660) or a retired category or ESCO role name,
 * which the server reads as taxonomy ids. A granular role is more specific than its category, so when both arrive the
 * granular role is the filter and the category is only a UI hint.
 */
export const supplyQuerySchema = z.object({
  role: roleFilterValue(isCategoryValue, "unknown role category"),
  category: roleFilterValue(isCategoryValue, "unknown role category"),
  granularRole: roleFilterValue(isRoleValue, "unknown granular role"),
  location: z.string().trim().min(2).max(120).optional(),
  remote: z.enum(["1", "0", "true", "false"]).optional(),
  /** The radius around a resolved city; absent keeps an exact city match. */
  radius: z.enum(["25", "40", "80"]).optional(),
});

export type SupplyQuery = z.infer<typeof supplyQuerySchema>;

export interface SupplyFilters {
  /** The category (a role-taxonomy id or name, or a retired category name), or null for every category. */
  role: string | null;
  /** The role or subcategory (a role-taxonomy id or name, or a retired ESCO name), or null. It wins over `role`. */
  granularRole: string | null;
  location: string | null;
  radiusKm: number | null;
  remote: boolean;
}

/**
 * Turns the validated query string into the filter object the catalog count reads.
 * @param query The validated `/api/supply` query.
 * @returns The same filters with `remote` as a boolean and absent values as null.
 */
export function supplyFiltersOf(query: SupplyQuery) {
  return {
    role: query.role ?? query.category ?? null,
    granularRole: query.granularRole ?? null,
    location: query.location ?? null,
    radiusKm: query.radius === undefined ? null : Number(query.radius),
    remote: query.remote === "1" || query.remote === "true",
  } satisfies SupplyFilters;
}

export const supplyCountsSchema = z.object({
  /** Supported open Postings matching the filters. Public counts only, never a user's row. */
  total: z.number().int().nonnegative(),
  /** The same count split by the ATS that hosts the board, biggest first. */
  byAts: z.array(
    z.object({
      ats: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  generatedAt: z.number().int(),
});

export type SupplyCounts = z.infer<typeof supplyCountsSchema>;

export const locationSuggestQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});

export const locationSuggestionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  meta: z.string(),
  kind: z.enum(["continent", "country", "region", "metro", "city"]),
});

export type LocationSuggestion = z.infer<typeof locationSuggestionSchema>;

export const locationSuggestionsResponseSchema = z.object({
  suggestions: z.array(locationSuggestionSchema),
});
