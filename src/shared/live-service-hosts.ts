import { isSameHostOrSubdomain, normaliseHost } from "./host-match.ts";

const ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "personio.com",
  "personio.de",
  "smartrecruiters.com",
  "recruitee.com",
  "hiring.cafe",
] as const;

const PAID_SERVICE_DOMAINS = [
  "anthropic.com",
  "browser-use.com",
  "onkernel.com",
  "cloudflare.com",
  "cloudflarestorage.com",
  "grafana.net",
  "stripe.com",
] as const;

export const LIVE_SERVICE_DOMAINS: readonly string[] = [...ATS_DOMAINS, ...PAID_SERVICE_DOMAINS];

export function isLiveServiceHost(hostname: string) {
  return LIVE_SERVICE_DOMAINS.some((domain) => isSameHostOrSubdomain(hostname, domain));
}

export function isFixtureHost(hostname: string) {
  const host = normaliseHost(hostname);

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    host.endsWith(".invalid")
  );
}
