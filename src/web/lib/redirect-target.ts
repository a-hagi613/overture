/**
 * Builds a redirect target that keeps the caller's query string and hash.
 *
 * Query keys already present in `to` win, so a redirect can pin `view=calendar`
 * while the month, card or filter the person linked to still arrives.
 *
 * @param to The configured destination, which may carry its own query and hash.
 * @param location The current location's search and hash.
 * @returns The destination with both query strings merged and one hash.
 */
export function redirectTarget(to: string, location: { hash: string; search: string }) {
  const hashIndex = to.indexOf("#");
  const withoutHash = hashIndex === -1 ? to : to.slice(0, hashIndex);
  const toHash = hashIndex === -1 ? "" : to.slice(hashIndex);
  const queryIndex = withoutHash.indexOf("?");
  const path = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const toSearch = queryIndex === -1 ? "" : withoutHash.slice(queryIndex + 1);
  const merged = new URLSearchParams(toSearch);

  for (const [key, value] of new URLSearchParams(location.search)) {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }

  const query = merged.toString();
  const hash = toHash === "" ? location.hash : toHash;

  return `${path}${query === "" ? "" : `?${query}`}${hash}`;
}
