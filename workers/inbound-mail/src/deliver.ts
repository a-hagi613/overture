import { INBOUND_HEADERS, INBOUND_PATH, signInbound } from "../../../src/shared/inbound-mail.ts";
import {
  INBOUND_QUEUE_RETRY_DELAY_SECONDS,
  base64ToBytes,
  parseInboundQueueBody,
} from "../../../src/shared/inbound-queue.ts";

import type { InboundDeadLetter, InboundQueueMessage } from "../../../src/shared/inbound-queue.ts";
import type { InboundMailEnv, InboundQueueMessageHandle } from "./env.ts";

import { secondsNow } from "./clock.ts";
import { reportDeadLetter } from "./dead-letter.ts";

const RETRYABLE_STATUSES = new Set([408, 425, 429]);

function isRetryable(status: number) {
  return status >= 500 || RETRYABLE_STATUSES.has(status);
}

async function rawMessage(env: InboundMailEnv, queued: InboundQueueMessage) {
  if (queued.kind === "inline") {
    return base64ToBytes(queued.bodyBase64);
  }

  const spilled = await env.INBOUND_SPILL.get(queued.spillKey);

  return spilled === null ? null : new Uint8Array(await spilled.arrayBuffer());
}

function deadLetterFromFailure(
  queued: InboundQueueMessage,
  message: InboundQueueMessageHandle,
  failure: { reason: InboundDeadLetter["reason"]; status: number | null },
) {
  return {
    reason: failure.reason,
    attempts: message.attempts,
    status: failure.status,
    reference: queued.reference,
    rcptTo: queued.rcptTo,
    mailFrom: queued.mailFrom,
    spillKey: queued.kind === "spill" ? queued.spillKey : null,
  } satisfies InboundDeadLetter;
}

function retryLater(message: InboundQueueMessageHandle) {
  message.retry({ delaySeconds: INBOUND_QUEUE_RETRY_DELAY_SECONDS });
}

export async function deliver(message: InboundQueueMessageHandle, env: InboundMailEnv) {
  const parsed = parseInboundQueueBody(message.body);

  if (!parsed.success) {
    await reportDeadLetter(env, {
      reason: "malformed",
      attempts: message.attempts,
      status: null,
      reference: crypto.randomUUID(),
      rcptTo: null,
      mailFrom: "",
      spillKey: null,
    });
    message.ack();

    return;
  }

  const queued = parsed.data;
  const raw = await rawMessage(env, queued);

  if (raw === null) {
    await reportDeadLetter(
      env,
      deadLetterFromFailure(queued, message, { reason: "spill_missing", status: null }),
    );
    message.ack();

    return;
  }

  const signed = await signInbound(env.INBOUND_HMAC_SECRET, {
    timestamp: secondsNow(),
    rcptTo: queued.rcptTo,
    body: raw,
  });

  const response = await fetch(new URL(INBOUND_PATH, env.OVERTURE_ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "message/rfc822",
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: queued.rcptTo,
      [INBOUND_HEADERS.mailFrom]: queued.mailFrom,
    },
    body: raw,
  }).catch(() => null);

  if (response === null) {
    retryLater(message);

    return;
  }

  if (response.ok) {
    if (queued.kind === "spill") {
      await env.INBOUND_SPILL.delete(queued.spillKey);
    }

    message.ack();

    return;
  }

  if (isRetryable(response.status)) {
    retryLater(message);

    return;
  }

  await reportDeadLetter(
    env,
    deadLetterFromFailure(queued, message, { reason: "refused", status: response.status }),
  );
  message.ack();
}
