import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const spansResponseSchema = z.object({
  spans: z.array(
    z.object({
      name: z.string(),
      attributes: z.record(z.string(), z.unknown()),
    }),
  ),
});

const enqueueResponseSchema = z.object({ id: z.string() });
const runDueResponseSchema = z.object({ ran: z.number() });

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
  enqueueResponseSchema.parse(await enqueueResponse.json());

  const runResponse = await fetch(`${appServerUrl}/__test__/jobs/run-due`, { method: "POST" });

  expect(runResponse.ok).toBe(true);

  const { ran } = runDueResponseSchema.parse(await runResponse.json());

  expect(ran).toBe(1);

  const spansResponse = await fetch(`${appServerUrl}/__test__/telemetry/spans`);

  expect(spansResponse.ok).toBe(true);

  const { spans } = spansResponseSchema.parse(await spansResponse.json());

  const otelSpan = spans.find((s) => s.name === "test.otel.run");

  expect(otelSpan).toBeDefined();

  expect(otelSpan?.attributes["http.route"]).toBe("/api/health");
  expect(otelSpan?.attributes["job.kind"]).toBe("test.otel");
  expect(otelSpan?.attributes["user.email"]).toBe("[redacted]");
});
