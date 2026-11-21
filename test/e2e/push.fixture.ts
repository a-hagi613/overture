import {
  createDecipheriv,
  createECDH,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

export interface SubscriptionKeys {
  auth: string;
  p256dh: string;
  privateKey: string;
}

const decodedPushSchema = z.object({
  body: z.string(),
  tag: z.string(),
  title: z.string(),
  url: z.string(),
});

export type DecodedPush = z.infer<typeof decodedPushSchema>;

export function vapidKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const raw = publicKey.export({ format: "jwk" });

  if (jwk.d === undefined || raw.x === undefined || raw.y === undefined) {
    throw new Error("The VAPID key pair is incomplete.");
  }

  return {
    privateKey: jwk.d,
    publicKey: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(raw.x, "base64url"),
      Buffer.from(raw.y, "base64url"),
    ]).toString("base64url"),
  };
}

export function subscriptionKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });

  if (jwk.d === undefined || jwk.x === undefined || jwk.y === undefined) {
    throw new Error("The subscription key pair is incomplete.");
  }

  return {
    auth: randomBytes(16).toString("base64url"),
    p256dh: Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from(jwk.y, "base64url"),
    ]).toString("base64url"),
    privateKey: jwk.d,
  };
}

export function decodePush(body: string, keys: SubscriptionKeys) {
  const record = Buffer.from(body, "base64");
  const salt = record.subarray(0, 16);
  const idLength = record[20] ?? 0;
  const serverPublic = record.subarray(21, 21 + idLength);
  const header = record.subarray(0, 21 + idLength);
  const ciphertext = record.subarray(21 + idLength);
  const tag = ciphertext.subarray(-16);
  const sealed = ciphertext.subarray(0, -16);

  const ecdh = createECDH("prime256v1");

  ecdh.setPrivateKey(Buffer.from(keys.privateKey, "base64url"));

  const shared = ecdh.computeSecret(serverPublic);

  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\u0000"),
    Buffer.from(keys.p256dh, "base64url"),
    serverPublic,
  ]);

  const inputKeyMaterial = Buffer.from(
    hkdfSync("sha256", shared, Buffer.from(keys.auth, "base64url"), keyInfo, 32),
  );

  const contentEncryptionKey = Buffer.from(
    hkdfSync(
      "sha256",
      inputKeyMaterial,
      salt,
      Buffer.from("Content-Encoding: aes128gcm\u0000"),
      16,
    ),
  );

  const nonce = Buffer.from(
    hkdfSync("sha256", inputKeyMaterial, salt, Buffer.from("Content-Encoding: nonce\u0000"), 12),
  );

  const decipher = createDecipheriv("aes-128-gcm", contentEncryptionKey, nonce);

  decipher.setAAD(header);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(sealed), decipher.final()]);
  const padding = plaintext.at(-1) ?? 0;
  const json = plaintext.subarray(0, plaintext.length - 1 - (padding === 2 ? 0 : padding));

  return decodedPushSchema.parse(JSON.parse(json.toString("utf8")));
}
