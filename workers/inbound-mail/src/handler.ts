import { INBOUND_MAX_BYTES, isLiveCheckAddress } from "../../../src/shared/inbound-mail.ts";
import {
  INBOUND_QUEUE_MAX_BYTES,
  INBOUND_SPILL_PREFIX,
  bytesToBase64,
  inboundQueueMessageBytes,
} from "../../../src/shared/inbound-queue.ts";

import type { InboundQueueMessage } from "../../../src/shared/inbound-queue.ts";
import type { ForwardableEmailMessage, InboundMailEnv } from "./env.ts";

import { aliasEmailDomain, isAliasRecipient, isManagedRecipient } from "./addresses.ts";
import { millisecondsNow } from "./clock.ts";

async function enqueue(
  env: InboundMailEnv,
  message: ForwardableEmailMessage,
  raw: Uint8Array<ArrayBuffer>,
) {
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

/**
 * The `tryoverture.com` catch-all. It only moves mail; routing, storage and the copy to the
 * account's own verified address live in `overture-web`, which can resolve the envelope recipient to
 * one active mailbox. A reserved local part, a forged forwarding address and an alias on another
 * domain are dropped here without an enqueue.
 * @param message The inbound Email Routing message.
 * @param env The Worker bindings.
 */
export async function email(message: ForwardableEmailMessage, env: InboundMailEnv) {
  const domain = aliasEmailDomain(env);
  const liveCheck = isLiveCheckAddress(message.to, domain);

  if (!liveCheck) {
    const managed = await isManagedRecipient(env.INBOUND_HMAC_SECRET, message.to, domain);

    if (!managed && !isAliasRecipient(message.to, domain)) {
      return;
    }
  }

  if (message.rawSize > INBOUND_MAX_BYTES) {
    return;
  }

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());

  if (raw.byteLength > INBOUND_MAX_BYTES) {
    return;
  }

  await enqueue(env, message, raw);
}
