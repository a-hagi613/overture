import { expect, test } from "bun:test";

import {
  createUserKey,
  masterKeyringFor,
  masterKeyChainProblem,
  openValue,
  parseMasterKey,
  parseMasterKeyring,
  rewrapUserKey,
  sealValue,
  storedUserKeyBlob,
  storedUserKeyFromBlob,
} from "./crypto.ts";
import {
  EXPORT_CHUNK_BYTES,
  createExportWriter,
  decryptExport,
  newExportKey,
} from "../../shared/export-crypto.ts";

const scope = { table: "facts", column: "value_enc", rowId: "fact-1" };

function keyVersionBytes(fill: number) {
  return new Uint8Array(32).fill(fill);
}

function encodedKey(fill: number) {
  return Buffer.from(keyVersionBytes(fill)).toString("base64");
}

async function seal(parts: Uint8Array<ArrayBuffer>[], key: string) {
  const writer = await createExportWriter(key);

  const sealed = [
    writer.header,
    ...(await Promise.all(parts.map(async (part) => writer.encrypt(part)))),
  ];

  const total = sealed.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);

  let at = 0;

  for (const part of sealed) {
    bytes.set(part, at);
    at += part.length;
  }

  return bytes;
}

async function open(bytes: Uint8Array<ArrayBuffer>, key: string, step = 4096) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of decryptExport(
    key,
    (async function* source() {
      await Promise.resolve();

      for (let at = 0; at < bytes.length; at += step) {
        yield bytes.subarray(at, at + step);
      }
    })(),
  )) {
    chunks.push(chunk);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const plain = new Uint8Array(total);

  let at = 0;

  for (const chunk of chunks) {
    plain.set(chunk, at);
    at += chunk.length;
  }

  return plain;
}

const exportPlain = new TextEncoder().encode("the resume, the messages and the facts");

test("seal then open returns the plaintext", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const sealed = await sealValue(keyring, userKey, scope, "secret resume text");

  expect(openValue(keyring, userKey, scope, sealed)).resolves.toBe("secret resume text");
});

test("ciphertexts carry the format version and never the plaintext", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const sealed = await sealValue(keyring, userKey, scope, "secret resume text");

  expect(sealed.startsWith("v1:1:")).toBe(true);
  expect(sealed).not.toContain("secret resume text");
});

test("opening with a different associated data scope fails", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const sealed = await sealValue(keyring, userKey, scope, "secret resume text");

  expect(
    openValue(keyring, userKey, { table: "facts", column: "value_enc", rowId: "fact-2" }, sealed),
  ).rejects.toThrow("operation failed for an operation-specific reason");
});

test("a user-bound scope binds the person into the associated data", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);

  const bound = {
    table: "mail_objects",
    column: "body",
    rowId: "mail/user-a/raw/1.eml",
    userId: "user-a",
  };

  const sealed = await sealValue(keyring, userKey, bound, "the raw message");

  expect(openValue(keyring, userKey, bound, sealed)).resolves.toBe("the raw message");
});

test("an object sealed before user_id was bound still opens through the legacy fallback", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const legacy = { table: "mail_objects", column: "body", rowId: "mail/user-a/raw/1.eml" };
  const sealed = await sealValue(keyring, userKey, legacy, "the raw message");

  expect(openValue(keyring, userKey, { ...legacy, userId: "user-a" }, sealed)).resolves.toBe(
    "the raw message",
  );
});

test("a user-bound ciphertext is refused for another person's scope", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const scopeA = { table: "resumes", column: "bytes", rowId: "resume-1", userId: "user-a" };
  const sealed = await sealValue(keyring, userKey, scopeA, "the pdf");

  expect(openValue(keyring, userKey, { ...scopeA, userId: "user-b" }, sealed)).rejects.toThrow(
    "operation failed for an operation-specific reason",
  );
});

test("shredding the user key makes every value unreadable", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const sealed = await sealValue(keyring, userKey, scope, "secret resume text");
  const shredded = { ...userKey, wrappedDek: "AAAAAAAAAAAAAAAAAAAAAA==" };

  expect(openValue(keyring, userKey, scope, sealed)).resolves.toBe("secret resume text");
  expect(openValue(keyring, shredded, scope, sealed)).rejects.toThrow(
    "matches none of the configured master keys",
  );
});

test("a re-wrap leaves every ciphertext sealed with the same data key readable", async () => {
  const v1 = keyVersionBytes(1);
  const before = masterKeyringFor(v1);

  const during = parseMasterKeyring(
    { MASTER_KEY_CURRENT: "2", MASTER_KEY_V1: encodedKey(1), MASTER_KEY_V2: encodedKey(2) },
    2,
  );

  const userKey = await createUserKey(before.current.bytes, 1);
  const sealedOld = await sealValue(before, userKey, scope, "sealed under v1");

  const rewrapped = await rewrapUserKey(during, userKey, 2);

  expect(rewrapped.keyVersion).toBe(2);

  expect(openValue(during, rewrapped, scope, sealedOld)).resolves.toBe("sealed under v1");

  const sealedNew = await sealValue(during, rewrapped, scope, "sealed under v2");

  expect(sealedNew.startsWith("v1:2:")).toBe(true);
  expect(openValue(during, rewrapped, scope, sealedNew)).resolves.toBe("sealed under v2");
  expect(openValue(during, { ...rewrapped, keyVersion: 1 }, scope, sealedOld)).resolves.toBe(
    "sealed under v1",
  );

  const v2Only = parseMasterKeyring({ MASTER_KEY_CURRENT: "2", MASTER_KEY_V2: encodedKey(2) }, 2);

  expect(openValue(v2Only, rewrapped, scope, sealedOld)).resolves.toBe("sealed under v1");
});

test("a row wrapped under a removed master key cannot be opened", async () => {
  const userKey = await createUserKey(keyVersionBytes(1), 1);
  const v2Only = parseMasterKeyring({ MASTER_KEY_CURRENT: "2", MASTER_KEY_V2: encodedKey(2) }, 2);

  expect(openValue(v2Only, userKey, scope, "v1:1:aaaa:bbbb:cccc")).rejects.toThrow(
    "matches none of the configured master keys",
  );
});

test("the stored blob is the iv followed by the wrapped data key", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);
  const stored = storedUserKeyFromBlob(storedUserKeyBlob(userKey), userKey.keyVersion);

  expect(stored).toStrictEqual(userKey);
});

test("ciphertexts with a missing, extra or non-numeric segment are refused before any decryption", async () => {
  const keyring = masterKeyringFor(keyVersionBytes(1));
  const userKey = await createUserKey(keyring.current.bytes, 1);

  expect(openValue(keyring, userKey, scope, "v1:1:aaaa:bbbb")).rejects.toThrow(
    "Unsupported ciphertext",
  );
  expect(openValue(keyring, userKey, scope, "v1:1:aaaa:bbbb:cccc:dddd")).rejects.toThrow(
    "Unsupported ciphertext",
  );
  expect(openValue(keyring, userKey, scope, "v1:two:aaaa:bbbb:cccc")).rejects.toThrow(
    "Unsupported ciphertext",
  );
  expect(openValue(keyring, userKey, scope, "v1:0:aaaa:bbbb:cccc")).rejects.toThrow(
    "Unsupported ciphertext",
  );
});

test("parseMasterKey rejects keys that are not 32 bytes", () => {
  expect(() => parseMasterKey("", 1)).toThrow("must decode to 32 bytes");
  expect(() => parseMasterKey(undefined, 1)).toThrow("not set");
  expect(parseMasterKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)).toHaveLength(32);
});

test("MASTER_KEY_CURRENT above one needs every key in the chain", () => {
  const v1 = encodedKey(1);
  const v2 = encodedKey(2);
  const v3 = encodedKey(3);

  expect(masterKeyChainProblem({ MASTER_KEY_V1: v1 }, 1)).toBeUndefined();
  expect(masterKeyChainProblem({ MASTER_KEY_V1: v1 }, 2)).toContain("MASTER_KEY_V2 is not set");
  expect(masterKeyChainProblem({ MASTER_KEY_V1: v1, MASTER_KEY_V2: v2 }, 2)).toBeUndefined();
  expect(masterKeyChainProblem({ MASTER_KEY_V1: v1, MASTER_KEY_V3: v3 }, 3)).toContain(
    "MASTER_KEY_V2 is missing",
  );
  expect(masterKeyChainProblem({ MASTER_KEY_V2: v2 }, 2)).toBeUndefined();

  const ring = parseMasterKeyring({ MASTER_KEY_V1: v1, MASTER_KEY_V2: v2 }, 2);

  expect(ring.current.version).toBe(2);
  expect(ring.keys.map((key) => key.version)).toEqual([1, 2]);
  expect(() => parseMasterKeyring({ MASTER_KEY_V1: v1 }, 2)).toThrow("MASTER_KEY_V2 is not set");
});

test("a pre-staged version above MASTER_KEY_CURRENT is accepted and validated", () => {
  const ring = parseMasterKeyring(
    { MASTER_KEY_CURRENT: "1", MASTER_KEY_V1: encodedKey(1), MASTER_KEY_V2: encodedKey(2) },
    1,
  );

  expect(ring.current.version).toBe(1);
  expect(ring.keys.map((key) => key.version)).toEqual([1, 2]);
  expect(() =>
    parseMasterKeyring(
      { MASTER_KEY_CURRENT: "1", MASTER_KEY_V1: encodedKey(1), MASTER_KEY_V2: "not-a-key" },
      1,
    ),
  ).toThrow("MASTER_KEY_V2 must decode to 32 bytes");
});

test("the sealed archive opens to every part in order", async () => {
  const linkKey = newExportKey();
  const sealed = await seal([exportPlain, new TextEncoder().encode(" and more")], linkKey);

  expect(new TextDecoder().decode(await open(sealed, linkKey))).toBe(
    "the resume, the messages and the facts and more",
  );
});

test("the plaintext does not appear in the encrypted archive", async () => {
  const linkKey = newExportKey();
  const sealed = await seal([exportPlain], linkKey);

  expect(new TextDecoder("latin1").decode(sealed)).not.toContain("the resume");
  expect(new TextDecoder().decode(await open(sealed, linkKey))).toContain("the resume");
});

test("an archive with more than sixteen chunks round-trips", async () => {
  const linkKey = newExportKey();
  const parts = Array.from({ length: 17 }, () => new Uint8Array(EXPORT_CHUNK_BYTES).fill(7));
  const sealed = await seal(parts, linkKey);

  expect(sealed.length).toBeGreaterThan(16 * EXPORT_CHUNK_BYTES);

  const plain = await open(sealed, linkKey, 64 * 1024);

  expect(plain.length).toBe(17 * EXPORT_CHUNK_BYTES);
  expect(plain[0]).toBe(7);
  expect(plain.at(-1)).toBe(7);
});

test("a different key cannot decrypt the archive", async () => {
  const sealed = await seal([exportPlain], newExportKey());

  expect(open(sealed, newExportKey())).rejects.toThrow();
});

test("a changed byte fails the chunk's authentication", async () => {
  const linkKey = newExportKey();
  const sealed = await seal([exportPlain], linkKey);

  sealed[sealed.length - 20] = ((sealed.at(-20) ?? 0) + 1) % 256;

  expect(open(sealed, linkKey)).rejects.toThrow();
});

test("a truncated archive is refused", async () => {
  const linkKey = newExportKey();
  const sealed = await seal([exportPlain], linkKey);

  expect(open(sealed.subarray(0, -8), linkKey)).rejects.toThrow();
});

test("the key is 32 random bytes encoded for a URL fragment", () => {
  const key = newExportKey();

  expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(newExportKey()).not.toBe(key);
});
