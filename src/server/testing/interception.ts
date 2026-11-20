import { readFileSync } from "node:fs";

import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";

import { env } from "../config/env.ts";
import { z } from "zod";

const turnstileVerifier = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const turnstileRecordingPath = "test/e2e/recordings/turnstile/siteverify-pass.json";

const recordedVerificationSchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  messages: z.array(z.string()).optional(),
});

const loopbackPassthrough = [
  http.get(/^http:\/\/127\.0\.0\.1:\d+\/.*/u, () => passthrough()),
  http.post(/^http:\/\/127\.0\.0\.1:\d+\/.*/u, () => passthrough()),
];

export function startInterception() {
  const anthropicRoot = env.ANTHROPIC_BASE_URL.replace(/\/+$/u, "");

  const recorded = recordedVerificationSchema.parse(
    JSON.parse(readFileSync(turnstileRecordingPath, "utf8")),
  );

  const server = setupServer(
    ...loopbackPassthrough,
    http.get(
      `${env.GREENHOUSE_FEED_BASE_URL ?? "https://boards-api.greenhouse.io"}/v1/boards/:token/jobs`,
      () => passthrough(),
    ),
    http.get(
      `${env.GREENHOUSE_FEED_BASE_URL ?? "https://boards-api.greenhouse.io"}/v1/boards/:token/jobs/:jobId`,
      () => passthrough(),
    ),
    http.get(`${env.LEVER_FEED_BASE_URL ?? "https://api.lever.co"}/v0/postings/:token`, () =>
      passthrough(),
    ),
    http.get(
      `${env.ASHBY_FEED_BASE_URL ?? "https://api.ashbyhq.com"}/posting-api/job-board/:token`,
      () => passthrough(),
    ),
    http.post(`${anthropicRoot}/v1/messages/batches`, () => passthrough()),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId`, () => passthrough()),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId/results`, () => passthrough()),
    http.post(turnstileVerifier, () => HttpResponse.json(recorded)),
  );

  server.listen({ onUnhandledRequest: "error" });
}
