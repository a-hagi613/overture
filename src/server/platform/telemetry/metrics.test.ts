import { expect, test } from "bun:test";

import { Hono } from "hono";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import { createPrometheusExporter, renderPrometheus } from "./prometheus.ts";
import {
  createMetrics,
  isDeniedMetricAttribute,
  llmCostUsd,
  METRIC_NAMES,
  sanitizeMetricAttributes,
} from "./metrics.ts";
import {
  createHttpRequestMetrics,
  normalizeRouteTemplate,
  routeLabel,
  statusClassOf,
} from "./http-metrics.ts";

async function scrape(run: (recorder: ReturnType<typeof createMetrics>) => void) {
  const exporter = createPrometheusExporter();

  const provider = new MeterProvider({
    readers: [exporter],
    resource: resourceFromAttributes({ "service.name": "overture-test" }),
  });

  try {
    const recorder = createMetrics(provider.getMeter("overture-test"));

    run(recorder);

    return await renderPrometheus(exporter);
  } finally {
    await provider.shutdown();
  }
}

test("every dashboard metric name is exported over the private scrape", async () => {
  const output = await scrape((recorder) => {
    recorder.recordHttpRequest({
      durationMs: 4,
      method: "GET",
      route: "/api/supply",
      statusClass: "2xx",
    });
    recorder.recordEventLoopLag(3);
    recorder.recordSqliteQuery({ db: "app", durationMs: 1, op: "select" });
    recorder.recordSupplyQuery(2);
    recorder.recordCatalogSwap({ bytes: 1024, durationMs: 9, postings: 12 });
    recorder.recordCatalogSwapFailure("checksum_mismatch");
    recorder.recordApplyAttempt({
      ats: "greenhouse",
      durationMs: 40,
      mode: "fresh",
      outcome: "sent",
    });
    recorder.recordFormSelfHeal({ ats: "lever", outcome: "healed" });
    recorder.recordLlmCall({
      cacheWriteTokens: 0,
      cachedTokens: 0,
      costMicros: 100,
      inputTokens: 10,
      model: "claude-haiku-5-5",
      outputTokens: 5,
      purpose: "tag_fallback",
      status: "ok",
    });
    recorder.recordMailEvent({ direction: "outbound", status: "sent" });
    recorder.recordBillingEvent({ event: "invoice.paid", plan: "month" });
    recorder.recordBgJob({ durationMs: 6, kind: "catalog.sweep", status: "done" });
    recorder.setBgQueueDepth("catalog.sweep", 3);
    recorder.setTagCoverageRatio("rules", 0.75);
  });

  for (const name of Object.values(METRIC_NAMES)) {
    expect(output).toContain(name);
  }

  expect(output).toContain("# HELP overture_http_requests_total");
  expect(output).toContain('route="/api/supply"');
  expect(output).toContain('status_class="2xx"');
  expect(output).toContain('kind="catalog.sweep"');
  expect(output).toContain('tier="rules"');
});

test("a denied identifier never reaches the scrape", async () => {
  const output = await scrape((recorder) => {
    recorder.recordHttpRequest({
      durationMs: 1,
      method: "GET",
      route: "/api/supply",
      statusClass: "2xx",
    });
    recorder.recordBillingEvent({ event: "invoice.paid", plan: "month" });
  });

  for (const leaked of ["user_id", "job_id", "http.url", "http_url", "email", "@example.com"]) {
    expect(output).not.toContain(leaked);
  }
});

test("the sanitizer drops identifiers and keeps bounded labels", () => {
  expect(
    sanitizeMetricAttributes({
      "http.url": "/api/magic-link?token=secret",
      user_id: "user_1",
      job_id: "job_1",
      email: "someone@example.com",
      route: "/api/supply",
      status_class: "2xx",
    }),
  ).toEqual({ route: "/api/supply", status_class: "2xx" });

  for (const key of ["user_id", "job_id", "http.url", "email", "USER_ID", "Job.Id"]) {
    expect(isDeniedMetricAttribute(key)).toBe(true);
  }

  expect(isDeniedMetricAttribute("ats")).toBe(false);
});

test("LLM cost follows the rate card in models.ts", () => {
  expect(
    llmCostUsd("claude-haiku-5-5", {
      cacheWriteTokens: 0,
      cachedTokens: 0,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
  ).toBeCloseTo(0.05 + 0.25);
});

test("route labels use bounded templates, never raw ids or scanner paths", () => {
  expect(normalizeRouteTemplate("/api/applications/42/status")).toBe(
    "/api/applications/:id/status",
  );
  expect(
    normalizeRouteTemplate("/api/applications/2f1c8d3e-aaaa-4bbb-8ccc-1234567890ab/ready"),
  ).toBe("/api/applications/:id/ready");
  expect(normalizeRouteTemplate("/api/supply")).toBe("/api/supply");

  expect(routeLabel("/api/supply", 200)).toBe("/api/supply");
  expect(routeLabel("/api/applications/:id/ready", 200)).toBe("/api/applications/:id/ready");
  expect(routeLabel(undefined, 404)).toBe("_unmatched");
  expect(routeLabel("", 404)).toBe("_unmatched");
  expect(routeLabel("*", 404)).toBe("_unmatched");
  expect(routeLabel("/*", 404)).toBe("_unmatched");
  expect(routeLabel("*", 200)).toBe("/*");
  expect(routeLabel(undefined, 500)).toBe("/*");
  expect(statusClassOf(204)).toBe("2xx");
  expect(statusClassOf(503)).toBe("5xx");
});

test("random scanner 404 paths collapse to the bounded _unmatched series", async () => {
  const samples: { method: string; route: string; statusClass: string }[] = [];
  const app = new Hono();

  app.use(
    "*",
    createHttpRequestMetrics((sample) => samples.push(sample)),
  );
  app.get("/api/supply", (context) => context.json({ ok: true }));
  app.all("*", (context) => context.text("Not found", 404));

  const responses = await Promise.all(
    ["/wp-login.php", "/.env", "/random-word-xyz", "/api/../../etc/passwd"].map(
      async (path) => await app.request(`https://overture.test${path}?probe=1`),
    ),
  );

  for (const response of responses) {
    expect(response.status).toBe(404);
  }

  const matched = await app.request("https://overture.test/api/supply");

  expect(matched.status).toBe(200);
  expect(samples.map((sample) => sample.route)).toEqual([
    "_unmatched",
    "_unmatched",
    "_unmatched",
    "_unmatched",
    "/api/supply",
  ]);
  expect(
    samples.every((sample) => sample.statusClass === "4xx" || sample.statusClass === "2xx"),
  ).toBe(true);
  expect(new Set(samples.map((sample) => sample.route)).size).toBe(2);
});
