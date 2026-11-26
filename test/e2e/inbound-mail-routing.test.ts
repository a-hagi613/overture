import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest, expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

import { INBOUND_HEADERS, signInbound } from "./inbound-mail.fixture.ts";

import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { startFreshAppServer } from "./app.fixture.ts";
import { startIdentityServer } from "./identity-server-test.fixture.ts";

const SECRET = "e2e-routing-hmac-secret-0123456789";

test.describe.configure({ mode: "serial" });

const mailboxSchema = z.object({
  applyAddress: z.string().nullable(),
  firstForwardedAt: z.number().nullable(),
  id: z.string(),
  localPart: z.string(),
  status: z.string(),
});

const messagesSchema = z.object({
  messages: z.array(
    z.object({
      classification: z.string().nullable(),
      delivery: z
        .object({
          attempts: z.number(),
          detail: z.string().nullable(),
          status: z.string(),
        })
        .nullable(),
      id: z.string(),
      subject: z.string(),
      text: z.string(),
    }),
  ),
});

const sinkSchema = z.object({
  messages: z.array(
    z.object({
      attachments: z.array(z.object({ bytes: z.number(), filename: z.string(), type: z.string() })),
      body: z.string(),
      headers: z.record(z.string(), z.string()),
      replyTo: z.string().nullable(),
      subject: z.string(),
      to: z.string(),
    }),
  ),
});

const clockSchema = z.object({ now: z.number() });

let server: AppServer | undefined;
let identity: IdentityServer | undefined;
let api: APIRequestContext;

test.beforeAll(async () => {
  identity = await startIdentityServer();
  server = await startFreshAppServer(identity, {
    INBOUND_HMAC_SECRET: SECRET,
    MAIL_DOMAIN: "tryoverture.com",
  });

  api = await apiRequest.newContext({ baseURL: server.url });
});

test.afterAll(async () => {
  await api.dispose();

  if (server !== undefined) {
    await server.stop();
  }

  if (identity !== undefined) {
    await identity.stop();
  }
});

function baseUrl() {
  if (server === undefined) {
    throw new Error("The app server is not running.");
  }

  return server.url;
}

async function clearMail() {
  expect((await api.post("/__test__/mail/clear")).ok()).toBe(true);
}

async function sinkMail() {
  return sinkSchema.parse(await (await api.get("/__test__/mail")).json()).messages;
}

async function clockNow() {
  return clockSchema.parse(await (await api.get("/__test__/clock")).json()).now;
}

async function createUser(email: string, name: string) {
  const created = await api.post("/__test__/users", { data: { email, name } });
  const { id } = z.object({ id: z.string() }).parse(await created.json());

  const owned = await api.get(`/__test__/mailboxes?userId=${encodeURIComponent(id)}`);
  const { mailboxes } = z.object({ mailboxes: z.array(mailboxSchema) }).parse(await owned.json());

  const [mailbox] = mailboxes;
  const address = mailbox?.applyAddress ?? null;

  if (mailbox === undefined || address === null) {
    throw new Error("The test user got no apply alias.");
  }

  return { address, email, id, mailboxId: mailbox.id };
}

async function postInbound(raw: string, rcptTo: string) {
  const body = new TextEncoder().encode(raw);
  const timestamp = Math.trunc((await clockNow()) / 1000);
  const signed = await signInbound(SECRET, { body, rcptTo, timestamp });

  const response = await api.post(`${baseUrl()}/internal/mail/inbound`, {
    data: Buffer.from(body),
    headers: {
      [INBOUND_HEADERS.mailFrom]: "bounce@us.greenhouse-mail.io",
      [INBOUND_HEADERS.rcptTo]: rcptTo,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      "content-type": "message/rfc822",
    },
  });

  expect(response.status()).toBe(204);
}

async function runJobs() {
  expect((await api.post("/__test__/jobs/run-due")).ok()).toBe(true);
}

async function messagesOf(mailboxId: string) {
  return messagesSchema.parse(
    await (
      await api.get(`/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`)
    ).json(),
  ).messages;
}

async function waitForMessages(mailboxId: string, count: number) {
  await expect
    .poll(async () => (await messagesOf(mailboxId)).length, { timeout: 20_000 })
    .toBe(count);

  return await messagesOf(mailboxId);
}

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/e2e/fixtures/mail", name), "utf8");
}

function ack(subject: string, messageId: string, marker: string) {
  return fixture("greenhouse-ack.eml")
    .replaceAll("__MESSAGE_ID__", messageId)
    .replaceAll("__ACK_ID__", crypto.randomUUID())
    .replace("Thank you for applying to Acme.", marker)
    .replace("Your application to Acme", subject);
}

function plain(input: {
  from?: string;
  messageId?: string | null;
  subject?: string;
  text: string;
  extraHeaders?: readonly string[];
}) {
  const headers = [
    `From: ${input.from ?? "Priya Raghavan <priya@northstar.example>"}`,
    "To: employer-alias@tryoverture.com",
    `Subject: ${input.subject ?? "A reply"}`,
    "Date: Wed, 18 Nov 2026 15:04:05 +0000",
    ...(input.extraHeaders ?? []),
  ];

  if (input.messageId !== null) {
    headers.push(`Message-ID: <${input.messageId ?? crypto.randomUUID()}@northstar.example>`);
  }

  return `${headers.join("\r\n")}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.text}`;
}

function withAttachment(bytes: number, text: string, messageId = crypto.randomUUID()) {
  const base64 = Buffer.alloc(bytes, 7).toString("base64");

  return [
    "From: Greenhouse <no-reply@us.greenhouse-mail.io>",
    "To: employer-alias@tryoverture.com",
    "Subject: Interview brief",
    `Message-ID: <${messageId}@us.greenhouse-mail.io>`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="routing-boundary"',
    "",
    "--routing-boundary",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    text,
    "",
    "--routing-boundary",
    'Content-Type: application/pdf; name="brief.pdf"',
    'Content-Disposition: attachment; filename="brief.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    base64,
    "--routing-boundary--",
    "",
  ].join("\r\n");
}

test("two test users never see or receive each other's mail, and nothing goes to the owner", async () => {
  const a = await createUser("ada@example.test", "Ada Chen");
  const b = await createUser("grace@example.test", "Grace Hopper");

  await clearMail();

  const markerA = "UNIQUE-MARKER-A-9137";
  const markerB = "UNIQUE-MARKER-B-4268";

  await postInbound(plain({ messageId: "routing-a", text: `Hello A ${markerA}` }), a.address);
  await postInbound(plain({ messageId: "routing-b", text: `Hello B ${markerB}` }), b.address);
  await runJobs();

  await waitForMessages(a.mailboxId, 1);
  await waitForMessages(b.mailboxId, 1);

  const aMessages = await messagesOf(a.mailboxId);
  const bMessages = await messagesOf(b.mailboxId);

  expect(aMessages[0]?.text).toContain(markerA);
  expect(aMessages[0]?.text).not.toContain(markerB);
  expect(bMessages[0]?.text).toContain(markerB);
  expect(bMessages[0]?.text).not.toContain(markerA);

  const sent = await sinkMail();

  expect(sent).toHaveLength(2);
  expect(sent.filter((mail) => mail.to === a.email)).toHaveLength(1);
  expect(sent.filter((mail) => mail.to === b.email)).toHaveLength(1);
  expect(sent.filter((mail) => mail.to === "owner@example.test")).toHaveLength(0);
  expect(sent.find((mail) => mail.to === a.email)?.body).not.toContain(markerB);
  expect(sent.find((mail) => mail.to === b.email)?.body).not.toContain(markerA);

  expect(aMessages[0]?.delivery?.status).toBe("sent");
  expect(bMessages[0]?.delivery?.status).toBe("sent");
});

test("an ATS confirmation, a recruiter reply and a verification code are all stored and copied", async () => {
  const a = await createUser("ada.ats@example.test", "Ada Ats");

  await clearMail();

  await postInbound(
    ack("Your application to Northstar", "ats-ack", "Thanks for applying."),
    a.address,
  );
  await postInbound(
    plain({
      messageId: "recruiter-reply",
      subject: "Re: Senior Product Engineer",
      text: "Can you talk on Thursday at 10:00?",
    }),
    a.address,
  );
  await postInbound(
    plain({
      messageId: "verification-code",
      subject: "Your verification code",
      text: "Your verification code: A1B2C3D4. It expires in ten minutes.",
    }),
    a.address,
  );
  await runJobs();

  await waitForMessages(a.mailboxId, 3);

  const stored = await messagesOf(a.mailboxId);
  const sent = await sinkMail();

  expect(stored.map((message) => message.classification)).toEqual(
    expect.arrayContaining(["ack", "code"]),
  );
  expect(stored.every((message) => message.delivery?.status === "sent")).toBe(true);
  expect(sent).toHaveLength(3);
  expect(sent.every((mail) => mail.to === a.email)).toBe(true);
  expect(sent.some((mail) => mail.body.includes("A1B2C3D4"))).toBe(true);
  expect(sent.some((mail) => mail.replyTo === "priya@northstar.example")).toBe(true);
});

test("a small attachment is copied, an oversize one stays in the Inbox with a sign-in link", async () => {
  const a = await createUser("ada.files@example.test", "Ada Files");

  await clearMail();

  await postInbound(withAttachment(1024, "Small brief attached."), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 1);

  const [small] = await sinkMail();

  expect(small?.attachments).toEqual([
    { bytes: 1024, filename: "brief.pdf", type: "application/pdf" },
  ]);

  await postInbound(withAttachment(4 * 1024 * 1024 + 512 * 1024, "Big brief attached."), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 2);

  const big = (await sinkMail()).find((mail) => mail.body.includes("Big brief attached."));

  expect(big?.attachments).toHaveLength(0);
  expect(big?.body).toContain("Attachments kept in your Overture Inbox:");
  expect(big?.body).toContain("brief.pdf");
  expect(big?.body).toMatch(/\/inbox\?message=/u);
});

test("a missing Message-ID and a duplicate delivery store and copy once", async () => {
  const a = await createUser("ada.dupe@example.test", "Ada Dupe");

  await clearMail();

  const noId = plain({ messageId: null, text: "No message id on this one." });

  await postInbound(noId, a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 1);

  await postInbound(noId, a.address);
  await runJobs();

  expect(await messagesOf(a.mailboxId)).toHaveLength(1);
  expect(await sinkMail()).toHaveLength(1);

  const withId = plain({ messageId: "same-id", text: "Same Message-ID twice." });

  await postInbound(withId, a.address);
  await postInbound(withId, a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 2);

  expect(await sinkMail()).toHaveLength(2);
});

test("a reserved address, an unknown alias and a retired alias never deliver", async () => {
  const retired = await createUser("ada.retired@example.test", "Ada Retired");

  await clearMail();

  await Promise.all(
    ["support@tryoverture.com", "postmaster@tryoverture.com", "nobody.here@tryoverture.com"].map(
      async (address) =>
        await postInbound(
          plain({ messageId: crypto.randomUUID(), text: "Should not land." }),
          address,
        ),
    ),
  );

  await runJobs();
  expect(await sinkMail()).toHaveLength(0);

  await postInbound(plain({ messageId: "before-retire", text: "Lands once." }), retired.address);
  await runJobs();
  await waitForMessages(retired.mailboxId, 1);

  const retiredResponse = await api.post(
    `/__test__/mailboxes/${encodeURIComponent(retired.mailboxId)}/retire`,
    { data: { userId: retired.id } },
  );

  expect(z.object({ retired: z.boolean() }).parse(await retiredResponse.json()).retired).toBe(true);

  await postInbound(plain({ messageId: "after-retire", text: "Never lands." }), retired.address);
  await runJobs();

  expect(await sinkMail()).toHaveLength(1);
  expect(await messagesOf(retired.mailboxId)).toHaveLength(0);
});

test("a changed login email receives the next copy at the new verified address", async () => {
  const a = await createUser("ada.change@example.test", "Ada Change");

  await clearMail();

  await postInbound(plain({ messageId: "change-before", text: "Before the change." }), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 1);

  expect((await sinkMail())[0]?.to).toBe("ada.change@example.test");

  const changed = await api.post("/__test__/users/email", {
    data: { email: "ada.new@example.test", userId: a.id },
  });

  expect(changed.ok()).toBe(true);

  await postInbound(plain({ messageId: "change-after", text: "After the change." }), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 2);

  expect((await sinkMail()).map((mail) => mail.to)).toEqual([
    "ada.change@example.test",
    "ada.new@example.test",
  ]);
});

test("a temporary provider failure retries safely, and a bounce is surfaced", async () => {
  const a = await createUser("ada.retry@example.test", "Ada Retry");

  await clearMail();
  expect((await api.post("/__test__/mail/fail-next", { data: { count: 1 } })).ok()).toBe(true);

  await postInbound(plain({ messageId: "retry-copy", text: "Retry me." }), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 1);

  const failed = await messagesOf(a.mailboxId);

  expect(failed[0]?.delivery?.status).toBe("failed");
  expect(await sinkMail()).toHaveLength(0);

  const offset = await api.post("/__test__/clock/offset", { data: { offsetMs: 31_000 } });

  expect(offset.ok()).toBe(true);

  await runJobs();
  await expect.poll(async () => (await messagesOf(a.mailboxId))[0]?.delivery?.status).toBe("sent");

  expect(await sinkMail()).toHaveLength(1);
  await api.post("/__test__/clock/offset", { data: { offsetMs: 0 } });

  expect((await api.post("/__test__/mail/bounce-next", { data: { count: 1 } })).ok()).toBe(true);

  await postInbound(plain({ messageId: "bounce-copy", text: "Bounce me." }), a.address);
  await runJobs();
  await waitForMessages(a.mailboxId, 2);

  await expect
    .poll(
      async () =>
        (await messagesOf(a.mailboxId)).find((message) => message.text.includes("Bounce me."))
          ?.delivery?.status,
    )
    .toBe("bounced");
});
