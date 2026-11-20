import PostalMime from "postal-mime";

import { isAtsMailDomain } from "../../../src/shared/ats-mail-domains.ts";
import {
  INBOUND_HEADERS,
  INBOUND_MAX_BYTES,
  INBOUND_PATH,
  forwardingIdFrom,
  signInbound,
} from "../../../src/shared/inbound-mail.ts";

const CONFIRMATION_SENDERS = new Set(["forwarding-noreply@google.com", "no-reply@microsoft.com"]);

export interface InboundMailEnv {
  INBOUND_HMAC_SECRET: string;
  OVERTURE_ORIGIN: string;
  OWNER_FORWARD_TO: string;
}

export interface ForwardableEmailMessage {
  from: string;
  to: string;
  rawSize: number;
  raw: ReadableStream<Uint8Array>;
  forward: (to: string) => Promise<void>;
  setReject: (reason: string) => void;
}

function domainOf(address: string) {
  return address
    .slice(address.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase();
}

function secondsNow() {
  return Math.floor((performance.timeOrigin + performance.now()) / 1000);
}

export async function email(message: ForwardableEmailMessage, env: InboundMailEnv) {
  if ((await forwardingIdFrom(env.INBOUND_HMAC_SECRET, message.to)) === null) {
    return;
  }

  if (message.rawSize > INBOUND_MAX_BYTES) {
    return;
  }

  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const parsed = await new PostalMime().parse(raw);
  const from = (parsed.from?.address ?? "").trim().toLowerCase();

  if (CONFIRMATION_SENDERS.has(from)) {
    await message.forward(env.OWNER_FORWARD_TO);

    return;
  }

  if (!isAtsMailDomain(domainOf(from))) {
    return;
  }

  const signed = await signInbound(env.INBOUND_HMAC_SECRET, {
    timestamp: secondsNow(),
    rcptTo: message.to,
    body: raw,
  });

  const response = await fetch(new URL(INBOUND_PATH, env.OVERTURE_ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "message/rfc822",
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: message.to,
      [INBOUND_HEADERS.mailFrom]: message.from,
    },
    body: raw,
  });

  if (!response.ok) {
    throw new Error(`Inbound mail was refused with status ${String(response.status)}.`);
  }
}
