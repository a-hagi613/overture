import { Buffer } from "node:buffer";
import { eq } from "drizzle-orm";

import { createUserKey, IV_BYTES, openValue, sealValue } from "../platform/crypto.ts";
import type { SealScope, StoredUserKey } from "../platform/crypto.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import { userKeys } from "../platform/db/schema.ts";

export interface PersonalCrypto {
  sealFor: (userId: string, scope: SealScope, plaintext: string) => Promise<string>;
  openFor: (userId: string, scope: SealScope, sealed: string) => Promise<string>;
}

export function createPersonalCrypto(
  db: AppDatabase,
  masterKey: Uint8Array<ArrayBuffer>,
  keyVersion: number,
) {
  async function storedKeyFor(userId: string) {
    const rows = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);

    const row = rows.at(0);

    if (row === undefined) {
      const created = await createUserKey(masterKey, keyVersion);
      const now = new Date();

      await db.insert(userKeys).values({
        userId,
        wrappedDek: dekBlob(created),
        masterKeyVersion: keyVersion,
        createdAt: now,
      });

      return created;
    }

    return {
      keyVersion: row.masterKeyVersion,
      dekIv: row.wrappedDek.subarray(0, IV_BYTES).toString("base64"),
      wrappedDek: row.wrappedDek.subarray(IV_BYTES).toString("base64"),
    };
  }

  return {
    sealFor: async (userId: string, scope: SealScope, plaintext: string) => {
      const stored = await storedKeyFor(userId);

      return sealValue(masterKey, stored, scope, plaintext);
    },
    openFor: async (userId: string, scope: SealScope, sealed: string) => {
      const stored = await storedKeyFor(userId);

      return openValue(masterKey, stored, scope, sealed);
    },
  } satisfies PersonalCrypto;
}

function dekBlob(created: StoredUserKey) {
  return Buffer.concat([
    Buffer.from(created.dekIv, "base64"),
    Buffer.from(created.wrappedDek, "base64"),
  ]);
}
