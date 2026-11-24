import { z } from "zod";

import { ROLE_GROUPS } from "./tag-taxonomy.ts";
import { isEscoRole } from "./esco-roles.ts";
import type { RoleGroup } from "./tag-taxonomy.ts";

/**
 * The filters the public supply preview accepts (issue #567, WS-17b). They stay deliberately small and closed:
 * the landing asks about a Level-1 category, an optional Level-2 granular role and a place, and every value is one
 * the catalog's own tags use, so a stranger cannot make the server scan arbitrary columns.
 *
 * `role` is the original Level-1 query parameter and keeps working unchanged; `category` is its explicit alias and
 * `granularRole` adds the 134 ESCO Level-2 roles (issue #629). A granular role is more specific than its category,
 * so when both arrive the granular role is the filter and the category is only a UI hint.
 */
export const supplyQuerySchema = z.object({
  role: z.enum(ROLE_GROUPS).optional(),
  category: z.enum(ROLE_GROUPS).optional(),
  granularRole: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => isEscoRole(value), { message: "unknown granular role" })
    .optional(),
  location: z.string().trim().min(2).max(120).optional(),
  remote: z.enum(["1", "0", "true", "false"]).optional(),
  /** The radius around a resolved city; absent keeps an exact city match. */
  radius: z.enum(["25", "40", "80"]).optional(),
});

export type SupplyQuery = z.infer<typeof supplyQuerySchema>;

export interface SupplyFilters {
  /** The Level-1 category, or null for every category. */
  role: RoleGroup | null;
  /** The Level-2 ESCO role, or null for every role. It wins over `role` when both are set. */
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
