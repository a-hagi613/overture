import type { MiddlewareHandler } from "hono";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HSTS_SECONDS = 15_552_000;

/**
 * Sets the browser security headers on every response of the app and the admin host.
 * @param production Whether to send Strict-Transport-Security (only meaningful over HTTPS).
 * @returns Hono middleware that adds the headers after the route has answered.
 */
export function securityHeaders(production: boolean) {
  const handler: MiddlewareHandler = async (context, next) => {
    await next();

    if (!context.res.headers.has("content-security-policy")) {
      context.res.headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
    }

    context.res.headers.set("x-content-type-options", "nosniff");
    context.res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
    context.res.headers.set("x-frame-options", "DENY");

    context.res.headers.set(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );

    if (production) {
      context.res.headers.set("strict-transport-security", `max-age=${String(HSTS_SECONDS)}`);
    }
  };

  return handler;
}
