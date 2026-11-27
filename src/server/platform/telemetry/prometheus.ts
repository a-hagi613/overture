import { PrometheusExporter, PrometheusSerializer } from "@opentelemetry/exporter-prometheus";

import { logError } from "../log.ts";

const UNAVAILABLE_BODY = "metrics unavailable";

/**
 * A `PrometheusExporter` that never opens its own HTTP listener. Overture serves the scrape from its
 * own private `Bun.serve` listener (`:9091`, IPv6 `::`) so the public app port stays free of
 * `/metrics` (WS-21, issue #634).
 * @returns The reader the SDK collects through, and the scrape handler serializes.
 */
export function createPrometheusExporter() {
  return new PrometheusExporter({
    preventServerStart: true,
    withoutScopeInfo: true,
    withoutTargetInfo: false,
  });
}

/** The process-wide reader; `startTelemetry` attaches it to the SDK's meter provider. */
export const prometheusExporter = createPrometheusExporter();

/**
 * Collects the current metric snapshot and renders Prometheus text exposition format 0.0.4.
 * @param exporter The reader registered with the meter provider.
 * @param serializer The serializer; a fresh one per process is fine.
 * @returns The `/metrics` body.
 */
export async function renderPrometheus(
  exporter: PrometheusExporter = prometheusExporter,
  serializer: PrometheusSerializer = new PrometheusSerializer(
    undefined,
    false,
    undefined,
    false,
    true,
  ),
) {
  const { resourceMetrics } = await exporter.collect();

  return serializer.serialize(resourceMetrics);
}

export interface PrometheusMetricsHandlerOptions {
  exporter?: PrometheusExporter;
  /** Set false to disable the endpoint; the default is enabled. */
  enabled?: boolean;
  serialize?: () => Promise<string>;
}

/**
 * The only route the private metrics listener answers: `GET /metrics`. Everything else is a 404, and
 * a non-GET is a 405, so nothing but a scrape can reach this listener.
 * @param options The reader, an enable switch and an injectable serializer for tests.
 * @returns A Bun `fetch` handler.
 */
export function createPrometheusMetricsHandler(options: PrometheusMetricsHandlerOptions = {}) {
  const enabled = options.enabled ?? true;

  const serialize =
    options.serialize ??
    (options.exporter === undefined
      ? async () => renderPrometheus()
      : async () => renderPrometheus(options.exporter));

  return async (request: Request) => {
    const { pathname } = new URL(request.url);

    if (!enabled || pathname !== "/metrics") {
      return new Response("Not found", {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
        status: 404,
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
        status: 405,
      });
    }

    let body: string;

    try {
      body = await serialize();
    } catch (error) {
      logError("metrics.scrape", error);

      return new Response(UNAVAILABLE_BODY, {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
        status: 503,
      });
    }

    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
      status: 200,
    });
  };
}
