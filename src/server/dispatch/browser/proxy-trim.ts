import type { BrowserContext } from "playwright-core";

const TRIMMED_RESOURCE_TYPES = new Set(["font", "image", "media"]);

export const CAPTCHA_HOSTS = [
  "arkoselabs.com",
  "captcha-delivery.com",
  "challenges.cloudflare.com",
  "funcaptcha.com",
  "geetest.com",
  "gstatic.com",
  "hcaptcha.com",
  "hcaptcha.net",
  "recaptcha.net",
] as const;

export const TRACKER_HOSTS = [
  "2o7.net",
  "adnxs.com",
  "adsrvr.org",
  "amplitude.com",
  "analytics.google.com",
  "analytics.twitter.com",
  "bat.bing.com",
  "bluekai.com",
  "casalemedia.com",
  "clarity.ms",
  "cloudflareinsights.com",
  "connect.facebook.net",
  "criteo.com",
  "criteo.net",
  "datadoghq.com",
  "demdex.net",
  "doubleclick.net",
  "exelator.com",
  "fullstory.com",
  "google-analytics.com",
  "googleadservices.com",
  "googlesyndication.com",
  "googletagmanager.com",
  "heap.io",
  "hotjar.com",
  "hotjar.io",
  "hs-analytics.net",
  "hs-banner.com",
  "hs-scripts.com",
  "krxd.net",
  "matomo.cloud",
  "mixpanel.com",
  "newrelic.com",
  "nr-data.net",
  "omtrdc.net",
  "openx.net",
  "outbrain.com",
  "plausible.io",
  "posthog.com",
  "pubmatic.com",
  "px.ads.linkedin.com",
  "quantserve.com",
  "rubiconproject.com",
  "scorecardresearch.com",
  "segment.com",
  "segment.io",
  "sentry.io",
  "snap.licdn.com",
  "static.ads-twitter.com",
  "taboola.com",
] as const;

function hostMatches(hostname: string, suffixes: readonly string[]) {
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

export function shouldTrimRequest(url: string, resourceType: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const { hostname } = parsed;

  if (hostMatches(hostname, CAPTCHA_HOSTS)) {
    return false;
  }

  return TRIMMED_RESOURCE_TYPES.has(resourceType) || hostMatches(hostname, TRACKER_HOSTS);
}

export async function applySendProxyTrim(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const request = route.request();

    if (shouldTrimRequest(request.url(), request.resourceType())) {
      await route.abort().catch(() => undefined);

      return;
    }

    await route.fallback();
  });
}
