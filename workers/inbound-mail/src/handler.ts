import PostalMime from "postal-mime";

import { isAtsMailDomain } from "../../../src/shared/ats-mail-domains.ts";
import {
  INBOUND_MAX_BYTES,
  forwardingIdFrom,
  isLiveCheckAddress,
} from "../../../src/shared/inbound-mail.ts";
import {
  INBOUND_QUEUE_MAX_BYTES,
  INBOUND_SPILL_PREFIX,
  bytesToBase64,
  inboundQueueMessageBytes,
} from "../../../src/shared/inbound-queue.ts";

import type { InboundQueueMessage } from "../../../src/shared/inbound-queue.ts";
import type { ForwardableEmailMessage, InboundMailEnv } from "./env.ts";

import { millisecondsNow } from "./clock.ts";

const CONFIRMATION_SENDERS = new Set(["forwarding-noreply@google.com", "no-reply@microsoft.com"]);

function domainOf(address: string) {
  return address
    .slice(address.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase();
}

export async function email(message: ForwardableEmailMessage, env: InboundMailEnv) {
  const liveCheck = isLiveCheckAddress(message.to);

  if (!liveCheck && (await forwardingIdFrom(env.INBOUND_HMAC_SECRET, message.to)) === null) {
    return;
  }

  if (message.rawSize > INBOUND_MAX_BYTES) {
    return;
  }

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());

  if (!liveCheck) {
    const parsed = await new PostalMime().parse(raw);
    const from = (parsed.from?.address ?? "").trim().toLowerCase();

    if (CONFIRMATION_SENDERS.has(from)) {
      await message.forward(env.OWNER_FORWARD_TO);

      return;
    }

    if (!isAtsMailDomain(domainOf(from))) {
      return;
    }
  }

  const envelope = {
    rcptTo: message.to,
    mailFrom: message.from,
    receivedAt: millisecondsNow(),
    reference: crypto.randomUUID(),
  };

  if (raw.byteLength <= INBOUND_QUEUE_MAX_BYTES) {
    const inline: InboundQueueMessage = {
      kind: "inline",
      ...envelope,
      bodyBase64: bytesToBase64(raw),
    };

    if (inboundQueueMessageBytes(inline) <= INBOUND_QUEUE_MAX_BYTES) {
      await env.INBOUND_QUEUE.send(inline);

      return;
    }
  }

  const spillKey = `${INBOUND_SPILL_PREFIX}${envelope.reference}.eml`;

  await env.INBOUND_SPILL.put(spillKey, raw);

  try {
    await env.INBOUND_QUEUE.send({ kind: "spill", ...envelope, spillKey });
  } catch (error) {
    await env.INBOUND_SPILL.delete(spillKey);

    throw error;
  }
}
