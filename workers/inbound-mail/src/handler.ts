import PostalMime from "postal-mime";

import type { Email } from "postal-mime";

import { isAtsMailDomain } from "../../../src/shared/ats-mail-domains.ts";
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
import { forwardInboundMail, shouldForwardAliasMail } from "./forward.ts";

const CONFIRMATION_SENDERS = new Set(["forwarding-noreply@google.com", "no-reply@microsoft.com"]);

function domainOf(address: string) {
  return address
    .slice(address.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase();
}

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

async function forwardOrThrow(env: InboundMailEnv, parsed: Email, rcptTo: string) {
  try {
    await forwardInboundMail(env, parsed, rcptTo);
  } catch (error) {
    throw new Error("The inbound forward failed.", { cause: error });
  }
}

export async function email(message: ForwardableEmailMessage, env: InboundMailEnv) {
  const domain = aliasEmailDomain(env);
  const liveCheck = isLiveCheckAddress(message.to, domain);
  let managed = false;

  if (!liveCheck) {
    managed = await isManagedRecipient(env.INBOUND_HMAC_SECRET, message.to, domain);
  }

  const alias = !liveCheck && !managed && isAliasRecipient(message.to, domain);

  if (!liveCheck && !managed && !alias) {
    return;
  }

  if (message.rawSize > INBOUND_MAX_BYTES) {
    return;
  }

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());

  if (raw.byteLength > INBOUND_MAX_BYTES) {
    return;
  }

  if (liveCheck) {
    await enqueue(env, message, raw);

    return;
  }

  const parsed = await new PostalMime({ attachmentEncoding: "arraybuffer" }).parse(raw);
  const sender = (parsed.from?.address ?? "").trim().toLowerCase();

  if (CONFIRMATION_SENDERS.has(sender)) {
    await forwardOrThrow(env, parsed, message.to);

    return;
  }

  const ats = isAtsMailDomain(domainOf(sender));

  if (managed && !ats) {
    return;
  }

  await enqueue(env, message, raw);

  if (alias && shouldForwardAliasMail(parsed, ats)) {
    await forwardOrThrow(env, parsed, message.to);
  }
}
