import { z } from "zod";

import { ROLE_GROUPS } from "./tag-taxonomy.ts";
import type { RoleGroup } from "./tag-taxonomy.ts";

/**
 * The filters the public supply preview accepts (issue #567). They are deliberately small and closed: the
 * landing asks about a role group and a place, and every value is one the catalog's own tags use, so a
 * stranger cannot make the server scan arbitrary columns.
 */
export const supplyQuerySchema = z.object({
  role: z.enum(ROLE_GROUPS).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  remote: z.enum(["1", "0", "true", "false"]).optional(),
  /** The radius around a resolved city; absent keeps an exact city match. */
  radius: z.enum(["25", "40", "80"]).optional(),
});

export type SupplyQuery = z.infer<typeof supplyQuerySchema>;

export interface SupplyFilters {
  role: RoleGroup | null;
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
    role: query.role ?? null,
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
