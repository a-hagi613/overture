import { readFileSync } from "node:fs";

import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";

import { env } from "../config/env.ts";
import { spendTurnstileToken, turnstileScenario } from "./turnstile-scenario.ts";
import { turnstileSiteverifyUrl } from "../auth/turnstile-gate.ts";
import { cloudflareSendEmailUrl } from "../platform/mail/cloudflare.ts";
import { recordCloudflareEmailRequest } from "./cloudflare-email-recorder.ts";
import { emailSendingScenario } from "./email-sending-scenario.ts";

const turnstileRecordingPath = "test/e2e/recordings/turnstile/siteverify-pass.json";

function recordedEmailSending(name: string) {
  return z
    .json()
    .parse(JSON.parse(readFileSync(`test/e2e/recordings/cloudflare-email/${name}.json`, "utf8")));
}

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
  const cloudflareRoot = env.CLOUDFLARE_EMAIL_API_BASE_URL.replace(/\/+$/u, "");
  const cloudflareZone = env.CLOUDFLARE_ZONE_ID ?? "unconfigured-zone";

  const server = setupServer(
    ...loopbackPassthrough,
    http.get(`${cloudflareRoot}/zones/${cloudflareZone}/email/sending/subdomains`, () => {
      const scenario = emailSendingScenario();

      if (scenario === "not-entitled") {
        return HttpResponse.json(recordedEmailSending("subdomains-not-entitled"), { status: 403 });
      }

      return HttpResponse.json(
        recordedEmailSending(
          scenario === "not-onboarded" ? "subdomains-empty" : "subdomains-ready",
        ),
      );
    }),
    http.get(`${cloudflareRoot}/zones/${cloudflareZone}/email/sending/subdomains/:tag/dns`, () =>
      HttpResponse.json(
        recordedEmailSending(
          emailSendingScenario() === "records-incomplete"
            ? "subdomain-dns-incomplete"
            : "subdomain-dns-ready",
        ),
      ),
    ),
    http.post(
      `${cloudflareRoot}/zones/${cloudflareZone}/email/sending/subdomains`,
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
            enabled: true,
            name: "tryoverture.com",
            tag: "aabbccdd11223344aabbccdd11223344",
            created: "2026-11-21T00:00:00Z",
            dkim_selector: "cf-bounce",
            drop_suppressed_recipients: false,
            modified: "2026-11-21T00:00:00Z",
            preview_enabled: true,
            return_path_domain: "cf-bounce.tryoverture.com",
          },
        });
      },
    ),
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
