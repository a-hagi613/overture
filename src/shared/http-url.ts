/**
 * Returns the value only when it is an absolute `http:` or `https:` URL.
 *
 * Anything else (a `javascript:` or `data:` URL, a relative path, a malformed string) becomes `null`, so a link
 * built from a stored Posting URL can never point somewhere the browser would run code or leave the site.
 * @param value The stored URL, possibly null.
 * @returns The canonical URL, or null when it is not safe to link to.
 */
export function safeHttpUrl(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
