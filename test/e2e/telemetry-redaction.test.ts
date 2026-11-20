import { z } from "zod";

import { expect, test } from "./app.fixture.ts";
import { readSseEventUntil } from "./sse.ts";

const spansResponseSchema = z.object({
  spans: z.array(
    z.object({
      name: z.string(),
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
});

const enqueueResponseSchema = z.object({ id: z.string() });
const jobDoneSchema = z.object({ id: z.string() });

test("telemetry attributes outside the allowlist are dropped", async ({ appServerUrl }) => {
  await fetch(`${appServerUrl}/__test__/telemetry/reset`, { method: "POST" });

  const enqueueResponse = await fetch(`${appServerUrl}/__test__/jobs/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "test.otel",
      payload: JSON.stringify({
        "http.route": "/api/health",
        "user.email": "user@example.com",
        "job.kind": "test.otel",
      }),
    }),
  });

  expect(enqueueResponse.ok).toBe(true);

  const { id } = enqueueResponseSchema.parse(await enqueueResponse.json());

  const done = await readSseEventUntil(
    `${appServerUrl}/api/events`,
    null,
    (event) => event.event === "job.done" && jobDoneSchema.parse(JSON.parse(event.data)).id === id,
  );

  expect(done).not.toBeNull();

  const spansResponse = await fetch(`${appServerUrl}/__test__/telemetry/spans`);

  expect(spansResponse.ok).toBe(true);

  const { spans } = spansResponseSchema.parse(await spansResponse.json());

  const otelSpan = spans.find((s) => s.name === "test.otel.run");

  expect(otelSpan).toBeDefined();

  expect(otelSpan?.attributes["http.route"]).toBe("/api/health");
  expect(otelSpan?.attributes["job.kind"]).toBe("test.otel");
  expect(otelSpan?.attributes["user.email"]).toBe("[redacted]");
});
