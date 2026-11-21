export const INBOUND_PATH = "/internal/mail/inbound";

export const INBOUND_HEADERS = {
  timestamp: "x-overture-timestamp",
  signature: "x-overture-signature",
  rcptTo: "x-overture-rcpt-to",
  mailFrom: "x-overture-mail-from",
} as const;

export const INBOUND_REPLAY_WINDOW_SECONDS = 300;

export const INBOUND_MAX_BYTES = 25 * 1024 * 1024;

const ADDRESS_PREFIX = "in-";
export const LIVE_CHECK_LOCAL_PART = "live-check";
const MAC_LENGTH = 10;
const ID_PATTERN = /^[a-z0-9]{8,32}$/u;
const encoder = new TextEncoder();

async function hmac(secret: string, message: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sameSecretValue(secret: string, left: string, right: string) {
  const [leftMac, rightMac] = await Promise.all([
    hmac(secret, encoder.encode(`compare:${left}`)),
    hmac(secret, encoder.encode(`compare:${right}`)),
  ]);

  return hex(leftMac) === hex(rightMac);
}

async function addressMac(secret: string, id: string) {
  return hex(await hmac(secret, encoder.encode(`address:${id}`))).slice(0, MAC_LENGTH);
}

export async function forwardingLocalPart(secret: string, id: string) {
  if (!ID_PATTERN.test(id)) {
    throw new Error("A forwarding address id is 8 to 32 lowercase letters or digits.");
  }

  return `${ADDRESS_PREFIX}${id}-${await addressMac(secret, id)}`;
}

export function liveCheckAddress(domain: string) {
  return `${LIVE_CHECK_LOCAL_PART}@${domain.trim().toLowerCase()}`;
}

export function isLiveCheckAddress(address: string, domain?: string) {
  const [local = "", host = ""] = address.trim().toLowerCase().split("@");

  return (
    local === LIVE_CHECK_LOCAL_PART &&
    (domain === undefined || host === domain.trim().toLowerCase())
  );
}

export async function forwardingIdFrom(secret: string, address: string) {
  const local = address.trim().toLowerCase().split("@")[0] ?? "";

  if (!local.startsWith(ADDRESS_PREFIX)) {
    return null;
  }

  const [id, mac, ...rest] = local.slice(ADDRESS_PREFIX.length).split("-");

  if (id === undefined || mac === undefined || rest.length > 0 || !ID_PATTERN.test(id)) {
    return null;
  }

  return (await sameSecretValue(secret, mac, await addressMac(secret, id))) ? id : null;
}

async function signedText(timestamp: string, rcptTo: string, body: Uint8Array<ArrayBuffer>) {
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));

  return encoder.encode(`${timestamp}.${rcptTo.toLowerCase()}.${digest}`);
}

export async function signInbound(
  secret: string,
  request: { timestamp: number; rcptTo: string; body: Uint8Array<ArrayBuffer> },
) {
  const timestamp = String(Math.trunc(request.timestamp));

  return {
    timestamp,
    signature: hex(await hmac(secret, await signedText(timestamp, request.rcptTo, request.body))),
  };
}

export async function verifyInbound(
  secret: string,
  request: {
    timestamp: string | null;
    signature: string | null;
    rcptTo: string | null;
    body: Uint8Array<ArrayBuffer>;
    nowSeconds: number;
  },
) {
  if (request.timestamp === null || request.signature === null || request.rcptTo === null) {
    return { ok: false, reason: "missing" } as const;
  }

  const sentAt = Number(request.timestamp);

  if (
    !Number.isInteger(sentAt) ||
    Math.abs(request.nowSeconds - sentAt) > INBOUND_REPLAY_WINDOW_SECONDS
  ) {
    return { ok: false, reason: "stale" } as const;
  }

  const expected = hex(
    await hmac(secret, await signedText(request.timestamp, request.rcptTo, request.body)),
  );

  return (await sameSecretValue(secret, expected, request.signature.toLowerCase()))
    ? ({ ok: true } as const)
    : ({ ok: false, reason: "signature" } as const);
}
