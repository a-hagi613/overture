import { Buffer } from "node:buffer";

import { env } from "../../config/env.ts";
import { isAllowedPushEndpoint } from "./endpoint.ts";
import type { Clock } from "../ports/clock.ts";
import type { PushPayload, PushSender, PushSubscription } from "../ports/push.ts";

const RECORD_SIZE = 4096;
const PUSH_TIMEOUT_MS = 30_000;
const VAPID_TTL_SECONDS = 12 * 60 * 60;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const TEXT_ENCODER = new TextEncoder();

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const fromBase64url = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));

function coordinateJwk(publicKey: Uint8Array, privateKey: Uint8Array) {
  if (publicKey.byteLength !== 65 || publicKey[0] !== 4) {
    throw new Error("VAPID_PUBLIC_KEY must be a base64url-encoded uncompressed P-256 point.");
  }

  return {
    kty: "EC",
    crv: "P-256",
    d: base64url(privateKey),
    x: base64url(publicKey.subarray(1, 33)),
    y: base64url(publicKey.subarray(33, 65)),
  };
}

async function importVapidKeys(config: VapidConfig) {
  const publicKey = fromBase64url(config.publicKey);

  const rawPrivate = config.privateKey.startsWith("-----BEGIN")
    ? null
    : fromBase64url(config.privateKey);

  if (rawPrivate === null) {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      fromBase64url(config.privateKey.replaceAll(/-----[^-]+-----/gu, "").replaceAll(/\s/gu, "")),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    return { privateKey, publicKeyBase64url: config.publicKey };
  }

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    coordinateJwk(publicKey, rawPrivate),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  return { privateKey, publicKeyBase64url: config.publicKey };
}

async function vapidAuthorization(
  endpoint: string,
  config: VapidConfig,
  clock: Clock,
  keys: Awaited<ReturnType<typeof importVapidKeys>>,
) {
  const audience = new URL(endpoint).origin;
  const header = base64url(TEXT_ENCODER.encode(JSON.stringify({ alg: "ES256", typ: "JWT" })));

  const claims = base64url(
    TEXT_ENCODER.encode(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(clock.now() / 1000) + VAPID_TTL_SECONDS,
        sub: config.subject,
      }),
    ),
  );

  const unsigned = `${header}.${claims}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    TEXT_ENCODER.encode(unsigned),
  );

  return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${keys.publicKeyBase64url}`;
}

async function hkdf(input: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(input), "HKDF", false, [
    "deriveBits",
  ]);

  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(salt), info: new Uint8Array(info) },
    key,
    length * 8,
  );

  return new Uint8Array(bits);
}

const concat = (parts: readonly Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }

  return joined;
};

async function encryptPayload(subscription: PushSubscription, payload: PushPayload) {
  const userAgentKey = fromBase64url(subscription.keys.p256dh);
  const authSecret = fromBase64url(subscription.keys.auth);

  const userAgentPublic = await crypto.subtle.importKey(
    "raw",
    userAgentKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);

  const ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: userAgentPublic },
      ephemeral.privateKey,
      256,
    ),
  );

  const keyInfo = concat([
    TEXT_ENCODER.encode("WebPush: info\u0000"),
    userAgentKey,
    ephemeralPublic,
  ]);

  const inputKeyMaterial = await hkdf(sharedSecret, authSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const contentEncryptionKey = await hkdf(
    inputKeyMaterial,
    salt,
    TEXT_ENCODER.encode("Content-Encoding: aes128gcm\u0000"),
    16,
  );

  const nonce = await hkdf(
    inputKeyMaterial,
    salt,
    TEXT_ENCODER.encode("Content-Encoding: nonce\u0000"),
    12,
  );

  const plaintext = concat([TEXT_ENCODER.encode(JSON.stringify(payload)), new Uint8Array([0x02])]);

  if (plaintext.byteLength > RECORD_SIZE) {
    throw new Error("The push payload is larger than one 4096-byte record.");
  }

  const header = new Uint8Array(16 + 4 + 1 + ephemeralPublic.byteLength);

  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = ephemeralPublic.byteLength;
  header.set(ephemeralPublic, 21);

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: header, tagLength: 128 },
    await crypto.subtle.importKey("raw", contentEncryptionKey, "AES-GCM", false, ["encrypt"]),
    plaintext,
  );

  return concat([header, new Uint8Array(cipher)]);
}

export function createWebPushSender(config: VapidConfig, clock: Clock) {
  let keysPromise: ReturnType<typeof importVapidKeys> | null = null;

  async function keys() {
    keysPromise ??= importVapidKeys(config);

    return keysPromise;
  }

  const sender: PushSender = {
    send: async (subscription, payload) => {
      if (!isAllowedPushEndpoint(subscription.endpoint, env.NODE_ENV)) {
        throw new Error("A push endpoint must be an HTTPS address of a known push service.");
      }

      const body = await encryptPayload(subscription, payload);

      const authorization = await vapidAuthorization(
        subscription.endpoint,
        config,
        clock,
        await keys(),
      );

      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization,
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(PUSH_TTL_SECONDS),
          urgency: "normal",
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });

      if (response.status === 404 || response.status === 410) {
        return "gone";
      }

      if (!response.ok) {
        throw new Error(`The push endpoint answered ${String(response.status)}.`);
      }

      return "ok";
    },
  };

  return sender;
}
