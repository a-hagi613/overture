import { expect, test } from "@playwright/test";

import {
  createUserKey,
  openValue,
  parseMasterKey,
  sealValue,
} from "../../src/server/platform/crypto/index.ts";

const scope = { table: "facts", column: "value_enc", rowId: "fact-1" };

test("seal then open returns the plaintext", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  await expect(openValue(masterKey, userKey, scope, sealed)).resolves.toBe("secret resume text");
});

test("ciphertext format is v1:{key_version}:{iv}:{tag}:{data}", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(sealed).toMatch(/^v1:1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/u);
  expect(sealed).not.toContain("secret resume text");
});

test("opening with a different associated data scope fails", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  await expect(
    openValue(masterKey, userKey, { table: "facts", column: "value_enc", rowId: "fact-2" }, sealed),
  ).rejects.toThrow();
});

test("a different user key cannot open the value", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const other = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, await createUserKey(masterKey, 2), scope, "text");

  await expect(openValue(masterKey, other, scope, sealed)).rejects.toThrow();
});

test("the open value never fails on a fresh identical key", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  await expect(openValue(masterKey, userKey, scope, sealed)).resolves.not.toContain("v1:");
});

test("parseMasterKey rejects keys that are not 32 bytes", () => {
  expect(() => parseMasterKey("", 1)).toThrow();
  expect(() => parseMasterKey("AAAAAA", 1)).toThrow();
  expect(parseMasterKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)).toHaveLength(32);
});
