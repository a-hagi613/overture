import {
  INBOUND_QUEUE_RETRY_DELAY_SECONDS,
  parseInboundQueueBody,
} from "../../../src/shared/inbound-queue.ts";

import type { InboundDeadLetter } from "../../../src/shared/inbound-queue.ts";
import type { InboundMailEnv, InboundQueueMessageHandle } from "./env.ts";

import { reportDeadLetter } from "./dead-letter.ts";

function exhaustedDeadLetter(message: InboundQueueMessageHandle) {
  const parsed = parseInboundQueueBody(message.body);

  if (!parsed.success) {
    return {
      reason: "malformed",
      attempts: message.attempts,
      status: null,
      reference: crypto.randomUUID(),
      rcptTo: null,
      mailFrom: "",
      spillKey: null,
    } satisfies InboundDeadLetter;
  }

  return {
    reason: "retries_exhausted",
    attempts: message.attempts,
    status: null,
    reference: parsed.data.reference,
    rcptTo: parsed.data.rcptTo,
    mailFrom: parsed.data.mailFrom,
    spillKey: parsed.data.kind === "spill" ? parsed.data.spillKey : null,
  } satisfies InboundDeadLetter;
}

export async function deadLetter(message: InboundQueueMessageHandle, env: InboundMailEnv) {
  try {
    await reportDeadLetter(env, exhaustedDeadLetter(message));
  } catch {
    message.retry({ delaySeconds: INBOUND_QUEUE_RETRY_DELAY_SECONDS });

    return;
  }

  message.ack();
}
