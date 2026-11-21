import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";

import { facts } from "../platform/db/schema.ts";
import { isCountryCode } from "../catalog/geo.ts";
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

export interface FactService {
  list: (userId: string) => Promise<FactRecord[]>;
  save: (userId: string, key: string, value: string, scope?: string) => Promise<FactRecord>;
  saveFromReview: (
    userId: string,
    key: string,
    value: string,
    scope?: string,
  ) => Promise<FactRecord>;
  remove: (userId: string, key: string, scope?: string | null) => Promise<number>;
  prefillFromResume: (userId: string, text: string) => Promise<FactRecord[]>;
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
  ) {
    const rows = await db
      .select()
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.key, key), eq(facts.scope, scope)))
      .limit(1);

    const row = rows.at(0);
    const revision = (row?.revision ?? 0) + 1;
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
      source,
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

    return { key, scope, value, source, confirmed, revision };
  }

  async function upsert(
    userId: string,
    key: string,
    scope: string,
    value: string,
    source: FactRecord["source"],
    confirmed: boolean,
  ) {
    return inWriteOrder(`${userId}\u0000${key}\u0000${scope}`, async () =>
      write(userId, key, scope, value, source, confirmed),
    );
  }

  return {
    list: async (userId: string) => {
      const rows = await db.select().from(facts).where(eq(facts.userId, userId));

      const records = await Promise.all(
        rows.map(async (row) => {
          const value = await personal.openFor(
            userId,
            { table: "facts", column: "value_enc", rowId: row.id },
            row.valueEnc,
          );

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
    remove: async (userId: string, key: string, scope: string | null = null) => {
      assertFactKey(key);

      const where =
        scope === null
          ? and(eq(facts.userId, userId), eq(facts.key, key))
          : and(eq(facts.userId, userId), eq(facts.key, key), eq(facts.scope, scope));

      const removed = db.select({ id: facts.id }).from(facts).where(where).all();

      await db.delete(facts).where(where);

      return removed.length;
    },
    prefillFromResume: async (userId: string, text: string) => {
      const parsed = parseResumeFacts(text);

      const prefilled = await Promise.all(
        parsed.map(async (fact) => upsert(userId, fact.key, "", fact.value, "resume", false)),
      );

      return prefilled;
    },
  };
}

const LABELLED_PATTERNS: { key: string; pattern: RegExp }[] = [
  { key: "legal_name", pattern: /^name:\s*(?<value>.+)$/imu },
  { key: "email", pattern: /^email:\s*(?<value>\S+@\S+\.\S+)$/imu },
  { key: "phone", pattern: /^phone:\s*(?<value>.+)$/imu },
  { key: "current_city", pattern: /^city:\s*(?<value>.+)$/imu },
  { key: "current_country", pattern: /^country:\s*(?<value>.+)$/imu },
  { key: "notice_period", pattern: /^notice period:\s*(?<value>.+)$/imu },
  { key: "earliest_start", pattern: /^earliest start:\s*(?<value>.+)$/imu },
  { key: "work_auth", pattern: /^work authorisation:\s*(?<value>.+)$/imu },
  { key: "willing_relocate", pattern: /^willing to relocate:\s*(?<value>.+)$/imu },
  { key: "salary_expectation", pattern: /^salary expectation:\s*(?<value>.+)$/imu },
  { key: "degree_highest", pattern: /^degree:\s*(?<value>.+)$/imu },
  { key: "languages", pattern: /^languages:\s*(?<value>.+)$/imu },
  { key: "linkedin_url", pattern: /^linkedin:\s*(?<value>\S+)$/imu },
  { key: "current_employer", pattern: /^current employer:\s*(?<value>.+)$/imu },
];

function parseResumeFacts(text: string) {
  const found: { key: string; value: string }[] = [];

  for (const { key, pattern } of LABELLED_PATTERNS) {
    const match = pattern.exec(text);

    if (match?.groups?.value !== undefined) {
      found.push({ key, value: match.groups.value.trim() });
    }
  }

  return found;
}
