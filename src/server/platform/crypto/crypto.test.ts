import { expect, test } from "vitest";

import { createUserKey, openValue, parseMasterKey, sealValue } from "./index.ts";

const scope = { table: "facts", column: "value_enc", rowId: "fact-1" };

test("seal then open returns the plaintext", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  await expect(openValue(masterKey, userKey, scope, sealed)).resolves.toBe("secret resume text");
});

test("ciphertexts carry the format version and never the plaintext", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  expect(sealed.startsWith("v1:1:")).toBe(true);
  expect(sealed).not.toContain("secret resume text");
});

test("opening with a different scope fails", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");

  await expect(
    openValue(masterKey, userKey, { table: "facts", column: "value_enc", rowId: "fact-2" }, sealed),
  ).rejects.toThrow();
});

test("shredding the user key makes every value unreadable", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterKey, 1);
  const sealed = await sealValue(masterKey, userKey, scope, "secret resume text");
  const shredded = { ...userKey, wrappedDek: "AAAAAAAAAAAAAAAAAAAAAA==" };

  await expect(openValue(masterKey, shredded, scope, sealed)).rejects.toThrow();
  await expect(openValue(masterKey, userKey, scope, sealed)).resolves.toBe("secret resume text");
});

test("ciphertexts sealed under one master key do not open under another", async () => {
  const masterA = crypto.getRandomValues(new Uint8Array(32));
  const masterB = crypto.getRandomValues(new Uint8Array(32));
  const userKey = await createUserKey(masterA, 1);
  const sealed = await sealValue(masterA, userKey, scope, "for owner a only");

  await expect(openValue(masterB, userKey, scope, sealed)).rejects.toThrow();
});

test("parseMasterKey rejects keys that are not 32 bytes", () => {
  expect(() => parseMasterKey("", 1)).toThrow();
  expect(() => parseMasterKey("AAAAAA", 1)).toThrow();
  expect(parseMasterKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)).toHaveLength(32);
});
