import type { MiddlewareHandler } from "hono";

import {
  BASE_SECURITY_HEADERS,
  CONTENT_SECURITY_POLICY,
  STRICT_TRANSPORT_SECURITY,
} from "../shared/security-headers.ts";

/**
 * Sets the browser security headers on every response of the app and the admin host.
 * @param production Whether to send Strict-Transport-Security (only meaningful over HTTPS).
 * @returns Hono middleware that adds the headers after the route has answered.
 */
export function securityHeaders(production: boolean) {
  const handler: MiddlewareHandler = async (context, next) => {
    await next();

    if (!context.res.headers.has("Content-Security-Policy")) {
      context.res.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }

    for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) {
      if (!context.res.headers.has(name)) {
        context.res.headers.set(name, value);
      }
    }

    if (production) {
      context.res.headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
    }
  };

  return handler;
}
