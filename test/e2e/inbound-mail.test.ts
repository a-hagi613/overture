import { Buffer } from "node:buffer";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest, expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { dkimSign } from "mailauth";
import { z } from "zod";

import { INBOUND_HEADERS, forwardingLocalPart, signInbound } from "./inbound-mail.fixture.ts";

import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { startFreshAppServer } from "./app.fixture.ts";
import { startTxtDnsServer } from "./dns.fixture.ts";
import { startIdentityServer } from "./identity-server-test.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const secret = "e2e-inbound-hmac-secret-0123456789";
const signingDomain = "us.greenhouse-mail.io";
const selector = "overture";
const code = "A1B2C3D4";

const mailboxSchema = z.object({
  address: z.string(),
  forwardingWorks: z.boolean(),
  firstForwardedAt: z.number().nullable(),
});

const mailboxesSchema = z.object({
  mailboxes: z.array(
    z.object({
      id: z.string(),
      localPart: z.string(),
      status: z.string(),
      firstForwardedAt: z.number().nullable(),
    }),
  ),
});

const userSchema = z.object({ user: z.object({ id: z.string() }).nullable() });

const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  rfcMessageId: z.string(),
  inReplyTo: z.string().nullable(),
  senderDomain: z.string(),
  auth: z.string(),
  classification: z.string().nullable(),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  text: z.string(),
  snippet: z.string(),
  htmlObjectKey: z.string().nullable(),
  attachments: z.array(z.object({ id: z.string(), mime: z.string() })),
});

const messagesSchema = z.object({ messages: z.array(messageSchema) });

const threadsSchema = z.object({
  threads: z.array(
    z.object({
      id: z.string(),
      applicationId: z.string().nullable(),
      subject: z.string(),
      employerStarted: z.boolean(),
      lastMessageAt: z.number(),
    }),
  ),
});

const waitSchema = z.object({
  id: z.string(),
  mailboxId: z.string(),
  attemptId: z.string().nullable(),
  startedAt: z.number(),
  expiresAt: z.number(),
  resolvedAt: z.number().nullable(),
  resolvedBy: z.string().nullable(),
  code: z.string().nullable(),
});

const openWaitsSchema = z.object({ waits: z.array(z.object({ id: z.string() })) });
const pasteSchema = z.object({ id: z.string(), resolvedBy: z.string() });
const clockSchema = z.object({ now: z.number() });

let server: AppServer | undefined;
let identity: IdentityServer | undefined;
let dns: Awaited<ReturnType<typeof startTxtDnsServer>> | undefined;
let api: APIRequestContext;
let privateKeyPem = "";
let address = "";
let mailboxId = "";
let ackId = "";

test.describe.configure({ mode: "serial" });

function baseUrl() {
  if (server === undefined) {
    throw new Error("The app server is not running.");
  }

  return server.url;
}

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

async function sign(raw: string) {
  const result = await dkimSign(raw, {
    signTime: new Date("2026-11-19T15:00:00Z"),
    signatureData: [{ signingDomain, selector, privateKey: privateKeyPem }],
  });

  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.err.message).join("; "));
  }

  return `${result.signatures}${raw}`;
}

async function serverClockSeconds() {
  const response = await api.get(`${baseUrl()}/__test__/clock`);

  return Math.trunc(clockSchema.parse(await response.json()).now / 1000);
}

async function postInbound(
  raw: string,
  rcptTo: string,
  options: { timestamp?: number; signature?: string } = {},
) {
  const body = new TextEncoder().encode(raw);
  const timestamp = options.timestamp ?? (await serverClockSeconds());
  const signed = await signInbound(secret, { timestamp, rcptTo, body });

  return api.post(`${baseUrl()}/internal/mail/inbound`, {
    headers: {
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: options.signature ?? signed.signature,
      [INBOUND_HEADERS.rcptTo]: rcptTo,
      [INBOUND_HEADERS.mailFrom]: "owner@forwarder.test",
      "content-type": "message/rfc822",
    },
    data: Buffer.from(body),
  });
}

async function runDueJobs() {
  return api.post(`${baseUrl()}/__test__/jobs/run-due`);
}

async function storedMessages() {
  const response = await api.get(
    `${baseUrl()}/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`,
  );

  return messagesSchema.parse(await response.json()).messages;
}

async function messagesFor(id: string) {
  const response = await api.get(
    `${baseUrl()}/__test__/mail/messages?mailboxId=${encodeURIComponent(id)}`,
  );

  return messagesSchema.parse(await response.json()).messages;
}

async function readMailbox() {
  const response = await api.get(`${baseUrl()}/api/profile/mailbox`);

  return mailboxSchema.parse(await response.json());
}

async function mailboxesFor(userId: string) {
  const response = await api.get(
    `${baseUrl()}/__test__/mailboxes?userId=${encodeURIComponent(userId)}`,
  );

  return mailboxesSchema.parse(await response.json()).mailboxes;
}

async function setMailboxStatus(id: string, status: "active" | "receive_only" | "closed") {
  return api.post(`${baseUrl()}/__test__/mailboxes/${id}/status`, { data: { status } });
}

async function createWait() {
  const response = await api.post(`${baseUrl()}/__test__/mail/code-waits`, {
    data: { mailboxId, attemptId: crypto.randomUUID() },
  });

  return waitSchema.parse(await response.json());
}

async function readWait(id: string) {
  const response = await api.get(`${baseUrl()}/__test__/mail/code-waits/${id}`);

  return waitSchema.parse(await response.json());
}

async function openWaits() {
  const signed = await signInbound(secret, {
    timestamp: await serverClockSeconds(),
    rcptTo: address,
    body: new Uint8Array(0),
  });

  const response = await api.get(`${baseUrl()}/internal/mail/code-waits`, {
    headers: {
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: address,
    },
  });

  expect(response.status()).toBe(200);

  return openWaitsSchema.parse(await response.json()).waits;
}

async function pasteCode(waitId: string, value: string) {
  return api.post(`${baseUrl()}/api/mail/code-waits/${waitId}`, { data: { code: value } });
}

test.beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });

  privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const record = `v=DKIM1; k=rsa; p=${Buffer.from(publicDer).toString("base64")}`;

  dns = await startTxtDnsServer({
    [`${selector}._domainkey.${signingDomain}`]: [record],
  });

  identity = await startIdentityServer();
  server = await startFreshAppServer(identity, {
    INBOUND_HMAC_SECRET: secret,
    MAIL_DOMAIN: "tryoverture.com",
    INBOUND_DNS_SERVER: dns.server,
  });

  api = await apiRequest.newContext();

  await requestMagicLink(server.url, api, authTestIdentity.ownerEmail);

  const link = await latestMailLink(server.url, api, authTestIdentity.ownerEmail);

  await api.get(link);

  const meResponse = await api.get(`${server.url}/api/me`);
  const me = userSchema.parse(await meResponse.json());

  if (me.user === null) {
    throw new Error("The owner is not signed in.");
  }

  const owned = await api.get(`${server.url}/__test__/mailboxes?userId=${me.user.id}`);
  const { mailboxes: created } = mailboxesSchema.parse(await owned.json());
  const [mailboxRow] = created;

  if (mailboxRow === undefined || created.length !== 1) {
    throw new Error("The new account did not get exactly one forwarding address.");
  }

  address = `${mailboxRow.localPart}@tryoverture.com`;
  mailboxId = mailboxRow.id;
});

test.afterAll(async () => {
  await api.dispose();

  if (server !== undefined) {
    await server.stop();
  }

  if (identity !== undefined) {
    await identity.stop();
  }

  if (dns !== undefined) {
    await dns.stop();
  }
});

test("a new account has one address, and its first forwarded ATS message records that forwarding works", async () => {
  const meResponse = await api.get(`${baseUrl()}/api/me`);
  const me = userSchema.parse(await meResponse.json());

  if (me.user === null) {
    throw new Error("The owner is not signed in.");
  }

  const owned = await mailboxesFor(me.user.id);

  expect(owned).toHaveLength(1);
  expect(owned[0]?.localPart).toBe(address.split("@")[0]);
  expect(owned[0]?.status).toBe("active");
  expect(owned[0]?.firstForwardedAt).toBeNull();

  const before = await readMailbox();

  expect(before.address).toBe(address);
  expect(before.forwardingWorks).toBe(false);
  expect(before.firstForwardedAt).toBeNull();

  ackId = crypto.randomUUID();

  const ack = fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", ackId);
  const posted = await postInbound(await sign(ack), address);

  expect(posted.status()).toBe(204);

  await runDueJobs();
  await expect.poll(async () => (await storedMessages()).length).toBe(1);

  const [first] = await storedMessages();

  if (first === undefined) {
    throw new Error("The signed message was not stored.");
  }

  expect(first.auth).toBe("pass");
  expect(first.classification).toBe("ack");
  expect(first.senderDomain).toBe(signingDomain);
  expect(first.subject).toBe("Your application to Acme");
  expect(first.from).toContain("no-reply@us.greenhouse-mail.io");
  expect(first.to).toContain("in-forward@tryoverture.com");
  expect(first.text).toContain("Thank you for applying to Acme.");
  expect(first.snippet).toBe(first.text.replaceAll(/\s+/gu, " ").trim().slice(0, 200));
  expect(first.snippet).not.toContain("\n");
  expect(first.htmlObjectKey).toBeNull();
  expect(first.attachments).toHaveLength(0);

  const after = await readMailbox();

  expect(after.address).toBe(address);
  expect(after.forwardingWorks).toBe(true);
  expect(after.firstForwardedAt).not.toBeNull();

  const threadsResponse = await api.get(
    `${baseUrl()}/__test__/mail/threads?mailboxId=${encodeURIComponent(mailboxId)}`,
  );

  const { threads } = threadsSchema.parse(await threadsResponse.json());

  expect(threads).toHaveLength(1);
  expect(threads[0]?.id).toBe(first.threadId);
  expect(threads[0]?.subject).toBe("Your application to Acme");
  expect(threads[0]?.employerStarted).toBe(true);

  const codeMessage = fixture("greenhouse-code.eml")
    .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
    .replaceAll("__ACK_ID__", ackId);

  const codePosted = await postInbound(await sign(codeMessage), address);

  expect(codePosted.status()).toBe(204);

  await runDueJobs();
  await expect.poll(async () => (await storedMessages()).length).toBe(2);

  const [, second] = await storedMessages();

  if (second === undefined) {
    throw new Error("The signed code message was not stored.");
  }

  expect(second.threadId).toBe(first.threadId);
  expect(second.inReplyTo).toBe(`<ack.${ackId}@${signingDomain}>`);
  expect(second.auth).toBe("pass");
  expect(second.classification).toBe("code");
});

test("a forged signature and a stale timestamp are refused", async () => {
  const before = (await storedMessages()).length;

  const raw = await sign(
    fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", crypto.randomUUID()),
  );

  const forged = await postInbound(raw, address, { signature: "0".repeat(64) });

  expect(forged.status()).toBe(401);

  const stale = await postInbound(raw, address, {
    timestamp: (await serverClockSeconds()) - 3600,
  });

  expect(stale.status()).toBe(401);
  expect((await storedMessages()).length).toBe(before);
});

test("an unknown forwarding address stores nothing", async () => {
  const before = (await storedMessages()).length;
  const localPart = await forwardingLocalPart(secret, "unknown1234567890");
  const unknownAddress = `${localPart}@tryoverture.com`;

  const raw = await sign(
    fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", crypto.randomUUID()),
  );

  const posted = await postInbound(raw, unknownAddress);

  expect(posted.status()).toBe(204);
  expect((await storedMessages()).length).toBe(before);

  await runDueJobs();
  expect((await storedMessages()).length).toBe(before);

  const signed = await signInbound(secret, {
    timestamp: await serverClockSeconds(),
    rcptTo: unknownAddress,
    body: new Uint8Array(0),
  });

  const read = await api.get(`${baseUrl()}/internal/mail/code-waits`, {
    headers: {
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: unknownAddress,
    },
  });

  expect(read.status()).toBe(404);
});

test("a forged MAC or another domain for an existing mailbox stores nothing", async () => {
  const before = (await storedMessages()).length;
  const forged = `in-${mailboxId}-0000000000@tryoverture.com`;
  const foreign = `${address.split("@")[0] ?? ""}@elsewhere.test`;

  const raw = await sign(
    fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", crypto.randomUUID()),
  );

  expect((await postInbound(raw, forged)).status()).toBe(204);
  expect((await postInbound(raw, foreign)).status()).toBe(204);

  await runDueJobs();
  expect((await storedMessages()).length).toBe(before);
});

test("a closed address is discarded and a receive-only one never resolves a code", async () => {
  const before = (await storedMessages()).length;

  const raw = await sign(
    fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", crypto.randomUUID()),
  );

  expect((await setMailboxStatus(mailboxId, "closed")).status()).toBe(200);
  expect((await postInbound(raw, address)).status()).toBe(204);

  await runDueJobs();
  expect((await storedMessages()).length).toBe(before);

  expect((await setMailboxStatus(mailboxId, "receive_only")).status()).toBe(200);

  const wait = await createWait();

  const codeMessage = await sign(
    fixture("greenhouse-code.eml")
      .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
      .replaceAll("__ACK_ID__", ackId),
  );

  expect((await postInbound(codeMessage, address)).status()).toBe(204);

  await runDueJobs();
  await expect.poll(async () => (await storedMessages()).length).toBe(before + 1);

  const storedWait = await readWait(wait.id);

  expect(storedWait.resolvedAt).toBeNull();
  expect(storedWait.resolvedBy).toBeNull();

  const pasted = await pasteCode(wait.id, "Q1W2E3R4");

  expect(pasted.status()).toBe(200);
  expect((await setMailboxStatus(mailboxId, "active")).status()).toBe(200);
});

test("mail for another user's address is ingested for that user only", async () => {
  const ownerBefore = (await storedMessages()).length;

  const created = await api.post(`${baseUrl()}/__test__/users`, {
    data: { email: "burner@example.com", name: "Burner" },
  });

  const { id: burnerId } = z.object({ id: z.string() }).parse(await created.json());
  const burners = await mailboxesFor(burnerId);

  expect(burners).toHaveLength(1);

  const [burner] = burners;

  if (burner === undefined) {
    throw new Error("The second user got no forwarding address.");
  }

  expect(burner.status).toBe("active");
  expect(burner.localPart).not.toBe(address.split("@")[0]);

  const raw = await sign(
    fixture("greenhouse-ack.eml").replaceAll("__MESSAGE_ID__", crypto.randomUUID()),
  );

  const posted = await postInbound(raw, `${burner.localPart}@tryoverture.com`);

  expect(posted.status()).toBe(204);

  await runDueJobs();
  await expect.poll(async () => (await messagesFor(burner.id)).length).toBe(1);
  expect((await storedMessages()).length).toBe(ownerBefore);

  const [stored] = await messagesFor(burner.id);

  expect(stored?.auth).toBe("pass");
});

test("unauthenticated mail is stored and labelled but never used for a code", async () => {
  const wait = await createWait();

  const messageId = crypto.randomUUID();

  const raw = fixture("greenhouse-code.eml")
    .replaceAll("__MESSAGE_ID__", messageId)
    .replaceAll("__ACK_ID__", ackId);

  const posted = await postInbound(raw, address);

  expect(posted.status()).toBe(204);

  await runDueJobs();
  await expect
    .poll(async () =>
      (await storedMessages()).some((message) => message.rfcMessageId.includes(messageId)),
    )
    .toBe(true);

  const stored = (await storedMessages()).find((message) =>
    message.rfcMessageId.includes(messageId),
  );

  if (stored === undefined) {
    throw new Error("The unauthenticated message was not stored.");
  }

  expect(stored.auth).toBe("none");
  expect(stored.classification).toBe("code");
  expect(stored.text).toContain(code);
  expect((await readWait(wait.id)).resolvedAt).toBeNull();

  const open = await openWaits();

  expect(open.map((entry) => entry.id)).toContain(wait.id);

  const pasted = await pasteCode(wait.id, "Q1W2E3R4");

  expect(pasted.status()).toBe(200);
  expect(pasteSchema.parse(await pasted.json()).resolvedBy).toBe("paste");

  const resolved = await readWait(wait.id);

  expect(resolved.resolvedBy).toBe("paste");
  expect(resolved.code).toBe("Q1W2E3R4");
  expect((await openWaits()).map((entry) => entry.id)).not.toContain(wait.id);
});

test("a signed code resolves a waiting attempt and wakes it", async () => {
  const wait = await createWait();
  const before = (await storedMessages()).length;

  const raw = await sign(
    fixture("greenhouse-code.eml")
      .replaceAll("__MESSAGE_ID__", crypto.randomUUID())
      .replaceAll("__ACK_ID__", ackId),
  );

  const posted = await postInbound(raw, address);

  expect(posted.status()).toBe(204);

  await runDueJobs();
  await expect.poll(async () => (await storedMessages()).length).toBe(before + 1);

  const resolved = await readWait(wait.id);

  expect(resolved.resolvedBy).toBe("mail");
  expect(resolved.code).toBe(code);
  expect(resolved.resolvedAt).not.toBeNull();
  expect((await openWaits()).map((entry) => entry.id)).not.toContain(wait.id);
});

test("an expired wait refuses a paste", async () => {
  const wait = await createWait();

  await api.post(`${baseUrl()}/__test__/clock/offset`, {
    data: { offsetMs: 11 * 60_000 },
  });

  const pasted = await pasteCode(wait.id, "Z9Y8X7W6");

  expect(pasted.status()).toBe(409);

  await api.post(`${baseUrl()}/__test__/clock/offset`, { data: { offsetMs: 0 } });
});
