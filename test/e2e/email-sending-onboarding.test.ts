import { readFileSync } from "node:fs";

import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { serverEnvironment } from "./app-server.ts";
import { seedOwner } from "./matching-harness.ts";
import { readSseEventUntil } from "./sse.ts";

const token = "e2e-cloudflare-email-api-token";
const accountId = "e2e-cloudflare-account-id";
const zoneId = "e2e-cloudflare-zone-id";
const domain = "tryoverture.com";

const cloudflareEnvironment = {
  CLOUDFLARE_EMAIL_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_ZONE_ID: zoneId,
  MAIL_FROM: "no-reply@tryoverture.com",
} as const;

const liveCheckResultSchema = z.object({
  results: z.array(
    z.object({
      check: z.string(),
      ok: z.boolean(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
});

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

type FakeMode = "empty" | "ready" | "not-entitled" | "records-incomplete";

interface FakeDnsRecord {
  content: string;
  name: string;
  type: string;
}

interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

function recording(name: string) {
  return z
    .json()
    .parse(JSON.parse(readFileSync(`test/e2e/recordings/cloudflare-email/${name}.json`, "utf8")));
}

function startFakeCloudflare(mode: FakeMode, dnsRecords?: readonly FakeDnsRecord[]) {
  const calls: RecordedCall[] = [];
  let onboarded = mode === "ready" || mode === "records-incomplete";

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.text() : "";

      calls.push({ method: request.method, path: url.pathname, body });

      if (url.pathname.endsWith("/email/sending/subdomains")) {
        if (request.method === "POST") {
          onboarded = true;

          return Response.json(recording("subdomain-created"));
        }

        if (mode === "not-entitled" && !onboarded) {
          return Response.json(recording("subdomains-not-entitled"), { status: 403 });
        }

        return Response.json(recording(onboarded ? "subdomains-ready" : "subdomains-empty"));
      }

      if (url.pathname.endsWith("/dns")) {
        if (dnsRecords !== undefined) {
          return Response.json({ errors: [], messages: [], result: dnsRecords, success: true });
        }

        return Response.json(
          recording(
            mode === "records-incomplete" ? "subdomain-dns-incomplete" : "subdomain-dns-ready",
          ),
        );
      }

      return Response.json(
        { success: false, errors: [{ code: 7003, message: "no route" }], messages: [] },
        { status: 404 },
      );
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/client/v4`,
    calls,
    stop: async () => server.stop(true),
  };
}

async function runScript(baseUrl: string, args: string[]) {
  const child = Bun.spawn({
    cmd: ["bun", "run", "scripts/onboard-email-sending.ts", ...args],
    env: serverEnvironment({
      CLOUDFLARE_EMAIL_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_ZONE_ID: zoneId,
      CLOUDFLARE_EMAIL_API_BASE_URL: baseUrl,
      MAIL_DOMAIN: domain,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { stdout, stderr, exitCode };
}

async function runLiveCheck(
  baseUrl: string,
  request: APIRequestContext,
  groups: readonly string[],
) {
  const response = await request.post(`${baseUrl}/__test__/jobs/run-now`, {
    data: { kind: "live.check", payload: JSON.stringify({ groups }) },
  });

  expect(response.ok()).toBe(true);
}

async function liveCheckResults(baseUrl: string, request: APIRequestContext) {
  const response = await request.get(`${baseUrl}/__test__/live-checks`);

  expect(response.ok()).toBe(true);

  return liveCheckResultSchema.parse(await response.json()).results;
}

async function cloudflareRequests(baseUrl: string, request: APIRequestContext) {
  const response = await request.get(`${baseUrl}/__test__/cloudflare-email`);

  return cloudflareRequestListSchema.parse(await response.json()).requests;
}

function sends(requests: z.infer<typeof cloudflareRequestSchema>[]) {
  return requests.filter((entry) => entry.url.endsWith("/email/sending/send"));
}

const readyRecords = {
  dmarc: { content: "v=DMARC1; p=reject", name: "_dmarc.tryoverture.com", type: "TXT" },
  dkim: {
    content: "v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkq",
    name: "cf-bounce._domainkey.tryoverture.com",
    type: "TXT",
  },
  mx: { content: "route1.mx.cloudflare.net", name: "cf-bounce.tryoverture.com", type: "MX" },
  spf: {
    content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
    name: "cf-bounce.tryoverture.com",
    type: "TXT",
  },
} satisfies Record<string, FakeDnsRecord>;

const recordFormats: readonly { label: string; records: readonly FakeDnsRecord[] }[] = [
  {
    label: "quoted SPF and DKIM TXT strings",
    records: [
      readyRecords.mx,
      { ...readyRecords.spf, content: `"${readyRecords.spf.content}"` },
      { ...readyRecords.dkim, content: `"${readyRecords.dkim.content}"` },
      { ...readyRecords.dmarc, content: `"${readyRecords.dmarc.content}"` },
    ],
  },
  {
    label: "multi-segment quoted DKIM TXT strings",
    records: [
      readyRecords.mx,
      readyRecords.spf,
      { ...readyRecords.dkim, content: '"v=DKIM1; h=sha256; k=rsa;" "p=MIIBIjANBgkq"' },
      readyRecords.dmarc,
    ],
  },
  {
    label: "MX targets with a trailing dot and a leading priority",
    records: [
      { ...readyRecords.mx, content: "10 route1.mx.cloudflare.net." },
      { ...readyRecords.mx, content: "20 route2.mx.cloudflare.net." },
      readyRecords.spf,
      readyRecords.dkim,
      readyRecords.dmarc,
    ],
  },
  {
    label: "relative record names and mixed-case types",
    records: [
      { ...readyRecords.mx, name: "cf-bounce", type: " mx " },
      { ...readyRecords.spf, name: "cf-bounce" },
      { ...readyRecords.dkim, name: "cf-bounce._domainkey" },
      { ...readyRecords.dmarc, name: "_dmarc" },
    ],
  },
];

test.describe.configure({ mode: "serial" });

test("the operator script plans without writing, onboards once, is idempotent and verifies every record", async () => {
  const cloudflare = startFakeCloudflare("empty");

  try {
    const dryRun = await runScript(cloudflare.baseUrl, ["--dry-run"]);

    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain("would onboard the domain");
    expect(dryRun.stdout).toContain("no write request was sent");
    expect(cloudflare.calls.filter((call) => call.method === "POST")).toHaveLength(0);

    const first = await runScript(cloudflare.baseUrl, []);

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("onboarded tryoverture.com");
    expect(first.stdout).toContain("verdict: verified");
    expect(first.stdout).toContain("mx    cf-bounce.tryoverture.com ok");
    expect(first.stdout).toContain("spf   cf-bounce.tryoverture.com ok");
    expect(first.stdout).toContain("dkim  cf-bounce._domainkey.tryoverture.com ok");
    expect(first.stdout).toContain("dmarc _dmarc.tryoverture.com ok");

    const writes = cloudflare.calls.filter((call) => call.method === "POST");

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]?.body ?? "{}")).toEqual({ name: domain });

    const second = await runScript(cloudflare.baseUrl, []);

    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("action: none (already onboarded and enabled)");
    expect(cloudflare.calls.filter((call) => call.method === "POST")).toHaveLength(1);

    const check = await runScript(cloudflare.baseUrl, ["--check"]);

    const output = [dryRun, first, second, check]
      .map((run) => `${run.stdout}${run.stderr}`)
      .join("");

    expect(check.exitCode).toBe(0);
    expect(check.stdout).toContain("verdict: ready");
    expect(output).not.toContain(token);
  } finally {
    await cloudflare.stop();
  }
});

for (const format of recordFormats) {
  test(`the operator script verifies ${format.label}`, async () => {
    const cloudflare = startFakeCloudflare("ready", format.records);

    try {
      const check = await runScript(cloudflare.baseUrl, ["--check"]);

      expect(check.exitCode).toBe(0);
      expect(check.stdout).toContain("verdict: ready");
      expect(check.stdout).toContain("mx    cf-bounce.tryoverture.com ok");
      expect(check.stdout).toContain("spf   cf-bounce.tryoverture.com ok");
      expect(check.stdout).toContain("dkim  cf-bounce._domainkey.tryoverture.com ok");
      expect(check.stdout).toContain("dmarc _dmarc.tryoverture.com ok");
      expect(check.stdout).not.toContain("received records");
    } finally {
      await cloudflare.stop();
    }
  });
}

test("the guard fails with a clear message before the plan is paid and before DMARC is published", async () => {
  const notEntitled = startFakeCloudflare("not-entitled");

  try {
    const check = await runScript(notEntitled.baseUrl, ["--check"]);

    expect(check.exitCode).toBe(1);
    expect(`${check.stdout}${check.stderr}`).toContain("Workers Paid");
    expect(`${check.stdout}${check.stderr}`).toContain("not entitled");
    expect(`${check.stdout}${check.stderr}`).not.toContain(token);
  } finally {
    await notEntitled.stop();
  }

  const incomplete = startFakeCloudflare("records-incomplete");

  try {
    const check = await runScript(incomplete.baseUrl, ["--check"]);

    expect(check.exitCode).toBe(1);
    expect(`${check.stdout}${check.stderr}`).toContain("dmarc");
    expect(check.stdout).toContain("verdict: not ready");
    expect(check.stdout).toContain(
      "received records: MX cf-bounce.tryoverture.com; TXT cf-bounce.tryoverture.com; TXT cf-bounce._domainkey.tryoverture.com",
    );
    expect(check.stdout).not.toContain("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest");
  } finally {
    await incomplete.stop();
  }
});

test("the live check is gated before the switch, then verifies the sending domain and mails the reserved address", async ({
  identityServer,
  request,
}) => {
  test.setTimeout(180_000);

  const gated = await startFreshAppServer(identityServer, {
    CLOUDFLARE_EMAIL_API_TOKEN: "",
    CLOUDFLARE_ACCOUNT_ID: "",
    REQUIRE_EMAIL_SENDING: "false",
  });

  try {
    await runLiveCheck(gated.url, request, ["mail"]);

    const gatedSending = (await liveCheckResults(gated.url, request)).find(
      (result) => result.check === "mail.sending",
    );

    expect(gatedSending?.ok).toBe(true);
    expect(gatedSending?.detail["status"]).toBe("gated");
  } finally {
    await gated.stop();
  }

  const app = await startFreshAppServer(identityServer, {
    ...cloudflareEnvironment,
    REQUIRE_EMAIL_SENDING: "true",
    E2E_EMAIL_SENDING_SCENARIO: "ready",
  });

  const ownerSession = await seedOwner(app.url);

  try {
    await request.post(`${app.url}/__test__/cloudflare-email/clear`);
    await runLiveCheck(app.url, request, ["mail"]);

    const readySending = (await liveCheckResults(app.url, request)).find(
      (result) => result.check === "mail.sending",
    );

    expect(readySending?.ok).toBe(true);
    expect(readySending?.detail["status"]).toBe("ready");
    expect(readySending?.detail["mx"]).toBe(true);
    expect(readySending?.detail["spf"]).toBe(true);
    expect(readySending?.detail["dkim"]).toBe(true);
    expect(readySending?.detail["dmarc"]).toBe(true);
    expect(readySending?.detail["returnPathDomain"]).toBe("cf-bounce.tryoverture.com");

    const sent = sends(await cloudflareRequests(app.url, request));

    expect(sent).toHaveLength(1);

    const payload = sendEmailSchema.parse(JSON.parse(sent[0]?.body ?? "{}"));

    expect(payload.to).toEqual(["live-check@tryoverture.com"]);
    expect(payload.to).not.toContain(authTestIdentity.ownerEmail);

    const alert = readSseEventUntil(`${app.url}/__test__/events`, null, (event) => {
      if (event.event !== "alert.raised") {
        return false;
      }

      const parsed = z
        .object({ kind: z.string(), detail: z.object({ check: z.string() }) })
        .safeParse(JSON.parse(event.data));

      return (
        parsed.success &&
        parsed.data.kind === "live.check.failure" &&
        parsed.data.detail.check === "mail.sending"
      );
    });

    const scenario = await request.post(`${app.url}/__test__/cloudflare-email/sending-scenario`, {
      data: { scenario: "not-onboarded" },
    });

    expect(scenario.ok()).toBe(true);

    await runLiveCheck(app.url, request, ["mail"]);

    const failedSending = (await liveCheckResults(app.url, request)).find(
      (result) => result.check === "mail.sending" && !result.ok,
    );

    expect(failedSending?.detail["status"]).toBe("not-ready");
    expect(failedSending?.detail["error"]).toContain("not onboarded");
    expect(await alert).not.toBeNull();
    expect(sends(await cloudflareRequests(app.url, request))).toHaveLength(1);
  } finally {
    await ownerSession.owner.dispose();
    await app.stop();
  }
});
