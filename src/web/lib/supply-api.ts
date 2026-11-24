import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { supplyCountsSchema } from "../../shared/supply.ts";

const SUPPLY_TIMEOUT_MS = 5000;

export interface SupplyFilterInput {
  role: string | null;
  granularRole: string | null;
  location: string | null;
  radius: string | null;
  remote: boolean;
}

const loadSupplyCounts = async (filters: SupplyFilterInput) => {
  const query = new URLSearchParams();

  if (filters.role !== null) {
    query.set("role", filters.role);
  }

  if (filters.granularRole !== null) {
    query.set("granularRole", filters.granularRole);
  }

  if (filters.location !== null) {
    query.set("location", filters.location);
  }

  if (filters.radius !== null) {
    query.set("radius", filters.radius);
  }

  if (filters.remote) {
    query.set("remote", "true");
  }

  const suffix = query.size === 0 ? "" : `?${query.toString()}`;

  const response = await fetch(`/api/supply${suffix}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SUPPLY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`The live supply count did not go through (${String(response.status)}).`);
  }

  return supplyCountsSchema.parse(await response.json());
};

/**
 * Reads the public `/api/supply` count for the landing widget. The previous count stays on screen while
 * a new filter loads, so changing a filter never flashes the empty state or shifts the layout.
 * @param filters The role, location and remote filters the visitor picked.
 * @returns The latest counts (null before the first answer), whether the request failed, and whether one
 * is in flight.
 */
export function useSupplyCounts(filters: SupplyFilterInput) {
  const hydrated = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const query = useQuery({
    enabled: hydrated,
    placeholderData: keepPreviousData,
    queryFn: async () => loadSupplyCounts(filters),
    queryKey: [
      "supply",
      filters.role,
      filters.granularRole,
      filters.location,
      filters.radius,
      filters.remote,
    ],
    retry: false,
    staleTime: 60_000,
  });

  return {
    counts: query.data ?? null,
    failed: query.isError,
    loading: query.isFetching,
    retry: () => {
      void query.refetch();
    },
  };
}
