import { PRERENDERED_MARKETING_PATHS } from "../../../src/shared/marketing-paths.ts";

export const MARKETING_ZONE = "tryoverture.com";

function pageRoute(path: string) {
  if (path === "/") {
    return "/";
  }

  return `${path}*`;
}

export const MARKETING_ROUTE_PATHS = PRERENDERED_MARKETING_PATHS.map((path) => pageRoute(path));

export const MARKETING_ROUTE_PATTERNS = MARKETING_ROUTE_PATHS.map(
  (path) => `${MARKETING_ZONE}${path}`,
);

function compileRoute(pattern: string) {
  const path = pattern.slice(pattern.indexOf("/"));

  const escaped = path
    .replaceAll(/[.+?^${}()|[\]\\]/gu, String.raw`\$&`)
    .split("*")
    .join(".*");

  return new RegExp(`^${escaped}$`, "u");
}

const ROUTE_MATCHERS = MARKETING_ROUTE_PATTERNS.map((pattern) => compileRoute(pattern));

/**
 * Answers whether a request path (with or without its query string) is attached to the marketing
 * Worker. App and API paths must answer false: those requests go straight to Fly.
 * @param url The path, optionally followed by a query string.
 * @returns True when one of the configured Worker routes matches.
 */
export function matchesMarketingRoute(url: string) {
  return ROUTE_MATCHERS.some((matcher) => matcher.test(url));
}
