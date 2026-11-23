import { Buffer } from "node:buffer";

import { parseInboundQueueBody } from "../../src/shared/inbound-queue.ts";

import type { InboundQueueMessage } from "../../src/shared/inbound-queue.ts";
import type {
  InboundMailEnv,
  InboundQueueMessageHandle,
  InboundSpillBucket,
  OutboundEmail,
} from "../../workers/inbound-mail/src/env.ts";

export {
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_HEADERS,
  INBOUND_PATH,
  forwardingIdFrom,
  forwardingLocalPart,
  signInbound,
  verifyInbound,
} from "../../src/shared/inbound-mail.ts";

export {
  INBOUND_DEAD_LETTER_QUEUE_NAME,
  INBOUND_QUEUE_MAX_BYTES,
  INBOUND_QUEUE_MAX_RETRIES,
  INBOUND_QUEUE_NAME,
  INBOUND_QUEUE_RETRY_DELAY_SECONDS,
  INBOUND_SPILL_PREFIX,
  base64ToBytes,
  parseInboundDeadLetter,
} from "../../src/shared/inbound-queue.ts";

export const inboundTestSecret = "e2e-inbound-queue-secret-0123456789";
export const inboundTestOwner = "owner@example.com";

export function fakeInboundQueue() {
  const sent: InboundQueueMessage[] = [];

  return {
    sent,
    queue: {
      send: async (message: InboundQueueMessage) => {
        await Promise.resolve();
        sent.push(message);
      },
    },
  };
}

export function fakeInboundEmail() {
  const sent: OutboundEmail[] = [];

  return {
    sent,
    email: {
      send: async (message: OutboundEmail) => {
        await Promise.resolve();
        sent.push(message);

        return { messageId: crypto.randomUUID() };
      },
    },
  };
}

export function fakeInboundSpill() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const deleted: string[] = [];

  const bucket: InboundSpillBucket = {
    put: async (key, value) => {
      await Promise.resolve();
      objects.set(key, value);
    },
    get: async (key) => {
      const stored = objects.get(key);

      await Promise.resolve();

      return stored === undefined
        ? null
        : {
            arrayBuffer: async () => {
              await Promise.resolve();

              return Uint8Array.from(stored).buffer;
            },
          };
    },
    delete: async (key) => {
      await Promise.resolve();
      objects.delete(key);
      deleted.push(key);
    },
  };

  return { objects, deleted, bucket };
}

export function inboundTestEnvironment(
  origin: string,
  queue: ReturnType<typeof fakeInboundQueue>,
  spill: ReturnType<typeof fakeInboundSpill>,
  email: ReturnType<typeof fakeInboundEmail> = fakeInboundEmail(),
) {
  return {
    INBOUND_HMAC_SECRET: inboundTestSecret,
    OVERTURE_ORIGIN: origin,
    OWNER_FORWARD_TO: inboundTestOwner,
    ALIAS_EMAIL_DOMAIN: "tryoverture.com",
    FORWARD_FROM: "notify@notify.tryoverture.com",
    INBOUND_QUEUE: queue.queue,
    INBOUND_SPILL: spill.bucket,
    INBOUND_EMAIL: email.email,
  } satisfies InboundMailEnv;
}

export function inlineQueueMessage(body: InboundQueueMessage | string) {
  const parsed = parseInboundQueueBody(body);

  if (!parsed.success || parsed.data.kind !== "inline") {
    throw new Error("The message was not enqueued inline.");
  }

  return parsed.data;
}

export function spilledQueueMessage(body: InboundQueueMessage | string) {
  const parsed = parseInboundQueueBody(body);

  if (!parsed.success || parsed.data.kind !== "spill") {
    throw new Error("The message was not spilled.");
  }

  return parsed.data;
}

export function inboundQueueHandle(body: InboundQueueMessage | string, attempts = 1) {
  const retries: (number | undefined)[] = [];
  const state = { acks: 0, retries };

  const message: InboundQueueMessageHandle = {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts,
    body,
    ack: () => {
      state.acks += 1;
    },
    retry: (options?: { delaySeconds?: number }) => {
      retries.push(options?.delaySeconds);
    },
  };

  return { message, state };
}

export function forwardableMessage(raw: Uint8Array<ArrayBuffer>, to: string) {
  const forwarded: string[] = [];
  const rejected: string[] = [];

  const message = {
    from: "bounce@us.greenhouse-mail.io",
    to,
    rawSize: raw.byteLength,
    raw: new Blob([raw]).stream(),
    forward: async (target: string) => {
      await Promise.resolve();
      forwarded.push(target);
    },
    setReject: (reason: string) => {
      rejected.push(reason);
    },
  };

  return { message, forwarded, rejected };
}

export function paddedMime(raw: Uint8Array<ArrayBuffer>, extraBytes: number) {
  const padding = new TextEncoder().encode(`\n${"Padding ".repeat(Math.ceil(extraBytes / 8))}`);
  const combined = new Uint8Array(raw.byteLength + padding.byteLength);

  combined.set(raw, 0);
  combined.set(padding, raw.byteLength);

  return combined;
}

export function mimeWithAttachment(contentBytes: number) {
  const base64 = Buffer.alloc(contentBytes, 7).toString("base64");

  return new TextEncoder().encode(
    [
      'From: "Greenhouse" <no-reply@us.greenhouse-mail.io>',
      'To: "Ada Chen" <ada.chen.4k@tryoverture.com>',
      "Subject: Offer letter for Senior Product Engineer",
      "Date: Wed, 18 Nov 2026 15:04:05 +0000",
      "Message-ID: <offer-letter@us.greenhouse-mail.io>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="overture-test-boundary"',
      "",
      "--overture-test-boundary",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      "Please find your offer letter attached.",
      "",
      "--overture-test-boundary",
      'Content-Type: application/pdf; name="offer-letter.pdf"',
      'Content-Disposition: attachment; filename="offer-letter.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      base64,
      "--overture-test-boundary--",
      "",
    ].join("\r\n"),
  );
}
