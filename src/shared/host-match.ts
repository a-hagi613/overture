const TRAILING_DOT = /\.$/u;

/**
 * Normalises a host name for comparison.
 * @param hostname The host name as it arrived.
 * @returns The host trimmed, lower-cased and without a trailing root dot.
 */
export function normaliseHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(TRAILING_DOT, "");
}

/**
 * Whether a host is a domain itself or a subdomain of it. Both sides are
 * normalised first, and an empty domain never matches (so a missing company
 * domain cannot match every sender).
 * @param hostname The host name to test, such as a mail sender's domain.
 * @param domain The domain it may belong to.
 * @returns Whether the host is the domain or one of its subdomains.
 */
export function isSameHostOrSubdomain(hostname: string, domain: string) {
  const host = normaliseHost(hostname);
  const base = normaliseHost(domain);

  return base !== "" && (host === base || host.endsWith(`.${base}`));
}
