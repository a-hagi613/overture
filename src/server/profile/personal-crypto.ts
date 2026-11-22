import { Buffer } from "node:buffer";
import { eq } from "drizzle-orm";

import { createUserKey, IV_BYTES, openValue, sealValue } from "../platform/crypto.ts";
import type { SealScope, StoredUserKey } from "../platform/crypto.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import { userKeys } from "../platform/db/schema.ts";

const KEY_CACHE_USERS = 1000;

export interface PersonalCrypto {
  sealFor: (userId: string, scope: SealScope, plaintext: string) => Promise<string>;
  openFor: (userId: string, scope: SealScope, sealed: string) => Promise<string>;
  /** Drops a person's cached key, so a deletion leaves no decryptable key in memory. */
  forget: (userId: string) => void;
}

/**
 * Seals and opens a person's values with their wrapped data key. The wrapped
 * key is read once and kept for the process, keyed by person, because it never
 * changes for them; the cache holds at most 1000 people and `forget` drops an
 * entry so account erasure leaves no decryptable key in memory.
 * @param db The database the wrapped keys live in.
 * @param masterKey The master key that wraps each person's data key.
 * @param keyVersion The master key version new data keys are wrapped under.
 * @returns The per-person seal and open functions.
 */
export function createPersonalCrypto(
  db: AppDatabase,
  masterKey: Uint8Array<ArrayBuffer>,
  keyVersion: number,
) {
  const keys = new Map<string, StoredUserKey>();
  const pending = new Map<string, Promise<StoredUserKey>>();

  function remember(userId: string, stored: StoredUserKey) {
    if (!keys.has(userId) && keys.size >= KEY_CACHE_USERS) {
      const oldest = keys.keys().next().value;

      if (oldest !== undefined) {
        keys.delete(oldest);
      }
    }

    keys.delete(userId);
    keys.set(userId, stored);

    return stored;
  }

  async function readOrCreateKey(userId: string) {
    const rows = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);

    const row = rows.at(0);

    if (row === undefined) {
      const created = await createUserKey(masterKey, keyVersion);

      const inserted = db
        .insert(userKeys)
        .values({
          userId,
          wrappedDek: dekBlob(created),
          masterKeyVersion: keyVersion,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .returning()
        .all()
        .at(0);

      const winner =
        inserted ??
        (await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1)).at(0);

      if (winner === undefined) {
        throw new Error("the user key could not be created");
      }

      return remember(userId, {
        dekIv: winner.wrappedDek.subarray(0, IV_BYTES).toString("base64"),
        keyVersion: winner.masterKeyVersion,
        wrappedDek: winner.wrappedDek.subarray(IV_BYTES).toString("base64"),
      });
    }

    return remember(userId, {
      dekIv: row.wrappedDek.subarray(0, IV_BYTES).toString("base64"),
      keyVersion: row.masterKeyVersion,
      wrappedDek: row.wrappedDek.subarray(IV_BYTES).toString("base64"),
    });
  }

  async function storedKeyFor(userId: string) {
    const cached = keys.get(userId);

    if (cached !== undefined) {
      return remember(userId, cached);
    }

    const inFlight = pending.get(userId);

    if (inFlight !== undefined) {
      return inFlight;
    }

    const loading = loadAndForget(userId);

    pending.set(userId, loading);

    return loading;
  }

  async function loadAndForget(userId: string) {
    try {
      return await readOrCreateKey(userId);
    } finally {
      pending.delete(userId);
    }
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
    forget: (userId: string) => {
      keys.delete(userId);
      pending.delete(userId);
    },
  } satisfies PersonalCrypto;
}

function dekBlob(created: StoredUserKey) {
  return Buffer.concat([
    Buffer.from(created.dekIv, "base64"),
    Buffer.from(created.wrappedDek, "base64"),
  ]);
}
