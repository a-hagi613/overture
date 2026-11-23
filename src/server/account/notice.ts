import { Buffer } from "node:buffer";
import { z } from "zod";

import type { MasterKey, MasterKeyring } from "../platform/crypto.ts";

const noticeSchema = z.object({ name: z.string(), to: z.string() });

type Notice = z.infer<typeof noticeSchema>;

const ALGORITHM = "AES-GCM";
const AAD = new TextEncoder().encode("account.deleted.notice");
const IV_BYTES = 12;

function b64(bytes: Uint8Array<ArrayBuffer>) {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function keyFor(masterKey: Uint8Array<ArrayBuffer>, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", masterKey, { name: ALGORITHM }, false, usages);
}

async function openWith(keys: readonly MasterKey[], iv: string, ciphertext: string) {
  const attempts = keys.map(async (key) => {
    const plaintext = await crypto.subtle.decrypt(
      { additionalData: AAD, iv: fromB64(iv), name: ALGORITHM },
      await keyFor(key.bytes, ["decrypt"]),
      fromB64(ciphertext),
    );

    return noticeSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  });

  const settled = await Promise.allSettled(attempts);

  const opened = settled.find(
    (result): result is PromiseFulfilledResult<Notice> => result.status === "fulfilled",
  );

  if (opened === undefined) {
    throw new Error("the deletion notice payload matches no configured master key");
  }

  return opened.value;
}

/**
 * Seals the deleted-account notice with the current master key and opens one sealed under it or
 * under any older key still configured, so a notice queued before a rotation still opens.
 * @param keyring The current master key and every older key in the dual-read window.
 * @returns The seal and open functions for the notice payload.
 */
export function createDeletionNoticeCrypto(keyring: MasterKeyring) {
  async function seal(notice: Notice) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { additionalData: AAD, iv, name: ALGORITHM },
        await keyFor(keyring.current.bytes, ["encrypt"]),
        new TextEncoder().encode(JSON.stringify(notice)),
      ),
    );

    return `${b64(iv)}:${b64(sealed)}`;
  }

  async function open(sealed: string) {
    const [iv, ciphertext] = sealed.split(":");

    if (iv === undefined || ciphertext === undefined) {
      throw new Error("the deletion notice payload is not sealed");
    }

    const older = keyring.keys
      .toReversed()
      .filter((key) => key.version !== keyring.current.version);

    return openWith([keyring.current, ...older], iv, ciphertext);
  }

  return { open, seal };
}

export const ACCOUNT_DELETED_NOTICE_JOB_KIND = "account.deleted.notice";
