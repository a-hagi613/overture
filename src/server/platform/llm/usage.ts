import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import { llmUsage } from "../db/schema.ts";

export const DAY_MS = 86_400_000;

export function dayStartUtc(atMs: number) {
  return Math.floor(atMs / DAY_MS) * DAY_MS;
}

export interface LlmUsageCall {
  userId: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costMicros: number;
}

export function recordLlmUsage(db: AppDatabase, clock: Clock, call: LlmUsageCall) {
  db.insert(llmUsage)
    .values({
      id: crypto.randomUUID(),
      userId: call.userId,
      purpose: call.purpose,
      model: call.model,
      inputTokens: call.inputTokens,
      cachedTokens: call.cachedTokens,
      outputTokens: call.outputTokens,
      costMicros: call.costMicros,
      createdAt: clock.now(),
    })
    .run();
}

function spendMicros(
  db: AppDatabase,
  sinceMs: number,
  purpose: string | null,
  userId: string | null,
) {
  const filters = [gte(llmUsage.createdAt, sinceMs)];

  if (purpose !== null) {
    filters.push(eq(llmUsage.purpose, purpose));
  }

  if (userId !== null) {
    filters.push(eq(llmUsage.userId, userId));
  }

  const row = db
    .select({ total: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)` })
    .from(llmUsage)
    .where(and(...filters))
    .get();

  return row?.total ?? 0;
}

export function llmSpendTodayMicros(
  db: AppDatabase,
  atMs: number,
  purpose: string | null,
  userId: string | null,
) {
  return spendMicros(db, dayStartUtc(atMs), purpose, userId);
}

export interface LlmUsageRow {
  id: string;
  userId: string | null;
  purpose: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costMicros: number;
  createdAt: number;
}

export interface LlmUsageQuery {
  purpose: string | null;
  sinceMs: number | null;
  limit: number;
}

export interface LlmUsageSummary {
  rows: LlmUsageRow[];
  totals: {
    calls: number;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    costMicros: number;
  };
}

function rowFrom(entry: typeof llmUsage.$inferSelect) {
  return {
    id: entry.id,
    userId: entry.userId,
    purpose: entry.purpose,
    model: entry.model,
    inputTokens: entry.inputTokens,
    cachedTokens: entry.cachedTokens,
    outputTokens: entry.outputTokens,
    costMicros: entry.costMicros,
    createdAt: entry.createdAt,
  };
}

export function readLlmUsage(db: AppDatabase, query: LlmUsageQuery) {
  const filters = [];

  if (query.purpose !== null) {
    filters.push(eq(llmUsage.purpose, query.purpose));
  }

  if (query.sinceMs !== null) {
    filters.push(gte(llmUsage.createdAt, query.sinceMs));
  }

  const selection = db.select().from(llmUsage).orderBy(desc(llmUsage.createdAt));

  const rows = (filters.length === 0 ? selection : selection.where(and(...filters)))
    .limit(query.limit)
    .all()
    .map((entry) => rowFrom(entry));

  return {
    rows,
    totals: {
      calls: rows.length,
      inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
      cachedTokens: rows.reduce((total, row) => total + row.cachedTokens, 0),
      outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
      costMicros: rows.reduce((total, row) => total + row.costMicros, 0),
    },
  };
}
