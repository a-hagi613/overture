import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BATCH_PROCESSOR_LIMITS,
  METRIC_EXPORT_INTERVAL_MILLIS,
  OTEL_METRIC_ATTRIBUTE_DENYLIST,
  stripUrlQueryAndFragment,
} from "./otel.ts";

const metricInstrumentPattern =
  /\.create(?:Counter|Histogram|UpDownCounter|ObservableGauge|ObservableCounter|ObservableUpDownCounter)\s*\(/gu;

function instrumentCall(source: string, openParenIndex: number) {
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

test("no metric instrument attaches a high-cardinality identifier", () => {
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

    for (const match of source.matchAll(metricInstrumentPattern)) {
      const call = instrumentCall(source, match.index + match[0].length - 1);

      for (const key of OTEL_METRIC_ATTRIBUTE_DENYLIST) {
        if (call.includes(`"${key}"`)) {
          offenders.push(`${file}: ${key}`);
        }
      }
    }
  }

  expect(offenders).toEqual([]);
});
