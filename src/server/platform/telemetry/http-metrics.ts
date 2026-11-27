import type { Context, MiddlewareHandler, Next } from "hono";
import { routePath } from "hono/route";

import { defaultMetrics, recordMetricSafely } from "./metrics.ts";

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
 * Picks the label for one request: Hono's matched route template when it has one, otherwise a
 * bounded constant. An unmatched path is never used as a label: internet scanners hit thousands of
 * random 404s (`/wp-login.php`, `/.env`, `/random-word-xyz`), and each raw pathname would become its
 * own Prometheus series in RAM and blow the scraper's cardinality cap.
 * @param matchedRoute Hono's `routePath`, which is `*` for an unmatched wildcard middleware.
 * @param status The final response status.
 * @returns `_unmatched` for a 404 on no matched route, `/*` for any other unmatched response, or the
 * bounded template of the matched route.
 */
export function routeLabel(matchedRoute: string | undefined, status: number) {
  if (
    matchedRoute !== undefined &&
    matchedRoute !== "" &&
    matchedRoute !== "*" &&
    matchedRoute !== "/*"
  ) {
    return normalizeRouteTemplate(matchedRoute);
  }

  return status === 404 ? "_unmatched" : "/*";
}

export function statusClassOf(status: number) {
  return `${String(Math.floor(status / 100))}xx`;
}

export interface HttpMetricSample {
  durationMs: number;
  method: string;
  route: string;
  statusClass: string;
}

type HttpMetricRecorder = (sample: HttpMetricSample) => void;

/**
 * Builds the request middleware around an injected recorder, so a test can observe the labels the
 * real Hono routing produces without a meter provider.
 * @param record Where each finished request's sample goes.
 * @returns The Hono middleware.
 */
export function createHttpRequestMetrics(record: HttpMetricRecorder) {
  const middleware: MiddlewareHandler = async (context: Context, next: Next) => {
    const startedAt = performance.now();
    let status = 500;

    try {
      await next();
      ({ status } = context.res);
    } finally {
      const { method } = context.req;

      record({
        durationMs: performance.now() - startedAt,
        method,
        route: routeLabel(routePath(context), status),
        statusClass: statusClassOf(status),
      });
    }
  };

  return middleware;
}

const httpRequestMetrics = createHttpRequestMetrics((sample) => {
  recordMetricSafely(() => {
    defaultMetrics().recordHttpRequest(sample);
  });
});

/**
 * Records `overture_http_requests_total` and `overture_http_duration_ms` for every request the
 * public app already serves. It runs after `next()` so the status is the final one, and never
 * changes the response.
 * @returns The Hono middleware.
 */
export function httpMetricsMiddleware() {
  return httpRequestMetrics;
}
