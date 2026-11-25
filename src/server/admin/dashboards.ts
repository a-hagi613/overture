/**
 * The outside dashboards the admin console links to: Fly's Grafana and app pages, Cloudflare's
 * traffic, mail and web analytics, Stripe, Browser Use and the Anthropic console. Every link is
 * built from public identifiers (app name, account id, zone name); no secret leaves the server.
 */
export interface DashboardLink {
  id: string;
  group: "metrics" | "edge" | "spend";
  href: string;
}

export interface DashboardInputs {
  appOrigin: string | undefined;
  cloudflareAccountId: string | undefined;
  flyAppName: string | undefined;
  grafanaDashboardUrl: string | undefined;
  stripeLive: boolean;
}

/**
 * The zone name Cloudflare's dashboard paths use: the app origin's host without a leading `www.`.
 * @param appOrigin The public origin, such as `https://tryoverture.com`.
 * @returns The host, or null when the origin is missing or not a URL.
 */
export function zoneNameOf(appOrigin: string | undefined) {
  if (appOrigin === undefined) {
    return null;
  }

  try {
    return new URL(appOrigin).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}

/**
 * The dashboard links for this deployment. A link whose identifier is not configured is left out
 * rather than pointing somewhere generic.
 * @param inputs The deployment's public identifiers.
 * @returns The links, in display order.
 */
export function dashboardLinks(inputs: DashboardInputs) {
  const links: DashboardLink[] = [];
  const app = inputs.flyAppName;

  if (inputs.grafanaDashboardUrl !== undefined) {
    links.push({ group: "metrics", href: inputs.grafanaDashboardUrl, id: "grafana_overture" });
  }

  if (app !== undefined) {
    const encoded = encodeURIComponent(app);

    links.push(
      {
        group: "metrics",
        href: `https://fly-metrics.net/d/fly-app/fly-app?var-app=${encoded}`,
        id: "grafana_fly_app",
      },
      { group: "metrics", href: `https://fly.io/apps/${encoded}/monitoring`, id: "fly_monitoring" },
      { group: "metrics", href: `https://fly.io/apps/${encoded}/machines`, id: "fly_machines" },
    );
  }

  const zone = zoneNameOf(inputs.appOrigin);
  const account = inputs.cloudflareAccountId;

  if (account !== undefined) {
    const base = `https://dash.cloudflare.com/${encodeURIComponent(account)}`;

    if (zone !== null) {
      links.push(
        { group: "edge", href: `${base}/${zone}/analytics/traffic`, id: "cloudflare_traffic" },
        { group: "edge", href: `${base}/${zone}/security/analytics`, id: "cloudflare_security" },
        { group: "edge", href: `${base}/${zone}/email/routing/overview`, id: "cloudflare_email" },
      );
    }

    links.push({ group: "edge", href: `${base}/web-analytics`, id: "cloudflare_web_analytics" });
  }

  links.push(
    {
      group: "spend",
      href: inputs.stripeLive
        ? "https://dashboard.stripe.com/payments"
        : "https://dashboard.stripe.com/test/payments",
      id: "stripe",
    },
    { group: "spend", href: "https://cloud.browser-use.com/", id: "browser_use" },
    { group: "spend", href: "https://console.anthropic.com/usage", id: "anthropic" },
  );

  return links;
}
