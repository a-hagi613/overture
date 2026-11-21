import { createHash, createHmac } from "node:crypto";
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

const sesEnvironment = {
  AWS_ACCESS_KEY_ID: "e2e-ses-access-key-id",
  AWS_SECRET_ACCESS_KEY: "e2e-ses-secret-access-key",
  AWS_REGION: "ca-central-1",
  SES_CONFIGURATION_SET: "overture-outbound",
  MAIL_FROM: "no-reply@tryoverture.com",
} as const;

const sesRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.string(),
});

type SesRequestRecord = z.infer<typeof sesRequestSchema>;

const sesRequestListSchema = z.object({ requests: z.array(sesRequestSchema) });

const sendEmailSchema = z.object({
  FromEmailAddress: z.string(),
  Destination: z.object({ ToAddresses: z.array(z.string()) }),
  Content: z.object({
    Simple: z.object({
      Subject: z.object({ Data: z.string(), Charset: z.string() }),
      Body: z.object({ Text: z.object({ Data: z.string(), Charset: z.string() }) }),
    }),
  }),
  ConfigurationSetName: z.string().optional(),
});

const magicLinkPattern = /(?<url>https?:\/\/\S+)/u;

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function signatureFor(record: SesRequestRecord, secretAccessKey: string) {
  const url = new URL(record.url);
  const date = record.headers["x-amz-date"];
  const contentType = record.headers["content-type"];

  if (date === undefined || contentType === undefined) {
    throw new Error("The SES request is missing its signing headers.");
  }

  const payloadHash = sha256Hex(record.body);
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${date}`,
    "",
  ].join("\n");

  const canonicalRequest = [
    "POST",
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${date.slice(0, 8)}/ca-central-1/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, date.slice(0, 8)), "ca-central-1"), "ses"),
    "aws4_request",
  );

  return createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
}

async function sesRequests(appServerUrl: string, request: APIRequestContext) {
  const response = await request.get(`${appServerUrl}/__test__/ses`);

  return sesRequestListSchema.parse(await response.json()).requests;
}

test("a magic-link request sends exactly one signed SES SendEmail with the link", async ({
  request,
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, sesEnvironment);

  try {
    await request.post(`${server.url}/__test__/ses/clear`);

    const response = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(response.ok()).toBe(true);

    const calls = await sesRequests(server.url, request);

    expect(calls).toHaveLength(1);

    const [call] = calls;

    if (call === undefined) {
      throw new Error("No SES SendEmail call was recorded.");
    }

    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://email.ca-central-1.amazonaws.com/v2/email/outbound-emails");

    const payload = sendEmailSchema.parse(JSON.parse(call.body));

    expect(payload.FromEmailAddress).toBe("no-reply@tryoverture.com");
    expect(payload.Destination.ToAddresses).toEqual([authTestIdentity.ownerEmail]);
    expect(payload.Content.Simple.Subject.Data).toBe(MAGIC_LINK_SUBJECT);
    expect(payload.ConfigurationSetName).toBe("overture-outbound");

    const link = magicLinkPattern.exec(payload.Content.Simple.Body.Text.Data)?.groups?.["url"];

    if (link === undefined) {
      throw new Error("The SES message carried no magic link.");
    }

    expect(link).toContain("/api/auth/magic-link/verify?token=");
    expect(payload.Content.Simple.Body.Text.Data).toBe(magicLinkBody(link));
    expect(payload.Content.Simple.Body.Text.Charset).toBe("utf8");
    expect(call.headers["x-amz-content-sha256"]).toBe(sha256Hex(call.body));
    expect(call.headers["authorization"]).toBe(
      `AWS4-HMAC-SHA256 Credential=${sesEnvironment.AWS_ACCESS_KEY_ID}/${call.headers["x-amz-date"]?.slice(0, 8)}/ca-central-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=${signatureFor(call, sesEnvironment.AWS_SECRET_ACCESS_KEY)}`,
    );
    expect(await sinkMailCount(server.url, request)).toBe(0);
  } finally {
    await server.stop();
  }
});

test("without SES variables the sink still carries the magic link", async ({
  request,
  identityServer,
}) => {
  const server = await startFreshAppServer(identityServer, {
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_REGION: "",
    SES_CONFIGURATION_SET: "",
  });

  try {
    await request.post(`${server.url}/__test__/ses/clear`);

    const response = await requestMagicLink(server.url, request, authTestIdentity.ownerEmail);

    expect(response.ok()).toBe(true);
    expect(await sesRequests(server.url, request)).toHaveLength(0);
    expect(await sinkMailCount(server.url, request)).toBe(1);
  } finally {
    await server.stop();
  }
});

test("a half-set SES configuration stops the server at boot with a clear message", () => {
  const directory = mkdtempSync(join(tmpdir(), "overture-ses-boot-"));

  const partial = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      AWS_ACCESS_KEY_ID: "e2e-ses-access-key-id",
      AWS_SECRET_ACCESS_KEY: "e2e-ses-secret-access-key",
      AWS_REGION: "",
      DATABASE_URL: join(directory, "partial.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(partial.exitCode).not.toBe(0);
  expect(partial.stderr.toString()).toContain(
    "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION are set together or not at all",
  );

  const configSetOnly = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_REGION: "",
      SES_CONFIGURATION_SET: "overture-outbound",
      DATABASE_URL: join(directory, "config-set.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(configSetOnly.exitCode).not.toBe(0);
  expect(configSetOnly.stderr.toString()).toContain("SES_CONFIGURATION_SET needs");

  const wrongRegion = Bun.spawnSync({
    cmd: ["bun", "run", "src/server/main.ts"],
    env: serverEnvironment({
      AWS_ACCESS_KEY_ID: "e2e-ses-access-key-id",
      AWS_SECRET_ACCESS_KEY: "e2e-ses-secret-access-key",
      AWS_REGION: "us-east-1",
      DATABASE_URL: join(directory, "region.db"),
      ENABLE_TEST_ROUTES: "false",
    }),
  });

  expect(wrongRegion.exitCode).not.toBe(0);
  expect(wrongRegion.stderr.toString()).toContain("ca-central-1");
});
