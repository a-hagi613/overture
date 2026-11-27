import { isIP } from "node:net";

import { isFixtureHost } from "../../shared/live-service-hosts.ts";

/** Why an Application's posting URL may not be opened in a browser. */
export type PostingUrlProblem = "insecure" | "unreadable";

function ipv4IsPrivate(address: string) {
  const parts = address.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return true;
  }

  const [first = 0, second = 0] = parts;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function ipv6IsPrivate(address: string) {
  const host = address.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();

  if (host === "" || host === "::" || host === "::1") {
    return true;
  }

  if (host.startsWith("fe80:") || host.startsWith("fec0:") || /^f[cd]/u.test(host)) {
    return true;
  }

  const mapped = /^::ffff:(?<address>\d{1,3}(?:\.\d{1,3}){3})$/u.exec(host)?.groups?.["address"];

  if (mapped !== undefined) {
    return ipv4IsPrivate(mapped);
  }

  const mappedHex = /^::ffff:(?<high>[0-9a-f]{1,4}):(?<low>[0-9a-f]{1,4})$/u.exec(host)?.groups;

  if (mappedHex === undefined) {
    return false;
  }

  const value = Number.parseInt(
    `${mappedHex["high"] ?? "0"}${(mappedHex["low"] ?? "0").padStart(4, "0")}`,
    16,
  );

  const octets = [16_777_216, 65_536, 256, 1].map((size) => Math.floor(value / size) % 256);

  return ipv4IsPrivate(octets.join("."));
}

/**
 * Whether a hostname is a special-use name that resolves only inside a local network: the loopback
 * names a browser process answers to, mDNS names and cloud metadata names. A posting URL must name a
 * public employer host, never one of these.
 * @param hostname The URL's hostname.
 * @returns True for a loopback, mDNS or internal-only name.
 */
export function isReservedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/u, "");

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

/**
 * Whether an address literal names a machine only the browser's own network can reach. A posting URL
 * is third-party data, so a loopback, link-local or private target is refused before a browser is
 * opened: a cloud browser on a provider network must never be aimed at its own metadata or LAN.
 * @param hostname The URL's hostname, possibly an IPv6 literal in brackets.
 * @returns True when the host is a private or reserved IPv4/IPv6 literal.
 */
export function isPrivateAddressLiteral(hostname: string) {
  const address = hostname.replace(/^\[/u, "").replace(/\]$/u, "");
  const version = isIP(address);

  if (version === 4) {
    return ipv4IsPrivate(address);
  }

  if (version === 6) {
    return ipv6IsPrivate(hostname);
  }

  return false;
}

/**
 * The check every send runs before it opens a browser. The URL Overture navigates to is third-party
 * data (the feed's posting or apply URL), so only an absolute `https:` address is dispatched; the
 * local fixture hosts keep `http:` for the e2e ATS servers, and only when the caller says this process
 * may reach fixtures at all. Embedded credentials, `javascript:`, `data:` and `file:` URLs, and
 * private-address literals are refused, so a malicious or corrupted catalog row can never aim the
 * browser at a local file, the provider's metadata service or an attacker-chosen plain-HTTP endpoint
 * that would receive the person's application.
 * @param value The posting or apply URL the approved plan will open.
 * @param options `allowFixtureHttp` permits a plain-http loopback fixture, as tests and local runs need.
 * @returns The problem, or null when a browser may open it.
 */
export function postingUrlProblem(value: string, options: { allowFixtureHttp?: boolean } = {}) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return "unreadable";
  }

  if (url.username !== "" || url.password !== "") {
    return "insecure";
  }

  if (
    url.protocol === "http:" &&
    options.allowFixtureHttp === true &&
    isFixtureHost(url.hostname)
  ) {
    return null;
  }

  if (url.protocol !== "https:") {
    return "insecure";
  }

  if (isReservedHostname(url.hostname)) {
    return "insecure";
  }

  return isPrivateAddressLiteral(url.hostname) ? "insecure" : null;
}
