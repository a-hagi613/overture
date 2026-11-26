import { readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest, expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { z } from "zod";

import {
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_DEAD_LETTER_QUEUE_NAME,
  INBOUND_HEADERS,
  INBOUND_QUEUE_MAX_BYTES,
  INBOUND_QUEUE_NAME,
  fakeInboundQueue,
  fakeInboundSpill,
  forwardableMessage,
  inboundQueueHandle,
  inboundTestEnvironment,
  inboundTestSecret,
  paddedMime,
  signInbound,
  spilledQueueMessage,
} from "./inbound-mail.fixture.ts";
import { millisecondsNow, secondsNow } from "../../workers/inbound-mail/src/clock.ts";
import worker from "../../workers/inbound-mail/src/index.ts";

import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { startFreshAppServer } from "./app.fixture.ts";
import { startIdentityServer } from "./identity-server-test.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const RECORDED_MESSAGE_ID = "CAMd2b0e5db1a44c9b8f0d7c3a5f@us.greenhouse-mail.io";

const mailboxesSchema = z.object({
  mailboxes: z.array(
    z.object({
      applyAddress: z.string().nullable(),
      id: z.string(),
      localPart: z.string(),
      status: z.string(),
    }),
  ),
});

const userSchema = z.object({ user: z.object({ id: z.string() }).nullable() });

const messageSchema = z.object({
  id: z.string(),
  rfcMessageId: z.string(),
  subject: z.string(),
  senderDomain: z.string(),
  text: z.string(),
});

const messagesSchema = z.object({ messages: z.array(messageSchema) });

const notificationsSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  ),
});

let server: AppServer | undefined;
let identity: IdentityServer | undefined;
let api: APIRequestContext;
let address = "";
let mailboxId = "";
let userId = "";

function startOutage() {
  const outage = Bun.serve({
    port: 0,
    fetch: () => new Response(null, { status: 503 }),
  });

  return {
    origin: outage.url.origin,
    stop: async () => {
      await outage.stop(true);
    },
  };
}

function messageFixture() {
  const recorded = readFileSync(
    join(process.cwd(), "test/e2e/fixtures/inbound-mail/greenhouse-application.eml"),
    "utf8",
  );

  return Uint8Array.from(
    new TextEncoder().encode(recorded.replace(RECORDED_MESSAGE_ID, crypto.randomUUID())),
  );
}

function baseUrl() {
  if (server === undefined) {
    throw new Error("The app server is not running.");
  }

  return server.url;
}

async function runDueJobs() {
  const response = await api.post(`${baseUrl()}/__test__/jobs/run-due`);

  expect(response.status()).toBe(200);
}

async function storedMessages() {
  const response = await api.get(
    `${baseUrl()}/__test__/mail/messages?mailboxId=${encodeURIComponent(mailboxId)}`,
  );

  return messagesSchema.parse(await response.json()).messages;
}

async function notifications() {
  const response = await api.get(
    `${baseUrl()}/__test__/notifications?userId=${encodeURIComponent(userId)}`,
  );

  return notificationsSchema.parse(await response.json()).notifications;
}

test.beforeAll(async () => {
  identity = await startIdentityServer();
  server = await startFreshAppServer(identity, {
    INBOUND_HMAC_SECRET: inboundTestSecret,
    MAIL_DOMAIN: "tryoverture.com",
  });

  api = await apiRequest.newContext();

  await requestMagicLink(server.url, api, authTestIdentity.ownerEmail);

  const link = await latestMailLink(server.url, api, authTestIdentity.ownerEmail);

  await api.get(link);

  const me = userSchema.parse(await (await api.get(`${server.url}/api/me`)).json());

  if (me.user === null) {
    throw new Error("The owner is not signed in.");
  }

  userId = me.user.id;

  const owned = mailboxesSchema.parse(
    await (
      await api.get(`${server.url}/__test__/mailboxes?userId=${encodeURIComponent(userId)}`)
    ).json(),
  );

  const [mailbox] = owned.mailboxes;

  if (mailbox === undefined) {
    throw new Error("The owner has no mailbox.");
  }

  if (mailbox.applyAddress === null) {
    throw new Error("The owner has no apply alias.");
  }

  address = mailbox.applyAddress;
  mailboxId = mailbox.id;
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

test("an app outage then recovery delivers the message exactly once", async () => {
  const outage = startOutage();

  try {
    const queue = fakeInboundQueue();
    const spill = fakeInboundSpill();
    const raw = messageFixture();
    const { message } = forwardableMessage(raw, address);

    await worker.email(message, inboundTestEnvironment(outage.origin, queue, spill));

    expect(queue.sent).toHaveLength(1);

    const first = inboundQueueHandle(queue.sent[0] ?? "");

    await worker.queue(
      { queue: INBOUND_QUEUE_NAME, messages: [first.message] },
      inboundTestEnvironment(outage.origin, queue, spill),
    );

    expect(first.state.retries).toHaveLength(1);
    expect(first.state.acks).toBe(0);
    expect(await storedMessages()).toHaveLength(0);

    const second = inboundQueueHandle(queue.sent[0] ?? "", 2);

    await worker.queue(
      { queue: INBOUND_QUEUE_NAME, messages: [second.message] },
      inboundTestEnvironment(baseUrl(), queue, spill),
    );

    expect(second.state.acks).toBe(1);
    expect(second.state.retries).toEqual([]);

    await runDueJobs();
    await expect.poll(async () => (await storedMessages()).length).toBe(1);

    const [stored] = await storedMessages();

    if (stored === undefined) {
      throw new Error("The message was not stored.");
    }

    expect(stored.subject).toBe("Application received: Senior Product Engineer at Northstar Labs");
    expect(stored.senderDomain).toBe("us.greenhouse-mail.io");
    expect(stored.text).toContain("Thank you for applying to Northstar Labs");

    const redelivery = inboundQueueHandle(queue.sent[0] ?? "", 3);

    await worker.queue(
      { queue: INBOUND_QUEUE_NAME, messages: [redelivery.message] },
      inboundTestEnvironment(baseUrl(), queue, spill),
    );

    expect(redelivery.state.acks).toBe(1);

    await runDueJobs();
    expect(await storedMessages()).toHaveLength(1);
    expect((await storedMessages())[0]?.id).toBe(stored.id);
  } finally {
    await outage.stop();
  }
});

test("a message over 128 KB spills to R2, is delivered once and then deleted", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(messageFixture(), INBOUND_QUEUE_MAX_BYTES);
  const { message } = forwardableMessage(raw, address);

  await worker.email(message, inboundTestEnvironment(baseUrl(), queue, spill));

  const queued = spilledQueueMessage(queue.sent[0] ?? "");

  expect(spill.objects.get(queued.spillKey)).toEqual(raw);

  const delivery = inboundQueueHandle(queue.sent[0] ?? "");

  await worker.queue(
    { queue: INBOUND_QUEUE_NAME, messages: [delivery.message] },
    inboundTestEnvironment(baseUrl(), queue, spill),
  );

  expect(delivery.state.acks).toBe(1);
  expect(spill.deleted).toEqual([queued.spillKey]);

  await runDueJobs();
  await expect.poll(async () => (await storedMessages()).length).toBe(2);

  const stored = (await storedMessages()).find((entry) => entry.text.includes("Padding"));

  expect(stored?.senderDomain).toBe("us.greenhouse-mail.io");
});

test("a dead-lettered message raises an owner alert", async () => {
  const queued = inboundQueueHandle(
    {
      kind: "inline",
      rcptTo: address,
      mailFrom: "bounce@us.greenhouse-mail.io",
      receivedAt: millisecondsNow(),
      reference: crypto.randomUUID(),
      bodyBase64: "UmF3IG1lc3NhZ2U=",
    },
    101,
  );

  await worker.queue(
    { queue: INBOUND_DEAD_LETTER_QUEUE_NAME, messages: [queued.message] },
    inboundTestEnvironment(baseUrl(), fakeInboundQueue(), fakeInboundSpill()),
  );

  expect(queued.state.acks).toBe(1);

  await expect
    .poll(async () =>
      (await notifications()).some(
        (notification) => notification.title === "Overture alert: mail.dead_letter",
      ),
    )
    .toBe(true);

  const alert = (await notifications()).find(
    (notification) => notification.title === "Overture alert: mail.dead_letter",
  );

  if (alert === undefined) {
    throw new Error("The dead-letter alert was not recorded.");
  }

  const detail = z
    .object({
      mailboxId: z.string(),
      reason: z.string(),
      attempts: z.number(),
      reference: z.string(),
      spillKey: z.string().nullable(),
    })
    .parse(JSON.parse(alert.body));

  expect(detail.mailboxId).toBe(mailboxId);
  expect(detail.reason).toBe("retries_exhausted");
  expect(detail.attempts).toBe(101);
  expect(detail.spillKey).toBeNull();
});

test("the dead-letter route refuses a forged signature and a mismatched address", async () => {
  const before = (await notifications()).length;

  const payload = {
    reason: "refused",
    attempts: 1,
    status: 500,
    reference: crypto.randomUUID(),
    rcptTo: address,
    mailFrom: "bounce@us.greenhouse-mail.io",
    spillKey: null,
  };

  const body = new TextEncoder().encode(JSON.stringify(payload));

  const forged = await signInbound("a-different-secret", {
    timestamp: secondsNow(),
    rcptTo: address,
    body,
  });

  const refused = await api.post(`${baseUrl()}${INBOUND_DEAD_LETTER_PATH}`, {
    headers: {
      [INBOUND_HEADERS.timestamp]: forged.timestamp,
      [INBOUND_HEADERS.signature]: forged.signature,
      [INBOUND_HEADERS.rcptTo]: address,
    },
    data: Buffer.from(body),
  });

  expect(refused.status()).toBe(401);

  const mismatchedBody = new TextEncoder().encode(
    JSON.stringify({ ...payload, rcptTo: "in-other-0000000000@tryoverture.com" }),
  );

  const signed = await signInbound(inboundTestSecret, {
    timestamp: secondsNow(),
    rcptTo: address,
    body: mismatchedBody,
  });

  const mismatched = await api.post(`${baseUrl()}${INBOUND_DEAD_LETTER_PATH}`, {
    headers: {
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: address,
    },
    data: Buffer.from(mismatchedBody),
  });

  expect(mismatched.status()).toBe(401);
  expect((await notifications()).length).toBe(before);
});
