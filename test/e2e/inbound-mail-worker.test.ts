import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_DEAD_LETTER_QUEUE_NAME,
  INBOUND_HEADERS,
  INBOUND_PATH,
  INBOUND_QUEUE_MAX_BYTES,
  INBOUND_QUEUE_MAX_RETRIES,
  INBOUND_QUEUE_NAME,
  INBOUND_QUEUE_RETRY_DELAY_SECONDS,
  INBOUND_SPILL_PREFIX,
  base64ToBytes,
  fakeInboundQueue,
  fakeInboundSpill,
  forwardableMessage,
  forwardingLocalPart,
  inboundQueueHandle,
  inboundTestEnvironment,
  inboundTestSecret,
  inlineQueueMessage,
  paddedMime,
  parseInboundDeadLetter,
  spilledQueueMessage,
  verifyInbound,
} from "./inbound-mail.fixture.ts";
import { millisecondsNow, secondsNow } from "../../workers/inbound-mail/src/clock.ts";
import worker from "../../workers/inbound-mail/src/index.ts";

const id = "4f8c2a1b";

interface EdgeRequest {
  path: string;
  rcptTo: string | null;
  mailFrom: string | null;
  body: Uint8Array<ArrayBuffer>;
  verdict: Awaited<ReturnType<typeof verifyInbound>>;
}

function fixture(name: string) {
  return Uint8Array.from(readFileSync(join(process.cwd(), "test/e2e/fixtures/inbound-mail", name)));
}

function startEdge(statuses: { inbound?: number; deadLetter?: number } = {}) {
  const requests: EdgeRequest[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = new Uint8Array(await request.arrayBuffer());
      const path = new URL(request.url).pathname;
      const rcptTo = request.headers.get(INBOUND_HEADERS.rcptTo);

      const verdict = await verifyInbound(inboundTestSecret, {
        timestamp: request.headers.get(INBOUND_HEADERS.timestamp),
        signature: request.headers.get(INBOUND_HEADERS.signature),
        rcptTo,
        body,
        nowSeconds: secondsNow(),
      });

      requests.push({
        path,
        rcptTo,
        mailFrom: request.headers.get(INBOUND_HEADERS.mailFrom),
        body,
        verdict,
      });

      if (path === INBOUND_PATH) {
        return new Response(null, { status: statuses.inbound ?? (verdict.ok ? 202 : 401) });
      }

      if (path === INBOUND_DEAD_LETTER_PATH) {
        return new Response(null, { status: statuses.deadLetter ?? 202 });
      }

      return new Response(null, { status: 404 });
    },
  });

  return {
    origin: server.url.origin,
    requests,
    stop: async () => {
      await server.stop(true);
    },
  };
}

async function forwardingAddress() {
  return `${await forwardingLocalPart(inboundTestSecret, id)}@tryoverture.com`;
}

function sourceFiles(directory: string) {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }

  return found;
}

test("an ATS message is enqueued with its envelope and body", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = fixture("greenhouse-application.eml");
  const to = await forwardingAddress();
  const { message, forwarded, rejected } = forwardableMessage(raw, to);

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(1);

  const queued = inlineQueueMessage(queue.sent[0] ?? "");

  expect(queued.rcptTo).toBe(to);
  expect(queued.mailFrom).toBe("bounce@us.greenhouse-mail.io");
  expect(queued.receivedAt).toBeGreaterThan(0);
  expect(base64ToBytes(queued.bodyBase64)).toEqual(raw);
  expect(spill.objects.size).toBe(0);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a non-ATS message to a managed address is enqueued too", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();

  const { message, forwarded, rejected } = forwardableMessage(
    fixture("non-ats-newsletter.eml"),
    await forwardingAddress(),
  );

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(1);
  expect(spill.objects.size).toBe(0);
  expect(forwarded).toHaveLength(0);
  expect(rejected).toHaveLength(0);
});

test("a forged forwarding address is dropped without an enqueue", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();

  const { message } = forwardableMessage(
    fixture("greenhouse-application.eml"),
    `in-${id}-0000000000@tryoverture.com`,
  );

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(0);
});

test("a live check message is enqueued even though its sender is not an ATS", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = fixture("non-ats-newsletter.eml");
  const { message } = forwardableMessage(raw, "live-check@tryoverture.com");

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(1);

  const queued = inlineQueueMessage(queue.sent[0] ?? "");

  expect(queued.rcptTo).toBe("live-check@tryoverture.com");
  expect(base64ToBytes(queued.bodyBase64)).toEqual(raw);
});

test("an alias message is enqueued and the Worker never sends a copy itself", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = fixture("recruiter-reply.eml");
  const { message, forwarded } = forwardableMessage(raw, "ada.chen.4k@tryoverture.com");

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(1);

  const queued = inlineQueueMessage(queue.sent[0] ?? "");

  expect(queued.rcptTo).toBe("ada.chen.4k@tryoverture.com");
  expect(base64ToBytes(queued.bodyBase64)).toEqual(raw);
  expect(forwarded).toHaveLength(0);
});

test("an alias domain other than the apex is ignored", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();

  const environment = {
    ...inboundTestEnvironment("https://overture.invalid", queue, spill),
    ALIAS_EMAIL_DOMAIN: "mail.example.com",
  };

  const { message } = forwardableMessage(
    fixture("recruiter-reply.eml"),
    "ada.chen.4k@tryoverture.com",
  );

  await worker.email(message, environment);

  expect(queue.sent).toHaveLength(0);

  const accepted = forwardableMessage(
    fixture("recruiter-reply.eml"),
    "ada.chen.4k@mail.example.com",
  );

  await worker.email(accepted.message, environment);

  expect(queue.sent).toHaveLength(1);
});

test("a reserved system address is dropped without an enqueue", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();

  await Promise.all(
    ["hello@tryoverture.com", "postmaster@tryoverture.com"].map(async (to) => {
      const { message } = forwardableMessage(fixture("greenhouse-application.eml"), to);

      await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));
    }),
  );

  expect(queue.sent).toHaveLength(0);
});

test("a message bigger than the queue message limit spills to R2", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(fixture("greenhouse-application.eml"), INBOUND_QUEUE_MAX_BYTES);
  const { message } = forwardableMessage(raw, await forwardingAddress());

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(queue.sent).toHaveLength(1);

  const queued = spilledQueueMessage(queue.sent[0] ?? "");

  expect(queued.spillKey).toMatch(new RegExp(`^${INBOUND_SPILL_PREFIX}`, "u"));
  expect(spill.objects.get(queued.spillKey)).toEqual(raw);
});

test("a message that only overflows once it is base64 encoded spills to R2", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(fixture("greenhouse-application.eml"), 105_000);
  const { message } = forwardableMessage(raw, await forwardingAddress());

  expect(raw.byteLength).toBeLessThan(INBOUND_QUEUE_MAX_BYTES);

  await worker.email(message, inboundTestEnvironment("https://overture.invalid", queue, spill));

  expect(spill.objects.size).toBe(1);
  expect(queue.sent[0]?.kind).toBe("spill");
});

test("the consumer posts the signed MIME and acks", async () => {
  const edge = startEdge();
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = fixture("greenhouse-application.eml");
  const to = await forwardingAddress();
  const { message } = forwardableMessage(raw, to);

  try {
    const env = inboundTestEnvironment(edge.origin, queue, spill);

    await worker.email(message, env);

    const { message: queued, state } = inboundQueueHandle(queue.sent[0] ?? "");

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [queued] }, env);

    expect(edge.requests).toHaveLength(1);
    expect(edge.requests[0]?.path).toBe(INBOUND_PATH);
    expect(edge.requests[0]?.verdict).toEqual({ ok: true });
    expect(edge.requests[0]?.rcptTo).toBe(to);
    expect(edge.requests[0]?.mailFrom).toBe("bounce@us.greenhouse-mail.io");
    expect(edge.requests[0]?.body).toEqual(raw);
    expect(state.acks).toBe(1);
    expect(state.retries).toEqual([]);
  } finally {
    await edge.stop();
  }
});

test("the consumer reads spilled mail from R2 and deletes it after delivery", async () => {
  const edge = startEdge();
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(fixture("greenhouse-application.eml"), INBOUND_QUEUE_MAX_BYTES);
  const { message } = forwardableMessage(raw, await forwardingAddress());

  try {
    const env = inboundTestEnvironment(edge.origin, queue, spill);

    await worker.email(message, env);

    const { message: queued, state } = inboundQueueHandle(queue.sent[0] ?? "");

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [queued] }, env);

    expect(edge.requests[0]?.body).toEqual(raw);

    const spilled = spilledQueueMessage(queue.sent[0] ?? "");

    expect(spill.deleted).toEqual([spilled.spillKey]);
    expect(spill.objects.size).toBe(0);
    expect(state.acks).toBe(1);
  } finally {
    await edge.stop();
  }
});

test("an app outage retries the message and keeps the spilled body", async () => {
  const edge = startEdge({ inbound: 503 });
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(fixture("greenhouse-application.eml"), INBOUND_QUEUE_MAX_BYTES);
  const { message } = forwardableMessage(raw, await forwardingAddress());

  try {
    const env = inboundTestEnvironment(edge.origin, queue, spill);

    await worker.email(message, env);

    const { message: queued, state } = inboundQueueHandle(queue.sent[0] ?? "");

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [queued] }, env);

    expect(state.acks).toBe(0);
    expect(state.retries).toEqual([INBOUND_QUEUE_RETRY_DELAY_SECONDS]);
    expect(spill.deleted).toEqual([]);
    expect(spill.objects.size).toBe(1);
  } finally {
    await edge.stop();
  }
});

test("a network failure retries the message", async () => {
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();

  const { message } = forwardableMessage(
    fixture("greenhouse-application.eml"),
    await forwardingAddress(),
  );

  const env = inboundTestEnvironment("http://127.0.0.1:9", queue, spill);

  await worker.email(message, env);

  const { message: queued, state } = inboundQueueHandle(queue.sent[0] ?? "");

  await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [queued] }, env);

  expect(state.acks).toBe(0);
  expect(state.retries).toEqual([INBOUND_QUEUE_RETRY_DELAY_SECONDS]);
});

test("a message the app refuses is dead-lettered with an alert instead of retried", async () => {
  const edge = startEdge({ inbound: 401 });
  const queue = fakeInboundQueue();
  const spill = fakeInboundSpill();
  const raw = paddedMime(fixture("greenhouse-application.eml"), INBOUND_QUEUE_MAX_BYTES);

  const { message } = forwardableMessage(raw, await forwardingAddress());

  try {
    const env = inboundTestEnvironment(edge.origin, queue, spill);

    await worker.email(message, env);

    const spilled = spilledQueueMessage(queue.sent[0] ?? "");

    const { message: queued, state } = inboundQueueHandle(queue.sent[0] ?? "");

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [queued] }, env);

    expect(state.acks).toBe(1);
    expect(state.retries).toEqual([]);
    expect(spill.deleted).toEqual([]);

    const alert = edge.requests.find((request) => request.path === INBOUND_DEAD_LETTER_PATH);

    if (alert === undefined) {
      throw new Error("The refusal raised no dead-letter alert.");
    }

    expect(alert.verdict).toEqual({ ok: true });

    const payload = parseInboundDeadLetter(alert.body);

    if (!payload.success) {
      throw new Error("The dead-letter alert was not parsed.");
    }

    expect(payload.data.reason).toBe("refused");
    expect(payload.data.status).toBe(401);
    expect(payload.data.rcptTo).toBe(await forwardingAddress());
    expect(payload.data.spillKey).toBe(spilled.spillKey);
  } finally {
    await edge.stop();
  }
});

test("a malformed queue body is dead-lettered and acked", async () => {
  const edge = startEdge();

  try {
    const env = inboundTestEnvironment(edge.origin, fakeInboundQueue(), fakeInboundSpill());

    const { message, state } = inboundQueueHandle("not a queue message");

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [message] }, env);

    expect(state.acks).toBe(1);
    expect(state.retries).toEqual([]);

    const alert = edge.requests.find((request) => request.path === INBOUND_DEAD_LETTER_PATH);

    if (alert === undefined) {
      throw new Error("The malformed message raised no dead-letter alert.");
    }

    const payload = parseInboundDeadLetter(alert.body);

    if (!payload.success) {
      throw new Error("The dead-letter alert was not parsed.");
    }

    expect(payload.data.reason).toBe("malformed");
  } finally {
    await edge.stop();
  }
});

test("a missing spilled object is dead-lettered and acked", async () => {
  const edge = startEdge();

  try {
    const env = inboundTestEnvironment(edge.origin, fakeInboundQueue(), fakeInboundSpill());

    const { message, state } = inboundQueueHandle({
      kind: "spill",
      rcptTo: "in-missing-9d0e7c3a5f@tryoverture.com",
      mailFrom: "bounce@us.greenhouse-mail.io",
      receivedAt: millisecondsNow(),
      reference: crypto.randomUUID(),
      spillKey: `${INBOUND_SPILL_PREFIX}missing.eml`,
    });

    await worker.queue({ queue: INBOUND_QUEUE_NAME, messages: [message] }, env);

    expect(state.acks).toBe(1);
    expect(state.retries).toEqual([]);

    const alert = edge.requests.find((request) => request.path === INBOUND_DEAD_LETTER_PATH);

    if (alert === undefined) {
      throw new Error("The missing object raised no dead-letter alert.");
    }

    const payload = parseInboundDeadLetter(alert.body);

    if (!payload.success) {
      throw new Error("The dead-letter alert was not parsed.");
    }

    expect(payload.data.reason).toBe("spill_missing");
    expect(payload.data.spillKey).toBe(`${INBOUND_SPILL_PREFIX}missing.eml`);
  } finally {
    await edge.stop();
  }
});

test("the dead-letter consumer alerts the app and acks", async () => {
  const edge = startEdge();

  try {
    const env = inboundTestEnvironment(edge.origin, fakeInboundQueue(), fakeInboundSpill());

    const { message, state } = inboundQueueHandle(
      {
        kind: "inline",
        rcptTo: "in-missing-9d0e7c3a5f@tryoverture.com",
        mailFrom: "bounce@us.greenhouse-mail.io",
        receivedAt: millisecondsNow(),
        reference: crypto.randomUUID(),
        bodyBase64: "UmF3IG1lc3NhZ2U=",
      },
      INBOUND_QUEUE_MAX_RETRIES + 1,
    );

    await worker.queue({ queue: INBOUND_DEAD_LETTER_QUEUE_NAME, messages: [message] }, env);

    expect(state.acks).toBe(1);
    expect(state.retries).toEqual([]);

    const alert = edge.requests.find((request) => request.path === INBOUND_DEAD_LETTER_PATH);

    if (alert === undefined) {
      throw new Error("The dead-lettered message raised no alert.");
    }

    expect(alert.verdict).toEqual({ ok: true });

    const payload = parseInboundDeadLetter(alert.body);

    if (!payload.success) {
      throw new Error("The dead-letter alert was not parsed.");
    }

    expect(payload.data.reason).toBe("retries_exhausted");
    expect(payload.data.attempts).toBe(INBOUND_QUEUE_MAX_RETRIES + 1);
  } finally {
    await edge.stop();
  }
});

test("the dead-letter consumer retries while the app cannot take the alert", async () => {
  const edge = startEdge({ deadLetter: 503 });

  try {
    const env = inboundTestEnvironment(edge.origin, fakeInboundQueue(), fakeInboundSpill());

    const { message, state } = inboundQueueHandle({
      kind: "inline",
      rcptTo: "in-missing-9d0e7c3a5f@tryoverture.com",
      mailFrom: "bounce@us.greenhouse-mail.io",
      receivedAt: millisecondsNow(),
      reference: crypto.randomUUID(),
      bodyBase64: "UmF3IG1lc3NhZ2U=",
    });

    await worker.queue({ queue: INBOUND_DEAD_LETTER_QUEUE_NAME, messages: [message] }, env);

    expect(state.acks).toBe(0);
    expect(state.retries).toEqual([INBOUND_QUEUE_RETRY_DELAY_SECONDS]);
  } finally {
    await edge.stop();
  }
});

test("the Wrangler configuration has no owner destination and no send_email binding", () => {
  const configuration = readFileSync(
    join(process.cwd(), "workers/inbound-mail/wrangler.jsonc"),
    "utf8",
  ).replaceAll(/,\s*(?=[}\]])/gu, "");

  const parsed = z
    .object({
      vars: z.object({
        OVERTURE_ORIGIN: z.string(),
        ALIAS_EMAIL_DOMAIN: z.string(),
      }),
      send_email: z.array(z.unknown()).optional(),
      queues: z.object({
        producers: z.array(z.object({ binding: z.string(), queue: z.string() })),
        consumers: z.array(
          z.object({
            queue: z.string(),
            max_retries: z.number(),
            retry_delay: z.number(),
            dead_letter_queue: z.string().optional(),
          }),
        ),
      }),
      r2_buckets: z.array(z.object({ binding: z.string(), bucket_name: z.string() })),
    })
    .parse(JSON.parse(configuration));

  expect(parsed.vars).toEqual({
    OVERTURE_ORIGIN: "https://tryoverture.com",
    ALIAS_EMAIL_DOMAIN: "tryoverture.com",
  });
  expect(parsed.send_email).toBeUndefined();
  expect(configuration).not.toContain("OWNER_FORWARD_TO");
  expect(parsed.queues.producers).toEqual([
    { binding: "INBOUND_QUEUE", queue: INBOUND_QUEUE_NAME },
  ]);
  expect(parsed.queues.consumers[0]).toMatchObject({
    queue: INBOUND_QUEUE_NAME,
    max_retries: INBOUND_QUEUE_MAX_RETRIES,
    retry_delay: INBOUND_QUEUE_RETRY_DELAY_SECONDS,
    dead_letter_queue: INBOUND_DEAD_LETTER_QUEUE_NAME,
  });
  expect(parsed.queues.consumers[1]).toMatchObject({
    queue: INBOUND_DEAD_LETTER_QUEUE_NAME,
    max_retries: INBOUND_QUEUE_MAX_RETRIES,
  });
  expect(parsed.r2_buckets).toEqual([
    { binding: "INBOUND_SPILL", bucket_name: "overture-inbound-mail-spill" },
  ]);
});

test("the Worker sources never send mail, name an owner destination or call message.forward", () => {
  const sources = sourceFiles(join(process.cwd(), "workers/inbound-mail/src"));

  const noForward = sources.filter((file) => /\.forward\s*\(/u.test(readFileSync(file, "utf8")));

  const noOwner = sources.filter((file) =>
    /OWNER_FORWARD_TO|INBOUND_EMAIL|send_email/u.test(readFileSync(file, "utf8")),
  );

  expect(sources.length).toBeGreaterThan(0);
  expect(noForward).toEqual([]);
  expect(noOwner).toEqual([]);
});
