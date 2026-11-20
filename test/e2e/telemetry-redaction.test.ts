import { z } from "zod";

import { expect, test } from "./app.fixture.ts";

const redactResponseSchema = z.object({
  redacted: z.record(z.string(), z.unknown()),
  allowlist: z.array(z.string()),
});

test("telemetry attributes outside the allowlist are dropped", async ({ appServerUrl }) => {
  const allowedKeys = ["http.method", "http.route", "http.status_code", "job.kind", "job.id"];
  const redactedKeys = ["user.email", "user.name", "answer.text", "letter.content"];

  const mixedAttributes = {
    "http.method": "GET",
    "http.route": "/api/health",
    "http.status_code": 200,
    "job.kind": "test.ping",
    "job.id": "abc-123",
    "user.email": "user@example.com",
    "user.name": "Alice",
    "answer.text": "my private answer",
    "letter.content": "cover letter here",
  };

  const attributeLookup = new Map(Object.entries(mixedAttributes));

  const response = await fetch(`${appServerUrl}/__test__/telemetry/redact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attributes: mixedAttributes }),
  });

  expect(response.ok).toBe(true);

  const { redacted, allowlist } = redactResponseSchema.parse(await response.json());

  for (const key of allowedKeys) {
    expect(allowlist.includes(key)).toBe(true);
    expect(redacted[key]).toBe(attributeLookup.get(key));
  }

  for (const key of redactedKeys) {
    expect(allowlist.includes(key)).toBe(false);
    expect(redacted[key]).toBe("[redacted]");
  }

  const healthResponse = await fetch(`${appServerUrl}/api/health`);

  expect(healthResponse.ok).toBe(true);
});
