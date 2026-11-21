import { readFileSync } from "node:fs";

import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";

import { env } from "../config/env.ts";
import { spendTurnstileToken, turnstileScenario } from "./turnstile-scenario.ts";
import { turnstileSiteverifyUrl } from "../auth/turnstile-gate.ts";
import { cloudflareSendEmailUrl } from "../platform/mail/cloudflare.ts";
import { recordCloudflareEmailRequest } from "./cloudflare-email-recorder.ts";

const turnstileRecordingPath = "test/e2e/recordings/turnstile/siteverify-pass.json";

const recordedVerificationSchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
  messages: z.array(z.string()).optional(),
});

const loopbackPassthrough = [http.all(/^http:\/\/127\.0\.0\.1:\d+\/.*/u, () => passthrough())];

const recorded = recordedVerificationSchema.parse(
  JSON.parse(readFileSync(turnstileRecordingPath, "utf8")),
);

async function siteverifyResponse(request: Request) {
  const token = new URLSearchParams(await request.text()).get("response") ?? "";
  const scenario = turnstileScenario();

  if (scenario.outcome === "error") {
    return HttpResponse.json({ "error-codes": ["internal-error"] }, { status: 500 });
  }

  if (!spendTurnstileToken(token)) {
    return HttpResponse.json({
      ...recorded,
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    });
  }

  return HttpResponse.json({
    ...recorded,
    success: true,
    action: scenario.action,
    hostname: scenario.hostname,
    "error-codes": [],
  });
}

export function startInterception() {
  const anthropicRoot = env.ANTHROPIC_BASE_URL.replace(/\/+$/u, "");

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
      `${env.LEVER_FEED_BASE_URL ?? "https://api.lever.co"}/v0/postings/:token/:postingId`,
      () => passthrough(),
    ),
    http.get(`${env.LEVER_EU_FEED_BASE_URL ?? "https://api.eu.lever.co"}/v0/postings/:token`, () =>
      passthrough(),
    ),
    http.get(
      `${env.LEVER_EU_FEED_BASE_URL ?? "https://api.eu.lever.co"}/v0/postings/:token/:postingId`,
      () => passthrough(),
    ),
    http.get(
      `${env.ASHBY_FEED_BASE_URL ?? "https://api.ashbyhq.com"}/posting-api/job-board/:token`,
      () => passthrough(),
    ),
    http.post(`${anthropicRoot}/v1/messages/batches`, () => passthrough()),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId`, () => passthrough()),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId/results`, () => passthrough()),
    http.post(turnstileSiteverifyUrl, async ({ request }) => siteverifyResponse(request)),
    http.post(
      cloudflareSendEmailUrl(
        env.CLOUDFLARE_EMAIL_API_BASE_URL,
        env.CLOUDFLARE_ACCOUNT_ID ?? "unconfigured-account",
      ),
      async ({ request }) => {
        recordCloudflareEmailRequest({
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text(),
        });

        return HttpResponse.json({
          success: true,
          errors: [],
          messages: [],
          result: {
            message_id: "<cloudflare-email-send@tryoverture.com>",
            delivered: [],
            permanent_bounces: [],
            queued: [],
            suppressed_recipients: [],
          },
        });
      },
    ),
  );

  server.listen({ onUnhandledRequest: "error" });
}
