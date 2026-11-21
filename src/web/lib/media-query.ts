import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query against the viewport.
 *
 * @param query A CSS media query, for example `(min-width: 1280px)`.
 * @returns Whether the query currently matches.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => globalThis.matchMedia(query).matches);

  useEffect(() => {
    const list = globalThis.matchMedia(query);

    const onChange = () => {
      setMatches(list.matches);
    };

    onChange();
    list.addEventListener("change", onChange);

    return () => {
      list.removeEventListener("change", onChange);
    };
  }, [query]);

  return matches;
}
