import type { Context, MiddlewareHandler, Next } from "hono";
import { routePath } from "hono/route";

import { defaultMetrics } from "./metrics.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NUMERIC_PATTERN = /^\d+$/u;
const HASHED_PATTERN = /^[0-9a-f]{16,}$/iu;

/**
 * Collapses a pathname to a bounded template so a metric label can never carry a user-facing URL
 * with an identifier or a query string. `/api/applications/abc/status` becomes
 * `/api/applications/:id/status`; a numeric or hashed segment is also `:id`.
 * @param pathname The request path, already free of the query string.
 * @returns The template.
 */
export function normalizeRouteTemplate(pathname: string) {
  const segments = pathname.split("/");

  return segments
    .map((segment) =>
      segment !== "" &&
      (UUID_PATTERN.test(segment) || NUMERIC_PATTERN.test(segment) || HASHED_PATTERN.test(segment))
        ? ":id"
        : segment,
    )
    .join("/");
}

/**
 * Picks the label for one request: Hono's matched route template when it has one, otherwise the
 * normalized pathname. It never uses `request.url`, so a query string cannot reach a metric.
 * @param request The incoming request.
 * @param matchedRoute Hono's `routePath`, which is `*` for an unmatched wildcard middleware.
 * @returns The bounded route label.
 */
export function routeLabel(request: Request, matchedRoute: string | undefined) {
  if (
    matchedRoute !== undefined &&
    matchedRoute !== "" &&
    matchedRoute !== "*" &&
    matchedRoute !== "/*"
  ) {
    return normalizeRouteTemplate(matchedRoute);
  }

  return normalizeRouteTemplate(new URL(request.url).pathname);
}

export function statusClassOf(status: number) {
  return `${String(Math.floor(status / 100))}xx`;
}

const httpRequestMetrics: MiddlewareHandler = async (context: Context, next: Next) => {
  const startedAt = performance.now();
  let status = 500;

  try {
    await next();
    ({ status } = context.res);
  } finally {
    const { method } = context.req;

    defaultMetrics().recordHttpRequest({
      durationMs: performance.now() - startedAt,
      method,
      route: routeLabel(context.req.raw, routePath(context, -1)),
      statusClass: statusClassOf(status),
    });
  }
};

/**
 * Records `overture_http_requests_total` and `overture_http_duration_ms` for every request the
 * public app already serves. It runs after `next()` so the status is the final one, and never
 * changes the response.
 * @returns The Hono middleware.
 */
export function httpMetricsMiddleware() {
  return httpRequestMetrics;
}
