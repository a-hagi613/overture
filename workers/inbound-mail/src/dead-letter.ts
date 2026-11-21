import {
  INBOUND_DEAD_LETTER_PATH,
  INBOUND_HEADERS,
  signInbound,
} from "../../../src/shared/inbound-mail.ts";

import type { InboundDeadLetter } from "../../../src/shared/inbound-queue.ts";
import type { InboundMailEnv } from "./env.ts";

import { secondsNow } from "./clock.ts";

const UNKNOWN_RECIPIENT = "postmaster@overture.invalid";

export async function reportDeadLetter(env: InboundMailEnv, payload: InboundDeadLetter) {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const rcptTo = payload.rcptTo ?? UNKNOWN_RECIPIENT;

  const signed = await signInbound(env.INBOUND_HMAC_SECRET, {
    timestamp: secondsNow(),
    rcptTo,
    body,
  });

  const response = await fetch(new URL(INBOUND_DEAD_LETTER_PATH, env.OVERTURE_ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INBOUND_HEADERS.timestamp]: signed.timestamp,
      [INBOUND_HEADERS.signature]: signed.signature,
      [INBOUND_HEADERS.rcptTo]: rcptTo,
      [INBOUND_HEADERS.mailFrom]: payload.mailFrom,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`The dead-letter alert was refused with status ${String(response.status)}.`);
  }
}
