export const CROSS_SITE_CODE = "cross_site_request";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function originOf(url: string) {
  return URL.canParse(url) ? new URL(url).origin : null;
}

/**
 * The defense-in-depth cross-site check for cookie-authenticated writes. A request that the browser itself marks
 * `Sec-Fetch-Site: cross-site`, or whose `Origin` is neither the app/admin origin nor the request's own origin, is
 * refused; a same-origin request passes, and a headless or server-to-server call that sends neither header is
 * permitted because it carries no ambient cookie authority of its own to abuse.
 * @param request The incoming request.
 * @param allowedOrigins The configured app and admin origins.
 * @returns A 403 response when the write is cross-site, or null when it may proceed.
 */
export function crossSiteRefusal(request: Request, allowedOrigins: readonly string[]) {
  if (safeMethods.has(request.method)) {
    return null;
  }

  const origin = request.headers.get("origin");

  if (origin === null) {
    return null;
  }

  const allowed = new Set([...allowedOrigins, originOf(request.url) ?? ""]);

  return allowed.has(origin) ? null : crossSiteResponse();
}

function crossSiteResponse() {
  return Response.json({ error: CROSS_SITE_CODE }, { status: 403 });
}
