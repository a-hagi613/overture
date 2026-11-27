import { useEffect, useState } from "react";

import { placeSuggestionsResponseSchema } from "../../shared/places.ts";
import type { PlaceSuggestion } from "../../shared/places.ts";

const PLACE_SUGGEST_DEBOUNCE_MS = 200;

async function loadPlaceSuggestions(search: string, signal: AbortSignal) {
  const trimmed = search.trim();
  const suffix = trimmed === "" ? "" : `?q=${encodeURIComponent(trimmed)}`;

  const response = await fetch(`/api/places/suggest${suffix}`, {
    headers: { accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Place lookup did not go through (${String(response.status)}).`);
  }

  return placeSuggestionsResponseSchema.parse(await response.json()).suggestions;
}

/**
 * Debounced place suggestions with stale requests cancelled. Every keystroke restarts the 200 ms timer and aborts the
 * request in flight, so a slow answer for "tor" can never replace the results for "toronto".
 * @param search The picker's current text.
 * @param enabled Whether the picker is open.
 * @returns The suggestions and whether a request is in flight.
 */
export function usePlaceSuggestions(search: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

    async function run() {
      setLoading(true);

      try {
        const next = await loadPlaceSuggestions(search, controller.signal);

        if (!controller.signal.aborted) {
          setSuggestions(next);
          setLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setLoading(false);
        }
      }
    }

    if (enabled) {
      timer = globalThis.setTimeout(() => {
        void run();
      }, PLACE_SUGGEST_DEBOUNCE_MS);
    }

    return () => {
      if (timer !== null) {
        globalThis.clearTimeout(timer);
      }

      controller.abort();
    };
  }, [enabled, search]);

  return { loading, suggestions };
}
