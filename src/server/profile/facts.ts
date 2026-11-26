import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";
import { openOrNull } from "./personal-crypto.ts";

import { facts } from "../platform/db/schema.ts";
import { isCountryCode } from "../catalog/geo.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import {
  FACT_KEYS,
  isCountryScopedFactKey,
  isCurrencyCode,
  isCurrencyScopedFactKey,
} from "../../shared/facts.ts";

const factKeySchema = z.union([z.enum(FACT_KEYS), z.string().regex(/^q:[A-Za-z0-9-]+$/u)]);

export interface FactRecord {
  key: string;
  scope: string;
  value: string;
  source: "resume" | "user" | "review" | "import";
  confirmed: boolean;
  revision: number;
}

/** One value the resume reader grounded against the resume text, ready to store as a Fact. */
export interface ResumeFactDraft {
  key: string;
  scope: string;
  value: string;
}

export interface FactService {
  list: (userId: string) => Promise<FactRecord[]>;
  save: (userId: string, key: string, value: string, scope?: string) => Promise<FactRecord>;
  saveFromReview: (
    userId: string,
    key: string,
    value: string,
    scope?: string,
  ) => Promise<FactRecord>;
  saveFromResume: (userId: string, drafts: readonly ResumeFactDraft[]) => Promise<FactRecord[]>;
  confirm: (userId: string, key: string, value: string, scope?: string) => Promise<FactRecord>;
  remove: (userId: string, key: string, scope?: string | null) => Promise<number>;
}

function assertFactKey(key: string) {
  if (!factKeySchema.safeParse(key).success) {
    throw new Error(`unknown fact key: ${key}`);
  }
}

function assertScope(key: string, scope: string) {
  if (scope === "") {
    return;
  }

  if (isCurrencyScopedFactKey(key)) {
    if (!isCurrencyCode(scope)) {
      throw new Error(`unknown currency scope: ${scope}`);
    }

    return;
  }

  if (!isCountryCode(scope)) {
    throw new Error(`unknown country scope: ${scope}`);
  }

  if (!isCountryScopedFactKey(key)) {
    throw new Error(`fact key ${key} is not scoped by country`);
  }
}

export function createFactService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
}) {
  const { db, clock, personal } = deps;

  const writes = new Map<string, Promise<unknown>>();

  async function inWriteOrder<T>(writeKey: string, run: () => Promise<T>) {
    const prior = writes.get(writeKey) ?? Promise.resolve();

    const queued = (async () => {
      await prior.catch(() => undefined);

      return await run();
    })();

    const settled = Promise.allSettled([queued]);

    writes.set(writeKey, settled);

    try {
      return await queued;
    } finally {
      if (writes.get(writeKey) === settled) {
        writes.delete(writeKey);
      }
    }
  }

  async function write(
    userId: string,
    key: string,
    scope: string,
    value: string,
    source: FactRecord["source"],
    confirmed: boolean,
    keepSourceWhenUnchanged = false,
  ) {
    const rows = await db
      .select()
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.key, key), eq(facts.scope, scope)))
      .limit(1);

    const row = rows.at(0);

    const unchanged =
      row !== undefined &&
      (await openOrNull({
        personal,
        scope: { table: "facts", column: "value_enc", rowId: row.id },
        sealed: row.valueEnc,
        userId,
      })) === value;

    const resolvedSource = keepSourceWhenUnchanged && unchanged ? row.source : source;

    const revision = row === undefined || !unchanged ? (row?.revision ?? 0) + 1 : row.revision;
    const rowId = row?.id ?? crypto.randomUUID();

    const valueEnc = await personal.sealFor(
      userId,
      { table: "facts", column: "value_enc", rowId },
      value,
    );

    const values = {
      userId,
      key,
      scope,
      valueEnc,
      source: resolvedSource,
      confirmed,
      revision,
      updatedAt: new Date(clock.now()),
    };

    if (row === undefined) {
      await db.insert(facts).values({
        id: rowId,
        ...values,
      });
    } else {
      await db.update(facts).set(values).where(eq(facts.id, row.id));
    }

    return {
      changed: row === undefined || !unchanged,
      record: { key, scope, value, source: resolvedSource, confirmed, revision },
    };
  }

  async function upsert(
    userId: string,
    key: string,
    scope: string,
    value: string,
    source: FactRecord["source"],
    confirmed: boolean,
    keepSourceWhenUnchanged = false,
  ) {
    return inWriteOrder(`${userId}\u0000${key}\u0000${scope}`, async () => {
      const written = await write(
        userId,
        key,
        scope,
        value,
        source,
        confirmed,
        keepSourceWhenUnchanged,
      );

      if (written.changed) {
        publishEvent(db, clock, "profile.updated", JSON.stringify({ factKey: key, scope }), userId);
      }

      return written.record;
    });
  }

  return {
    list: async (userId: string) => {
      const rows = await db.select().from(facts).where(eq(facts.userId, userId));

      const records = await Promise.all(
        rows.map(async (row) => {
          const value =
            (await openOrNull({
              personal,
              scope: { table: "facts", column: "value_enc", rowId: row.id },
              sealed: row.valueEnc,
              userId,
            })) ?? "";

          return {
            key: row.key,
            scope: row.scope,
            value,
            source: row.source,
            confirmed: row.confirmed,
            revision: row.revision,
          };
        }),
      );

      return records.toSorted(
        (left, right) => left.key.localeCompare(right.key) || left.scope.localeCompare(right.scope),
      );
    },
    save: async (userId: string, key: string, value: string, scope = "") => {
      assertFactKey(key);
      assertScope(key, scope);

      return upsert(userId, key, scope, value, "user", true);
    },
    saveFromReview: async (userId: string, key: string, value: string, scope = "") => {
      assertFactKey(key);
      assertScope(key, scope);

      return upsert(userId, key, scope, value, "review", true);
    },
    saveFromResume: async (userId: string, drafts: readonly ResumeFactDraft[]) => {
      for (const draft of drafts) {
        assertFactKey(draft.key);
        assertScope(draft.key, draft.scope);
      }

      return Promise.all(
        drafts.map(async (draft) =>
          upsert(userId, draft.key, draft.scope, draft.value, "resume", false),
        ),
      );
    },
    confirm: async (userId: string, key: string, value: string, scope = "") => {
      assertFactKey(key);
      assertScope(key, scope);

      return upsert(userId, key, scope, value, "user", true, true);
    },
    remove: async (userId: string, key: string, scope: string | null = null) => {
      assertFactKey(key);

      const where =
        scope === null
          ? and(eq(facts.userId, userId), eq(facts.key, key))
          : and(eq(facts.userId, userId), eq(facts.key, key), eq(facts.scope, scope));

      const removed = db.select({ id: facts.id }).from(facts).where(where).all();

      await db.delete(facts).where(where);

      if (removed.length > 0) {
        publishEvent(
          db,
          clock,
          "profile.updated",
          JSON.stringify({ factKey: key, removed: removed.length, scope }),
          userId,
        );
      }

      return removed.length;
    },
  };
}
