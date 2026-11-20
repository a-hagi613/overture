import { Buffer } from "node:buffer";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = "v1";

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const unb64 = (value: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(value, "base64"));

const utf8 = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value);

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

export function parseMasterKey(
  value: string | undefined,
  version: number,
): Uint8Array<ArrayBuffer> {
  if (value === undefined) {
    throw new Error(
      `MASTER_KEY_V${version} is not set. Generate one with \`openssl rand -base64 32\`.`,
    );
  }

  const bytes = unb64(value.trim());

  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `MASTER_KEY_V${version} must decode to ${KEY_BYTES} bytes (it decodes to ${bytes.length}).`,
    );
  }

  return bytes;
}

async function importAesKey(raw: Uint8Array<ArrayBuffer>, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usages);
}

export async function createUserKey(
  masterKey: Uint8Array<ArrayBuffer>,
  keyVersion: number,
): Promise<StoredUserKey> {
  const dek = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await importAesKey(masterKey, ["encrypt"]);
  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, dek),
  );

  return { keyVersion, wrappedDek: b64(wrappedDek), dekIv: b64(iv) };
}

export async function sealValue(
  masterKey: Uint8Array<ArrayBuffer>,
  userKey: StoredUserKey,
  scope: SealScope,
  plaintext: string,
): Promise<string> {
  const dek = await unwrapDek(masterKey, userKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: utf8(associatedData(scope)) },
      dek,
      utf8(plaintext),
    ),
  );

  const data = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);

  return [FORMAT_VERSION, userKey.keyVersion, b64(iv), b64(tag), b64(data)].join(":");
}

export async function openValue(
  masterKey: Uint8Array<ArrayBuffer>,
  userKey: StoredUserKey,
  scope: SealScope,
  sealed: string,
): Promise<string> {
  const [version, keyVersion, iv, tag, data] = sealed.split(":");

  if (version !== FORMAT_VERSION || iv === undefined || tag === undefined || data === undefined) {
    throw new Error(
      `Unsupported ciphertext: expected ${FORMAT_VERSION}:{{key_version}}:{{iv}}:{{tag}}:{{data}}.`,
    );
  }

  if (keyVersion !== userKey.keyVersion.toString()) {
    throw new Error(
      `Ciphertext was sealed under key version ${keyVersion}, expected ${userKey.keyVersion}.`,
    );
  }

  const dek = await unwrapDek(masterKey, userKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv), additionalData: utf8(associatedData(scope)) },
    dek,
    joinDataAndTag(unb64(data), unb64(tag)),
  );

  return new TextDecoder().decode(plaintext);
}

async function unwrapDek(
  masterKey: Uint8Array<ArrayBuffer>,
  userKey: StoredUserKey,
): Promise<CryptoKey> {
  const key = await importAesKey(masterKey, ["decrypt"]);
  const rawDek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(userKey.dekIv) },
      key,
      unb64(userKey.wrappedDek),
    ),
  );

  return importAesKey(rawDek, ["encrypt", "decrypt"]);
}

function associatedData(scope: SealScope): string {
  return `${scope.table}:${scope.column}:${scope.rowId}`;
}

function joinDataAndTag(
  data: Uint8Array<ArrayBuffer>,
  tag: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(data.length + tag.length);

  joined.set(data);
  joined.set(tag, data.length);

  return joined;
}
