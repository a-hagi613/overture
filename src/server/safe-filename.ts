/**
 * Strips the characters that could break out of a `Content-Disposition` filename: quotes, backslashes and every
 * control character, including CR and LF. The result is trimmed, bounded and never empty, so the header always has a
 * filename (#278, Wave 4 security review).
 * @param filename The stored filename, which may have come from an upload.
 * @param fallback The name to use when nothing safe remains.
 * @returns A filename that is safe to place inside a quoted header value.
 */
export function safeFilename(filename: string, fallback = "attachment") {
  const cleaned = filename
    .replaceAll(/[\p{Cc}"\\]/gu, "")
    .trim()
    .slice(0, 180);

  return cleaned === "" ? fallback : cleaned;
}
