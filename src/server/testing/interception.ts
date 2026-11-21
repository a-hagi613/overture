import { readFileSync } from "node:fs";

import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { z } from "zod";

import { env } from "../config/env.ts";
import { assertNoLiveTraffic, LiveServiceRequestError } from "../platform/outbound-guard.ts";
import { isLiveServiceHost } from "../../shared/live-service-hosts.ts";
import {
  recordTurnstileRemoteIp,
  spendTurnstileToken,
  turnstileScenario,
} from "./turnstile-scenario.ts";
import { turnstileSiteverifyUrl } from "../auth/turnstile-gate.ts";
import { cloudflareSendEmailUrl } from "../platform/mail/cloudflare.ts";
import { recordCloudflareEmailRequest } from "./cloudflare-email-recorder.ts";
import { emailSendingScenario } from "./email-sending-scenario.ts";
import { pushResponseStatus, recordPushRequest } from "./push-recorder.ts";

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

const loopbackPassthrough = [
  http.all(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/.*/u, () => passthrough()),
];

function fixturePassthrough(request: Request) {
  assertNoLiveTraffic(request.url, request.method, env.NODE_ENV);

  return passthrough();
}

const recorded = recordedVerificationSchema.parse(
  JSON.parse(readFileSync(turnstileRecordingPath, "utf8")),
);

async function siteverifyResponse(request: Request) {
  const form = new URLSearchParams(await request.text());
  const token = form.get("response") ?? "";
  const scenario = turnstileScenario();

  recordTurnstileRemoteIp(form.get("remoteip"));

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
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.GREENHOUSE_FEED_BASE_URL ?? "https://boards-api.greenhouse.io"}/v1/boards/:token/jobs/:jobId`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.LEVER_FEED_BASE_URL ?? "https://api.lever.co"}/v0/postings/:token`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.LEVER_FEED_BASE_URL ?? "https://api.lever.co"}/v0/postings/:token/:postingId`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.LEVER_EU_FEED_BASE_URL ?? "https://api.eu.lever.co"}/v0/postings/:token`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.LEVER_EU_FEED_BASE_URL ?? "https://api.eu.lever.co"}/v0/postings/:token/:postingId`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${env.ASHBY_FEED_BASE_URL ?? "https://api.ashbyhq.com"}/posting-api/job-board/:token`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.post(`${anthropicRoot}/v1/messages/batches`, ({ request }) => fixturePassthrough(request)),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId`, ({ request }) =>
      fixturePassthrough(request),
    ),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId/results`, ({ request }) =>
      fixturePassthrough(request),
    ),
    http.post(
      `${(env.ASHBY_JOBS_BASE_URL ?? "https://jobs.ashbyhq.com").replace(/\/+$/u, "")}/api/non-user-graphql`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${(env.LEVER_JOBS_BASE_URL ?? "https://jobs.lever.co").replace(/\/+$/u, "")}/:board/:job/apply`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.get(
      `${(env.LEVER_EU_JOBS_BASE_URL ?? "https://jobs.eu.lever.co").replace(/\/+$/u, "")}/:board/:job/apply`,
      ({ request }) => fixturePassthrough(request),
    ),
    http.post(`${anthropicRoot}/v1/messages/batches`, ({ request }) => fixturePassthrough(request)),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId`, ({ request }) =>
      fixturePassthrough(request),
    ),
    http.get(`${anthropicRoot}/v1/messages/batches/:batchId/results`, ({ request }) =>
      fixturePassthrough(request),
    ),
    http.post(turnstileSiteverifyUrl, async ({ request }) => siteverifyResponse(request)),
    http.get(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/u, ({ request }) => {
      const prefix = new URL(request.url).pathname.split("/").at(-1) ?? "";

      const range =
        prefix === "CBFDA"
          ? "C6008F9CAB4083784CBD1874F76618D2A97:12000\n0000000000000000000000000000000000A:3\n"
          : "0000000000000000000000000000000000A:3\n";

      return new HttpResponse(range, { headers: { "content-type": "text/plain" } });
    }),
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
    http.post(/^https:\/\/push\.example\.test\/.+/u, async ({ request }) => {
      recordPushRequest({
        body: Buffer.from(await request.arrayBuffer()).toString("base64"),
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
      });

      return new HttpResponse(null, { status: pushResponseStatus(request.url) });
    }),
    http.all(
      ({ request }) => isLiveServiceHost(new URL(request.url).hostname),
      ({ request }) => {
        throw new LiveServiceRequestError(request.url, request.method, env.NODE_ENV);
      },
    ),
  );

  server.listen({ onUnhandledRequest: "error" });
}
