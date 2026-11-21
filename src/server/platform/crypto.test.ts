import { expect, test } from "bun:test";

import { createUserKey, openValue, parseMasterKey, sealValue } from "./crypto.ts";
import {
  EXPORT_CHUNK_BYTES,
  createExportWriter,
  decryptExport,
  newExportKey,
} from "../../shared/export-crypto.ts";

const scope = { table: "facts", column: "value_enc", rowId: "fact-1" };

test("seal then open returns the plaintext", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(openValue(masterKey, userKey, scope, sealed)).resolves.toBe("secret resume text");
});

test("ciphertexts carry the format version and never the plaintext", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(sealed.startsWith("v1:1:")).toBe(true);
  expect(sealed).not.toContain("secret resume text");
});

test("opening with a different associated data scope fails", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(
    openValue(masterKey, userKey, { table: "facts", column: "value_enc", rowId: "fact-2" }, sealed),
  ).rejects.toThrow("operation failed for an operation-specific reason");
});

test("shredding the user key makes every value unreadable", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");
  const shredded = { ...userKey, wrappedDek: "AAAAAAAAAAAAAAAAAAAAAA==" };

  expect(openValue(masterKey, userKey, scope, sealed)).resolves.toBe("secret resume text");
  expect(openValue(masterKey, shredded, scope, sealed)).rejects.toThrow(
    "operation failed for an operation-specific reason",
  );
});

test("ciphertexts record their key version and reject mismatched keys", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(openValue(masterKey, { ...userKey, keyVersion: 2 }, scope, sealed)).rejects.toThrow(
    "key version 1",
  );
});

test("parseMasterKey rejects keys that are not 32 bytes", () => {
  expect(() => parseMasterKey("", 1)).toThrow("must decode to 32 bytes");
  expect(() => parseMasterKey(undefined, 1)).toThrow("not set");
  expect(parseMasterKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)).toHaveLength(32);
});

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
