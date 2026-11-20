import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "./personal-crypto.ts";

import { facts } from "../platform/db/schema.ts";
import { TIER_1_FACT_KEYS } from "../../shared/facts.ts";

const factKeySchema = z.enum(TIER_1_FACT_KEYS);

export interface FactRecord {
  key: string;
  value: string;
  source: "resume" | "user" | "review" | "import";
  confirmed: boolean;
  revision: number;
}

export interface FactService {
  list: (userId: string) => Promise<FactRecord[]>;
  save: (userId: string, key: string, value: string) => Promise<FactRecord>;
  prefillFromResume: (userId: string, text: string) => Promise<FactRecord[]>;
}

export function createFactService(deps: {
  db: AppDatabase;
  clock: Clock;
  personal: PersonalCrypto;
}) {
  const { db, clock, personal } = deps;

  async function upsert(
    userId: string,
    key: string,
    value: string,
    source: FactRecord["source"],
    confirmed: boolean,
  ) {
    const rows = await db
      .select()
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.key, key)))
      .limit(1);

    const row = rows.at(0);
    const revision = (row?.revision ?? 0) + 1;

    const valueEnc = await personal.sealFor(
      userId,
      { table: "facts", column: "value_enc", rowId: row?.id ?? key },
      value,
    );

    const values = {
      userId,
      key,
      valueEnc,
      source,
      confirmed,
      revision,
      updatedAt: new Date(clock.now()),
    };

    if (row === undefined) {
      await db.insert(facts).values({
        id: crypto.randomUUID(),
        ...values,
      });
    } else {
      await db.update(facts).set(values).where(eq(facts.id, row.id));
    }

    return { key, value, source, confirmed, revision };
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
            value,
            source: row.source,
            confirmed: row.confirmed,
            revision: row.revision,
          };
        }),
      );

      return records.toSorted((left, right) => left.key.localeCompare(right.key));
    },
    save: async (userId: string, key: string, value: string) => {
      const parsedKey = factKeySchema.safeParse(key);

      if (!parsedKey.success) {
        throw new Error(`unknown fact key: ${key}`);
      }

      return upsert(userId, key, value, "user", true);
    },
    prefillFromResume: async (userId: string, text: string) => {
      const parsed = parseResumeFacts(text);

      const prefilled = await Promise.all(
        parsed.map(async (fact) => upsert(userId, fact.key, fact.value, "resume", false)),
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
