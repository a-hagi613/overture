import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request as apiRequest, expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

import { INBOUND_HEADERS, signInbound } from "./inbound-mail.fixture.ts";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startFreshAppServer } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startTxtDnsServer } from "./dns.fixture.ts";
import { startIdentityServer } from "./identity-server-test.fixture.ts";
import { seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { readSseEventUntil } from "./sse.ts";

const secret = "live-check-inbound-hmac-secret-0123456789";
const signingDomain = "tryoverture.com";
const selector = "overture";
const liveCheckTo = "live-check@tryoverture.com";

const resultSchema = z.object({
  results: z.array(
    z.object({
      check: z.string(),
      ok: z.boolean(),
      startedAt: z.number(),
      durationMs: z.number(),
      detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
  ),
});

const mailRowsSchema = z.object({
  mail: z.array(
    z.object({
      id: z.string(),
      token: z.string(),
      code: z.string(),
      sentAt: z.number(),
      receivedAt: z.number().nullable(),
      auth: z.string().nullable(),
      resolvedAt: z.number().nullable(),
    }),
  ),
});

const sinkMailSchema = z.object({
  messages: z.array(z.object({ to: z.string(), subject: z.string(), body: z.string() })),
});

const drillSchema = z.object({
  raised: z.array(z.string()),
  results: z.array(z.object({ check: z.string(), ok: z.boolean() })),
});

const greenhousePage = `<!doctype html>
<html><body>
<form method="post" action="/apply">
  <label>First name <input type="text" name="first_name" /></label>
  <label>Email <input type="email" name="email" /></label>
  <label>Resume <input type="file" name="resume" /></label>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

const leverPage = `<!doctype html>
<html><body>
<form method="post" action="/apply">
  <label>Full name <input type="text" name="name" /></label>
  <label>Email <input type="email" name="email" /></label>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

const ashbyPage = `<!doctype html>
<html><body>
<form class="ashby-application-form" method="post" action="/apply">
  <label>Email <input id="_systemfield_email" type="email" name="_systemfield_email" /></label>
  <label>Name <input type="text" name="_systemfield_name" /></label>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

let app: AppServer | undefined;
let identity: Awaited<ReturnType<typeof startIdentityServer>> | undefined;
let anthropic: AnthropicFixtureServer | undefined;
let browserUse: BrowserUseFixture | undefined;
let dns: Awaited<ReturnType<typeof startTxtDnsServer>> | undefined;
let formServer: ReturnType<typeof Bun.serve> | undefined;
let api: APIRequestContext;
let privateKeyPem = "";
let submissions = 0;

const clockSchema = z.object({ now: z.number() });

function appUrl() {
  if (app === undefined) {
    throw new Error("The app server is not running.");
  }

  return app.url;
}

function identityServer() {
  if (identity === undefined) {
    throw new Error("The identity server is not running.");
  }

  return identity;
}

async function runJob(kind: string, payload: string, baseUrl = appUrl()) {
  const response = await fetch(`${baseUrl}/__test__/jobs/run-now`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });

  expect(response.ok).toBe(true);
}

async function liveCheckResults(baseUrl = appUrl()) {
  const response = await fetch(`${baseUrl}/__test__/live-checks`);

  expect(response.ok).toBe(true);

  return resultSchema.parse(await response.json()).results;
}

async function mailRows(baseUrl = appUrl()) {
  const response = await fetch(`${baseUrl}/__test__/live-checks/mail`);

  expect(response.ok).toBe(true);

  return mailRowsSchema.parse(await response.json()).mail;
}

async function sinkMail(baseUrl = appUrl()) {
  const response = await fetch(`${baseUrl}/__test__/mail`);

  expect(response.ok).toBe(true);

  return sinkMailSchema.parse(await response.json()).messages;
}

function serveForms() {
  return Bun.serve({
    port: 0,
    fetch(request) {
      if (request.method === "POST") {
        submissions += 1;

        return Response.json({ accepted: true });
      }

      const { pathname } = new URL(request.url);

      const pages = new Map([
        ["/greenhouse", greenhousePage],
        ["/lever", leverPage],
        ["/ashby", ashbyPage],
      ]);

      const page = pages.get(pathname);

      return page === undefined
        ? new Response("not found", { status: 404 })
        : new Response(page, { headers: { "content-type": "text/html" } });
    },
  });
}

async function seedCatalog(context = api) {
  await Promise.all(
    (["greenhouse", "lever", "ashby"] as const).map(async (ats) => {
      const companyId = await seedCompany(context, `Live Check ${ats}`, `${ats}.example`);
      const boardId = await seedBoard(context, companyId, ats, `live-check-${ats}`);

      await seedPosting(context, {
        ats,
        atsJobId: `live-check-${ats}-1`,
        boardId,
        companyId,
        title: `Live check ${ats}`,
        url: `http://127.0.0.1:${String(formServer?.port)}/${ats}`,
      });
    }),
  );
}

function rawCheckMail(code: string, token: string) {
  return [
    `From: no-reply@${signingDomain}`,
    `To: ${liveCheckTo}`,
    `Subject: Overture live check ${code}`,
    `Message-ID: <${crypto.randomUUID()}@${signingDomain}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Overture live check",
    "",
    `token: ${token}`,
    `code: ${code}`,
    "",
  ].join("\r\n");
}

async function signedMessage(raw: string) {
  const result = await dkimSign(raw, {
    signTime: new Date(),
    signatureData: [{ signingDomain, selector, privateKey: privateKeyPem }],
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.err.message).join("; "));
  }

  return `${result.signatures}${raw}`;
}

async function postInbound(raw: string) {
  const body = new TextEncoder().encode(raw);
  const clockResponse = await fetch(`${appUrl()}/__test__/clock`);
  const nowSeconds = Math.trunc(clockSchema.parse(await clockResponse.json()).now / 1000);
  const signed = await signInbound(secret, { body, rcptTo: liveCheckTo, timestamp: nowSeconds });

  return api.post(`${appUrl()}/internal/mail/inbound`, {
    headers: {
      [INBOUND_HEADERS.mailFrom]: `no-reply@${signingDomain}`,
      [INBOUND_HEADERS.rcptTo]: liveCheckTo,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      "content-type": "message/rfc822",
    },
    data: Buffer.from(body),
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(180_000);

  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  dns = await startTxtDnsServer({
    [`${selector}._domainkey.${signingDomain}`]: [
      `v=DKIM1; k=rsa; p=${Buffer.from(publicKey.export({ type: "spki", format: "der" })).toString("base64")}`,
    ],
  });

  anthropic = await startAnthropicFixtureServer();
  browserUse = startBrowserUseFixture();
  formServer = serveForms();
  identity = await startIdentityServer();

  app = await startFreshAppServer(identity, {
    ANTHROPIC_API_KEY: "live-check-test-key",
    ANTHROPIC_BASE_URL: anthropic.url,
    BROWSER_PROVIDER: "browser_use",
    BROWSER_PROXY_COUNTRY: "ca",
    BROWSER_USE_API_BASE_URL: browserUse.url,
    BROWSER_USE_API_KEY: "live-check-browser-use-key",
    INBOUND_DNS_SERVER: dns.server,
    INBOUND_HMAC_SECRET: secret,
    MAIL_DOMAIN: signingDomain,
  });

  api = await apiRequest.newContext({ baseURL: app.url });
});

test.afterAll(async () => {
  await api.dispose();
  await app?.stop();
  await identity?.stop();
  browserUse?.close();
  anthropic?.stop();
  await formServer?.stop(true);
  await dns?.stop();
});

test("the daily job captures one sample per ATS without submitting, calls Haiku and round-trips storage", async () => {
  await api.post("/__test__/catalog/postings/close-all", { data: {} });
  await seedCatalog();

  await runJob("live.check", JSON.stringify({ groups: ["forms", "llm", "r2", "alerts"] }));

  const results = await liveCheckResults();
  const byCheck = new Map(results.map((row) => [row.check, row]));

  for (const ats of ["greenhouse", "lever", "ashby"]) {
    expect(byCheck.get(`forms.${ats}`)?.ok).toBe(true);
    expect(byCheck.get(`forms.${ats}`)?.detail["formSignature"]).toMatch(/^[a-f0-9]{16,}$/u);
    expect(byCheck.get(`forms.${ats}`)?.durationMs).toBeGreaterThanOrEqual(0);
  }

  expect(byCheck.get("llm")?.ok).toBe(true);
  expect(byCheck.get("llm")?.detail["calls"]).toBe(4);
  expect(byCheck.get("r2")?.ok).toBe(true);
  expect(byCheck.get("alert.health")?.ok).toBe(true);
  expect(byCheck.get("alert.disk")?.ok).toBe(true);
  expect(byCheck.get("alert.backup.lag")?.ok).toBe(true);
  expect(submissions).toBe(0);
});

test("the mail check sends through the MailSender and passes only when it comes back with DKIM verified", async () => {
  const before = new Set((await mailRows()).map((row) => row.id));

  await runJob("live.check", JSON.stringify({ groups: ["mail"] }));

  const sentRow = (await mailRows()).find((row) => !before.has(row.id));

  if (sentRow === undefined) {
    throw new Error("The mail check did not record a sent message.");
  }

  const message = (await sinkMail()).findLast((mail) => mail.to === liveCheckTo);

  if (message === undefined) {
    throw new Error("The sink did not capture the check message.");
  }

  expect(message.subject).toContain(sentRow.code);

  const posted = await postInbound(await signedMessage(rawCheckMail(sentRow.code, sentRow.token)));

  expect(posted.status()).toBe(204);

  const received = (await mailRows()).find((row) => row.id === sentRow.id);

  expect(received?.auth).toBe("pass");
  expect(received?.receivedAt).not.toBeNull();

  await runJob("live.check.mail", JSON.stringify({ mailId: sentRow.id }));

  const result = (await liveCheckResults()).find(
    (row) => row.check === "mail" && row.detail["mailId"] === sentRow.id,
  );

  expect(result?.ok).toBe(true);
  expect(result?.detail["codeMatched"]).toBe(true);
  expect(result?.detail["auth"]).toBe("pass");
});

test("a check message that never comes back fails the mail check and alerts the owner", async () => {
  const before = new Set((await mailRows()).map((row) => row.id));

  await runJob("live.check", JSON.stringify({ groups: ["mail"] }));

  const sentRow = (await mailRows()).find((row) => !before.has(row.id));

  if (sentRow === undefined) {
    throw new Error("The mail check did not record a sent message.");
  }

  const alert = readSseEventUntil(`${appUrl()}/api/events`, null, (event) => {
    if (event.event !== "alert.raised") {
      return false;
    }

    const parsed = z
      .object({ kind: z.string(), detail: z.object({ check: z.string() }) })
      .safeParse(JSON.parse(event.data));

    return (
      parsed.success &&
      parsed.data.kind === "live.check.failure" &&
      parsed.data.detail.check === "mail"
    );
  });

  const expired = await fetch(`${appUrl()}/__test__/live-checks/mail/expire`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: sentRow.id }),
  });

  expect(expired.ok).toBe(true);

  await runJob("live.check.mail", JSON.stringify({ mailId: sentRow.id }));

  const result = (await liveCheckResults()).find(
    (row) => row.check === "mail" && row.detail["mailId"] === sentRow.id,
  );

  expect(result?.ok).toBe(false);
  expect(result?.detail["error"]).toContain("did not come back in time");
  expect(await alert).not.toBeNull();
});

test("a failing browser, Haiku and storage each record a failure instead of hiding it", async () => {
  const failingBrowser = Bun.serve({
    port: 0,
    fetch: () => Response.json({ detail: "upstream unavailable" }, { status: 500 }),
  });

  const failingAnthropic = Bun.serve({
    port: 0,
    fetch: () => Response.json({ type: "error" }, { status: 500 }),
  });

  const brokenApp = await startFreshAppServer(identityServer(), {
    ANTHROPIC_API_KEY: "live-check-failure-key",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${failingAnthropic.url.port}`,
    BROWSER_PROVIDER: "browser_use",
    BROWSER_USE_API_BASE_URL: `http://127.0.0.1:${failingBrowser.url.port}`,
    BROWSER_USE_API_KEY: "live-check-failure-browser-key",
    INBOUND_HMAC_SECRET: secret,
    MAIL_DOMAIN: signingDomain,
    OBJECT_STORE_ROOT: "/proc/overture-live-check-unwritable",
  });

  try {
    const brokenApi = await apiRequest.newContext({ baseURL: brokenApp.url });

    await seedCatalog(brokenApi);

    await runJob("live.check", JSON.stringify({ groups: ["forms", "llm", "r2"] }), brokenApp.url);

    const results = await liveCheckResults(brokenApp.url);
    const byCheck = new Map(results.map((row) => [row.check, row]));

    expect(byCheck.get("forms.greenhouse")?.ok).toBe(false);
    expect(byCheck.get("llm")?.ok).toBe(false);
    expect(byCheck.get("r2")?.ok).toBe(false);
    expect(byCheck.get("r2")?.detail["error"]).toBeTruthy();

    await brokenApi.dispose();
  } finally {
    await brokenApp.stop();
    await failingBrowser.stop(true);
    await failingAnthropic.stop(true);
  }
});

test("a degraded flag makes the storage check skip its R2 round trip and record why", async () => {
  const objectRoot = mkdtempSync(join(tmpdir(), "overture-degraded-"));

  const degradedApp = await startFreshAppServer(identityServer(), {
    OBJECT_STORE_ROOT: objectRoot,
  });

  mkdirSync(join(objectRoot, "ops"), { recursive: true });

  writeFileSync(
    join(objectRoot, "ops/degraded.json"),
    JSON.stringify({
      version: 1,
      degraded: true,
      since: "2026-11-21T15:00:00.000Z",
      metrics: [
        { metric: "r2.class_a_operations", used: 950_000, allowance: 1_000_000, share: 0.95 },
      ],
    }),
  );

  try {
    await runJob("live.check", JSON.stringify({ groups: ["r2"] }), degradedApp.url);

    const results = await liveCheckResults(degradedApp.url);
    const r2 = results.find((row) => row.check === "r2");

    expect(r2?.ok).toBe(true);
    expect(r2?.detail["skipped"]).toBe("degraded");
    expect(existsSync(join(objectRoot, "live-checks"))).toBe(false);

    const logged = await degradedApp.waitForStderr(/r2 live check skipped while degraded/u);

    expect(logged).toContain("non-essential write");
  } finally {
    await degradedApp.stop();
    rmSync(objectRoot, { recursive: true, force: true });
  }
});

test("every spec alert fires from the test-only drill route", async () => {
  const response = await fetch(`${appUrl()}/__test__/live-checks/drill`, { method: "POST" });

  expect(response.ok).toBe(true);

  const report = drillSchema.parse(await response.json());

  expect(report.raised.toSorted()).toEqual(
    [
      "ats.success",
      "backup.failure",
      "backup.lag",
      "catalog.worker",
      "code.challenge_rate",
      "disk",
      "health",
      "llm.spend",
      "mail.domain_reply_rate",
      "mail.reply_rate",
      "process.unhandled",
      "provider.success",
      "queue.age",
    ].toSorted(),
  );
  expect(report.results).toHaveLength(13);
});
