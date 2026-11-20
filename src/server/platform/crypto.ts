import { Buffer } from "node:buffer";

export interface StoredUserKey {
  keyVersion: number;
  wrappedDek: string;
  dekIv: string;
}

export interface SealScope {
  table: string;
  column: string;
  rowId: string;
}

export function parseMasterKey(value: string | undefined, version: number) {
  if (value === undefined) {
    throw new Error(`MASTER_KEY_V${version} is not set.`);
  }

  const bytes = Buffer.from(value.trim(), "base64");

  if (bytes.length !== 32) {
    throw new Error(
      `MASTER_KEY_V${version} must decode to 32 bytes (it decodes to ${bytes.length}).`,
    );
  }

  return new Uint8Array(bytes);
}

function associatedData(scope: SealScope) {
  return `${scope.table}:${scope.column}:${scope.rowId}`;
}

function joinDataAndTag(data: Uint8Array<ArrayBuffer>, tag: Uint8Array<ArrayBuffer>) {
  const joined = new Uint8Array(data.length + tag.length);

  joined.set(data);
  joined.set(tag, data.length);

  return joined;
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);
}

async function unwrapDek(masterKey: Uint8Array<ArrayBuffer>, userKey: StoredUserKey) {
  const aesKey = await importAesKey(masterKey, ["decrypt"]);
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(Buffer.from(userKey.dekIv, "base64")) },
      aesKey,
      Buffer.from(userKey.wrappedDek, "base64"),
    ),
  );

  return crypto.subtle.importKey("raw", dek, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function createUserKey(masterKey: Uint8Array<ArrayBuffer>, keyVersion: number) {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await importAesKey(masterKey, ["encrypt"]);
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, dek),
  );

  return {
    keyVersion,
    wrappedDek: Buffer.from(wrappedDek).toString("base64"),
    dekIv: Buffer.from(iv).toString("base64"),
  };
}

export async function sealValue(
  masterKey: Uint8Array<ArrayBuffer>,
  userKey: StoredUserKey,
  scope: SealScope,
  plaintext: string,
) {
  const dek = await unwrapDek(masterKey, userKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(associatedData(scope)) },
      dek,
      new TextEncoder().encode(plaintext),
    ),
  );

  const data = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);

  return ["v1", userKey.keyVersion, b64of(iv), b64of(tag), b64of(data)].join(":");
}

export async function openValue(
  masterKey: Uint8Array<ArrayBuffer>,
  userKey: StoredUserKey,
  scope: SealScope,
  sealed: string,
) {
  const [version, keyVersion, iv, tag, data] = sealed.split(":");

  if (
    version !== "v1" ||
    keyVersion === undefined ||
    iv === undefined ||
    tag === undefined ||
    data === undefined
  ) {
    throw new Error("Unsupported ciphertext: expected v1:{key_version}:{iv}:{tag}:{data}.");
  }

  if (keyVersion !== userKey.keyVersion.toString()) {
    throw new Error(
      `Ciphertext was sealed under key version ${keyVersion}, expected ${userKey.keyVersion}.`,
    );
  }

  const dek = await unwrapDek(masterKey, userKey);
  const joined = joinDataAndTag(
    new Uint8Array(Buffer.from(data, "base64")),
    new Uint8Array(Buffer.from(tag, "base64")),
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(Buffer.from(iv, "base64")),
      additionalData: new TextEncoder().encode(associatedData(scope)),
    },
    dek,
    joined,
  );

  return new TextDecoder().decode(plaintext);
}

function b64of(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}
