import { Buffer } from "node:buffer";
import { z } from "zod";

const noticeSchema = z.object({ name: z.string(), to: z.string() });

const ALGORITHM = "AES-GCM";
const AAD = new TextEncoder().encode("account.deleted.notice");
const IV_BYTES = 12;

function b64(bytes: Uint8Array<ArrayBuffer>) {
  return Buffer.from(bytes).toString("base64");
}

function fromB64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function createDeletionNoticeCrypto(masterKey: Uint8Array<ArrayBuffer>) {
  async function keyFor(usages: KeyUsage[]) {
    return crypto.subtle.importKey("raw", masterKey, { name: ALGORITHM }, false, usages);
  }

  async function seal(notice: z.infer<typeof noticeSchema>) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { additionalData: AAD, iv, name: ALGORITHM },
        await keyFor(["encrypt"]),
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

    const plaintext = await crypto.subtle.decrypt(
      { additionalData: AAD, iv: fromB64(iv), name: ALGORITHM },
      await keyFor(["decrypt"]),
      fromB64(ciphertext),
    );

    return noticeSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  }

  return { open, seal };
}

export const ACCOUNT_DELETED_NOTICE_JOB_KIND = "account.deleted.notice";
