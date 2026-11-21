import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
import { requestMagicLink, sinkMailCount } from "./sign-in.ts";

const MAGIC_LINK_SUBJECT = "Your Overture sign-in link";

const magicLinkBody = (url: string) =>
  `Open this link to sign in to Overture. It works once and expires in 15 minutes.\n\n${url}\n`;

const cloudflareEnvironment = {
  CLOUDFLARE_EMAIL_API_TOKEN: "e2e-cloudflare-email-api-token",
  CLOUDFLARE_ACCOUNT_ID: "e2e-cloudflare-account-id",
  MAIL_FROM: "no-reply@tryoverture.com",
} as const;

const sendUrl =
  "https://api.cloudflare.com/client/v4/accounts/e2e-cloudflare-account-id/email/sending/send";

const cloudflareRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});

const cloudflareRequestListSchema = z.object({ requests: z.array(cloudflareRequestSchema) });

const sendEmailSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
});

const magicLinkPattern = /(?<url>https?:\/\/\S+)/u;

async function cloudflareRequests(appServerUrl: string, request: APIRequestContext) {
  const response = await request.get(`${appServerUrl}/__test__/cloudflare-email`);

  return cloudflareRequestListSchema.parse(await response.json()).requests;
}

test("a magic-link request sends exactly one Cloudflare Email Sending request with the link", async ({
  request,
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, cloudflareEnvironment);

  try {
    await request.post(`${server.url}/__test__/cloudflare-email/clear`);

    const response = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(response.ok()).toBe(true);

    const calls = await cloudflareRequests(server.url, request);

    expect(calls).toHaveLength(1);

    const [call] = calls;

    if (call === undefined) {
      throw new Error("No Cloudflare Email Sending call was recorded.");
    }

    expect(call.method).toBe("POST");
    expect(call.url).toBe(sendUrl);

    const payload = sendEmailSchema.parse(JSON.parse(call.body));

    expect(payload.from).toBe("no-reply@tryoverture.com");
    expect(payload.to).toEqual([authTestIdentity.ownerEmail]);
    expect(payload.subject).toBe(MAGIC_LINK_SUBJECT);

    const link = magicLinkPattern.exec(payload.text)?.groups?.["url"];

    if (link === undefined) {
      throw new Error("The Cloudflare message carried no magic link.");
    }

    expect(link).toContain("/api/auth/magic-link/verify?token=");
    expect(payload.text).toBe(magicLinkBody(link));
    expect(call.headers["authorization"]).toBe(
      `Bearer ${cloudflareEnvironment.CLOUDFLARE_EMAIL_API_TOKEN}`,
    );
    expect(call.headers["content-type"]).toBe("application/json");
    expect(await sinkMailCount(server.url, request)).toBe(0);
  } finally {
    await server.stop();
  }
});

test("without Cloudflare variables the sink still carries the magic link", async ({
  request,
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, {
    CLOUDFLARE_EMAIL_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
  });

  try {
    await request.post(`${server.url}/__test__/cloudflare-email/clear`);

    const response = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(response.ok()).toBe(true);
    expect(await cloudflareRequests(server.url, request)).toHaveLength(0);
    expect(await sinkMailCount(server.url, request)).toBe(1);
  } finally {
    await server.stop();
  }
});

test("a half-set Cloudflare configuration stops the server at boot with a clear message", () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-cloudflare-email-boot-"));

  const tokenOnly = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      CLOUDFLARE_EMAIL_API_TOKEN: "e2e-cloudflare-email-api-token",
      CLOUDFLARE_ACCOUNT_ID: "",
      DATABASE_URL: join(directory, "token-only.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(tokenOnly.exitCode).not.toBe(0);
  expect(tokenOnly.stderr.toString()).toContain(
    "CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set together or not at all",
  );

  const accountOnly = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      CLOUDFLARE_EMAIL_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "e2e-cloudflare-account-id",
      DATABASE_URL: join(directory, "account-only.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(accountOnly.exitCode).not.toBe(0);
  expect(accountOnly.stderr.toString()).toContain(
    "CLOUDFLARE_EMAIL_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are set together or not at all",
  );
});
