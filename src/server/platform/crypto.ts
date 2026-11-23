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

/** One master key, at the version it is stored under. */
export interface MasterKey {
  version: number;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Every master key this process may read with. `current` wraps new data keys; the older
 * keys still in `keys` only open rows and notices written before a rotation reached them.
 */
export interface MasterKeyring {
  current: MasterKey;
  /** Every configured master key, oldest first. */
  keys: readonly MasterKey[];
}

export const IV_BYTES = 12;

const MASTER_KEY_NAME = /^MASTER_KEY_V(?<version>\d+)$/u;

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

function configuredVersions(source: Record<string, string | undefined>) {
  return Object.keys(source)
    .flatMap((name) => {
      const version = MASTER_KEY_NAME.exec(name)?.groups?.version;

      return version === undefined ? [] : [Number(version)];
    })
    .toSorted((left, right) => left - right);
}

/**
 * The reason `MASTER_KEY_CURRENT` cannot be trusted with the configured keys, if any. The
 * chain must reach the current version without a gap: a missing middle version means rows
 * wrapped under it can never be opened again.
 * @param source The environment names and values.
 * @param currentVersion The configured `MASTER_KEY_CURRENT`.
 * @returns A clear operator message, or undefined when the chain is whole.
 */
export function masterKeyChainProblem(
  source: Record<string, string | undefined>,
  currentVersion: number,
) {
  const versions = configuredVersions(source);

  if (!versions.includes(currentVersion)) {
    return `MASTER_KEY_V${currentVersion} is not set: MASTER_KEY_CURRENT=${String(currentVersion)} needs its own master key.`;
  }

  const lowest = versions[0] ?? currentVersion;

  const gap = Array.from(
    { length: currentVersion - lowest },
    (_unused, index) => lowest + index,
  ).find((version) => !versions.includes(version));

  return gap === undefined
    ? undefined
    : `MASTER_KEY_V${gap} is missing: MASTER_KEY_CURRENT=${String(currentVersion)} needs every master key from V${String(lowest)} to V${String(currentVersion)}, so rows still wrapped under an older key keep opening.`;
}

/**
 * Reads every configured master key. Older versions stay in the ring for the dual-read window
 * during a rotation; a version above `MASTER_KEY_CURRENT` is allowed so the new secret can be
 * deployed before the version is raised.
 * @param source The environment names and values.
 * @param currentVersion The configured `MASTER_KEY_CURRENT`.
 * @returns The current key and every configured key, oldest first.
 */
export function parseMasterKeyring(
  source: Record<string, string | undefined>,
  currentVersion: number,
) {
  const problem = masterKeyChainProblem(source, currentVersion);

  if (problem !== undefined) {
    throw new Error(problem);
  }

  const keys = configuredVersions(source).map(
    (version) =>
      ({
        version,
        bytes: parseMasterKey(source[`MASTER_KEY_V${String(version)}`], version),
      }) satisfies MasterKey,
  );

  const current = keys.find((key) => key.version === currentVersion);

  if (current === undefined) {
    throw new Error(
      `MASTER_KEY_V${String(currentVersion)} is not set: MASTER_KEY_CURRENT=${String(currentVersion)} needs its own master key.`,
    );
  }

  return { current, keys };
}

/**
 * A ring of one key, for tests, scripts and the unchanged `MASTER_KEY_CURRENT=1` deployment.
 * @param bytes The 32-byte master key.
 * @param version The version to record for it.
 * @returns The ring holding just that key.
 */
export function masterKeyringFor(bytes: Uint8Array<ArrayBuffer>, version = 1) {
  const key = { version, bytes };

  return { current: key, keys: [key] };
}

/**
 * The stored row shape, from the `iv || wrapped_dek` blob `user_keys` keeps.
 * @param blob The `iv || wrapped_dek` bytes.
 * @param keyVersion The row's `master_key_version`.
 * @returns The row's wrapped data key.
 */
export function storedUserKeyFromBlob(blob: Uint8Array, keyVersion: number) {
  const bytes = Buffer.from(blob);

  return {
    dekIv: bytes.subarray(0, IV_BYTES).toString("base64"),
    keyVersion,
    wrappedDek: bytes.subarray(IV_BYTES).toString("base64"),
  };
}

/**
 * The `iv || wrapped_dek` blob `user_keys.wrapped_dek` keeps.
 * @param userKey The row's wrapped data key.
 * @returns The bytes to store.
 */
export function storedUserKeyBlob(userKey: StoredUserKey) {
  return Buffer.concat([
    Buffer.from(userKey.dekIv, "base64"),
    Buffer.from(userKey.wrappedDek, "base64"),
  ]);
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

function candidateMasterKeys(keyring: MasterKeyring, version: number) {
  const ordered: MasterKey[] = [];

  const add = (key: MasterKey | undefined) => {
    if (key !== undefined && !ordered.some((candidate) => candidate.version === key.version)) {
      ordered.push(key);
    }
  };

  add(keyring.keys.find((key) => key.version === version));
  add(keyring.current);

  for (const key of keyring.keys.toReversed()) {
    add(key);
  }

  return ordered;
}

const unwrapWith: (
  keys: readonly MasterKey[],
  iv: Uint8Array<ArrayBuffer>,
  wrapped: Uint8Array<ArrayBuffer>,
) => Promise<Uint8Array<ArrayBuffer>> = async (keys, iv, wrapped) => {
  const [first, ...rest] = keys;

  if (first === undefined) {
    throw new Error("The wrapped data key matches none of the configured master keys.");
  }

  try {
    const aesKey = await importAesKey(first.bytes, ["decrypt"]);

    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, wrapped));
  } catch (error) {
    if (rest.length === 0) {
      throw new Error("The wrapped data key matches none of the configured master keys.", {
        cause: error,
      });
    }

    return unwrapWith(rest, iv, wrapped);
  }
};

async function unwrapDekBytes(keyring: MasterKeyring, userKey: StoredUserKey) {
  const iv = new Uint8Array(Buffer.from(userKey.dekIv, "base64"));
  const wrapped = new Uint8Array(Buffer.from(userKey.wrappedDek, "base64"));

  return unwrapWith(candidateMasterKeys(keyring, userKey.keyVersion), iv, wrapped);
}

async function wrapDekBytes(masterKey: MasterKey, dek: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await importAesKey(masterKey.bytes, ["encrypt"]);

  const wrappedDek = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, dek),
  );

  return {
    dekIv: Buffer.from(iv).toString("base64"),
    wrappedDek: Buffer.from(wrappedDek).toString("base64"),
  };
}

export async function createUserKey(masterKey: Uint8Array<ArrayBuffer>, keyVersion: number) {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await wrapDekBytes({ version: keyVersion, bytes: masterKey }, dek);

  return {
    keyVersion,
    ...wrapped,
  };
}

/**
 * Re-wraps a person's same data key under another configured master key. The DEK itself never
 * changes, so every ciphertext sealed with it — whatever version it recorded — keeps opening.
 * @param keyring The configured keys, including the one that wrapped the row and the target.
 * @param userKey The row's wrapped data key.
 * @param toVersion The master-key version to wrap the data key under.
 * @returns The row's key wrapped under `toVersion`.
 */
export async function rewrapUserKey(
  keyring: MasterKeyring,
  userKey: StoredUserKey,
  toVersion: number,
) {
  const target = keyring.keys.find((key) => key.version === toVersion);

  if (target === undefined) {
    throw new Error(
      `MASTER_KEY_V${String(toVersion)} is not configured, so a data key cannot be wrapped under it.`,
    );
  }

  const dek = await unwrapDekBytes(keyring, userKey);
  const wrapped = await wrapDekBytes(target, dek);

  return { keyVersion: toVersion, ...wrapped };
}

export async function sealValue(
  keyring: MasterKeyring,
  userKey: StoredUserKey,
  scope: SealScope,
  plaintext: string,
) {
  const dek = await crypto.subtle.importKey(
    "raw",
    await unwrapDekBytes(keyring, userKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(associatedData(scope)) },
      dek,
      new TextEncoder().encode(plaintext),
    ),
  );

  const data = sealed.subarray(0, -16);
  const tag = sealed.subarray(-16);

  return ["v1", userKey.keyVersion, b64of(iv), b64of(tag), b64of(data)].join(":");
}

export async function openValue(
  keyring: MasterKeyring,
  userKey: StoredUserKey,
  scope: SealScope,
  sealed: string,
) {
  const parts = sealed.split(":");

  if (parts.length !== 5) {
    throw new Error("Unsupported ciphertext: expected v1:{key_version}:{iv}:{tag}:{data}.");
  }

  const [version, keyVersion, iv, tag, data] = parts;

  if (
    version !== "v1" ||
    keyVersion === undefined ||
    !/^[1-9]\d*$/u.test(keyVersion) ||
    iv === undefined ||
    tag === undefined ||
    data === undefined
  ) {
    throw new Error("Unsupported ciphertext: expected v1:{key_version}:{iv}:{tag}:{data}.");
  }

  const dek = await crypto.subtle.importKey(
    "raw",
    await unwrapDekBytes(keyring, userKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

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
