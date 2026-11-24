import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import {
  BATCH_PROCESSOR_LIMITS,
  METRIC_EXPORT_INTERVAL_MILLIS,
  OTEL_METRIC_ATTRIBUTE_DENYLIST,
  RedactingLogExporter,
  RedactingSpanProcessor,
  stripUrlQueryAndFragment,
} from "./otel.ts";

const metricAttributeCallPattern =
  /\.(?:create(?:Counter|Histogram|UpDownCounter|ObservableGauge|ObservableCounter|ObservableUpDownCounter)|add|record|observe)\s*\(/gu;

function callText(source: string, openParenIndex: number) {
  let depth = 0;

  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openParenIndex, index + 1);
      }
    }
  }

  return source.slice(openParenIndex);
}

function metricAttributeViolations(source: string, file: string) {
  const violations: string[] = [];

  for (const match of source.matchAll(metricAttributeCallPattern)) {
    const call = callText(source, match.index + match[0].length - 1);

    for (const key of OTEL_METRIC_ATTRIBUTE_DENYLIST) {
      if (call.includes(`"${key}"`)) {
        violations.push(`${file}: ${key}`);
      }
    }
  }

  return violations;
}

test("http.url is recorded without its query string or fragment", () => {
  expect(stripUrlQueryAndFragment("/api/magic-link?token=secret")).toBe("/api/magic-link");
  expect(stripUrlQueryAndFragment("https://overture.test/search?q=acme%20corp")).toBe(
    "https://overture.test/search",
  );
  expect(stripUrlQueryAndFragment("https://overture.test/inbox#message-42")).toBe(
    "https://overture.test/inbox",
  );
  expect(stripUrlQueryAndFragment("/api/health")).toBe("/api/health");
  expect(stripUrlQueryAndFragment("https://overture.test/inbox#message?token=secret")).toBe(
    "https://overture.test/inbox",
  );
  expect(stripUrlQueryAndFragment("/callback?")).toBe("/callback");
});

test("an exported span loses the URL query and fragment", async () => {
  const memory = new InMemorySpanExporter();

  const provider = new BasicTracerProvider({
    spanProcessors: [new RedactingSpanProcessor(new SimpleSpanProcessor(memory))],
  });

  try {
    provider
      .getTracer("otel-test")
      .startSpan("test.url", {
        attributes: { "http.url": "/api/magic-link?token=secret#fragment" },
      })
      .end();

    const exported = memory.getFinishedSpans().find((candidate) => candidate.name === "test.url");

    expect(exported?.attributes["http.url"]).toBe("/api/magic-link");
  } finally {
    await provider.shutdown();
  }
});

test("an exported log record loses the URL query and fragment", async () => {
  const memory = new InMemoryLogRecordExporter();

  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: new RedactingLogExporter(memory) })],
  });

  try {
    provider.getLogger("otel-test").emit({
      attributes: { "http.url": "/api/search?q=acme%20corp#results" },
    });

    await provider.forceFlush();

    const [exported] = memory.getFinishedLogRecords();

    expect(exported?.attributes["http.url"]).toBe("/api/search");
  } finally {
    await provider.shutdown();
  }
});

test("metrics export once a minute", () => {
  expect(METRIC_EXPORT_INTERVAL_MILLIS).toBe(60_000);
});

test("span and log batches are bounded", () => {
  expect(BATCH_PROCESSOR_LIMITS).toEqual({
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 5000,
  });
});

test("the metric attribute scan catches a label passed when recording", () => {
  expect(metricAttributeViolations(`counter.add(1, { "job.id": "job_1" });`, "fixture.ts")).toEqual(
    ["fixture.ts: job.id"],
  );
  expect(
    metricAttributeViolations(`histogram.record(4, { "http.url": "/api/x" });`, "fixture.ts"),
  ).toEqual(["fixture.ts: http.url"]);
});

test("no metric caller attaches a high-cardinality identifier", () => {
  expect([...OTEL_METRIC_ATTRIBUTE_DENYLIST]).toEqual([
    "http.url",
    "job.id",
    "sse.user_id",
    "admin.target_user_id",
  ]);

  const serverRoot = join(import.meta.dir, "..", "..");
  const offenders: string[] = [];

  for (const file of new Bun.Glob("**/*.ts").scanSync({ cwd: serverRoot, onlyFiles: true })) {
    if (file.endsWith(".test.ts")) {
      continue;
    }

    const source = readFileSync(join(serverRoot, file), "utf8");

    offenders.push(...metricAttributeViolations(source, file));
  }

  expect(offenders).toEqual([]);
});
