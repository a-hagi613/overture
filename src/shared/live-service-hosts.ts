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
  "stripe.com",
] as const;

export const LIVE_SERVICE_DOMAINS: readonly string[] = [...ATS_DOMAINS, ...PAID_SERVICE_DOMAINS];

function normaliseHost(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/u, "");
}

function matchesDomain(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isLiveServiceHost(hostname: string) {
  const host = normaliseHost(hostname);

  return LIVE_SERVICE_DOMAINS.some((domain) => matchesDomain(host, domain));
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
