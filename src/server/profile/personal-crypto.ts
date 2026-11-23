import { eq } from "drizzle-orm";

import {
  createUserKey,
  openValue,
  sealValue,
  storedUserKeyBlob,
  storedUserKeyFromBlob,
} from "../platform/crypto.ts";
import type { MasterKeyring, SealScope, StoredUserKey } from "../platform/crypto.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import { userKeys } from "../platform/db/schema.ts";
import { logError } from "../platform/log.ts";

const KEY_CACHE_USERS = 1000;

export interface PersonalCrypto {
  sealFor: (userId: string, scope: SealScope, plaintext: string) => Promise<string>;
  openFor: (userId: string, scope: SealScope, sealed: string) => Promise<string>;
  /** Drops a person's cached key, so a deletion leaves no decryptable key in memory. */
  forget: (userId: string) => void;
}

interface PendingLoad {
  promise: Promise<StoredUserKey>;
  token: LoadToken;
}

interface LoadToken {
  readonly kind: "personal-key-load";
}

/**
 * Seals and opens a person's values with their wrapped data key. The wrapped
 * key is read once and kept for the process, keyed by person, because it never
 * changes for them; the cache holds at most 1000 people and `forget` drops an
 * entry. A load that was already in flight when the person was forgotten
 * notices its replaced pending token and returns the key without caching it, so
 * account erasure leaves no decryptable key in memory and no unbounded set of
 * forgotten ids to grow. During a master-key rotation `forget` also drops a row
 * the rotation re-wrapped, so the next read loads the new wrapping.
 * @param db The database the wrapped keys live in.
 * @param keyring The current master key and any older key still in the dual-read window.
 * @returns The per-person seal and open functions.
 */
export function createPersonalCrypto(db: AppDatabase, keyring: MasterKeyring) {
  const keyVersion = keyring.current.version;
  const keys = new Map<string, StoredUserKey>();
  const pending = new Map<string, PendingLoad>();

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

  function cacheIfCurrent(userId: string, token: LoadToken, stored: StoredUserKey) {
    return pending.get(userId)?.token === token ? remember(userId, stored) : stored;
  }

  async function readOrCreateKey(userId: string, token: LoadToken) {
    const rows = await db.select().from(userKeys).where(eq(userKeys.userId, userId)).limit(1);

    const row = rows.at(0);

    if (row === undefined) {
      const created = await createUserKey(keyring.current.bytes, keyVersion);

      const inserted = db
        .insert(userKeys)
        .values({
          userId,
          wrappedDek: storedUserKeyBlob(created),
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

      return cacheIfCurrent(
        userId,
        token,
        storedUserKeyFromBlob(winner.wrappedDek, winner.masterKeyVersion),
      );
    }

    return cacheIfCurrent(
      userId,
      token,
      storedUserKeyFromBlob(row.wrappedDek, row.masterKeyVersion),
    );
  }

  async function storedKeyFor(userId: string) {
    const cached = keys.get(userId);

    if (cached !== undefined) {
      return cached;
    }

    const inFlight = pending.get(userId);

    if (inFlight !== undefined) {
      return inFlight.promise;
    }

    const token: LoadToken = { kind: "personal-key-load" };

    const loading = (async () => {
      try {
        return await readOrCreateKey(userId, token);
      } finally {
        if (pending.get(userId)?.token === token) {
          pending.delete(userId);
        }
      }
    })();

    pending.set(userId, { promise: loading, token });

    return loading;
  }

  return {
    sealFor: async (userId: string, scope: SealScope, plaintext: string) => {
      const stored = await storedKeyFor(userId);

      return sealValue(keyring, stored, scope, plaintext);
    },
    openFor: async (userId: string, scope: SealScope, sealed: string) => {
      const stored = await storedKeyFor(userId);

      return openValue(keyring, stored, scope, sealed);
    },
    forget: (userId: string) => {
      keys.delete(userId);
      pending.delete(userId);
    },
  } satisfies PersonalCrypto;
}

/**
 * Opens one sealed value, turning a tampered or unreadable ciphertext into `null` with a log line instead of a 500.
 * @param input The person, the value's scope and the sealed text.
 * @returns The plaintext, or null when it cannot be opened.
 */
export async function openOrNull(input: {
  personal: PersonalCrypto;
  scope: SealScope;
  sealed: string;
  userId: string;
}) {
  try {
    return await input.personal.openFor(input.userId, input.scope, input.sealed);
  } catch (error) {
    logError("crypto.open", error);

    return null;
  }
}
