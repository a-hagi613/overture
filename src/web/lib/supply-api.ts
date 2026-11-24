import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";

import { locationSuggestionsResponseSchema, supplyCountsSchema } from "../../shared/supply.ts";

const SUPPLY_TIMEOUT_MS = 5000;
const LOCATION_SUGGEST_DEBOUNCE_MS = 250;

export interface SupplyFilterInput {
  role: string | null;
  granularRole: string | null;
  location: string | null;
  radius?: string | null;
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

  if (filters.radius !== undefined && filters.radius !== null) {
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
      filters.radius ?? null,
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

async function loadLocationSuggestions(search: string) {
  const trimmed = search.trim();
  const suffix = trimmed === "" ? "" : `?q=${encodeURIComponent(trimmed)}`;

  const response = await fetch(`/api/supply/locations${suffix}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SUPPLY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Location lookup did not go through (${String(response.status)}).`);
  }

  return locationSuggestionsResponseSchema.parse(await response.json()).suggestions;
}

/**
 * Loads debounced global location autocomplete suggestions from `/api/supply/locations`.
 * @param search The raw query inside the location combobox search input.
 * @param enabled Whether the popover is currently open.
 * @returns Matched suggestions plus loading state.
 */
export function useLocationSuggestions(search: string, enabled: boolean) {
  const [debounced, setDebounced] = useState("");
  const trimmed = search.trim();
  const effectiveSearch = trimmed.length < 2 ? "" : debounced;

  useEffect(() => {
    const nextValue = trimmed.length < 2 ? "" : trimmed;
    const delay = trimmed.length < 2 ? 0 : LOCATION_SUGGEST_DEBOUNCE_MS;

    const timer = enabled
      ? globalThis.setTimeout(() => {
          setDebounced(nextValue);
        }, delay)
      : null;

    return () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }
    };
  }, [enabled, trimmed]);

  const query = useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => loadLocationSuggestions(effectiveSearch),
    queryKey: ["supply-locations", effectiveSearch],
    retry: false,
    staleTime: 300_000,
  });

  return {
    loading: query.isFetching,
    suggestions: query.data ?? [],
  };
}
