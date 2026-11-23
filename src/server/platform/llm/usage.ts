import { and, desc, eq, gte, sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import { llmUsage } from "../db/schema.ts";
import { getSetting } from "../settings/index.ts";

export const DAY_MS = 86_400_000;

export function dayStartUtc(atMs: number) {
  return Math.floor(atMs / DAY_MS) * DAY_MS;
}

export function monthStartUtc(atMs: number) {
  const date = new Date(atMs);

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
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

function parseMicrosSetting(db: AppDatabase, key: string) {
  const raw = getSetting(db, key);

  if (raw === null) {
    return null;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function parseUsdSettingMicros(db: AppDatabase, key: string) {
  const raw = getSetting(db, key);
  const parsed = raw === null ? Number.NaN : Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : 0;
}

function readTotalsWindow(db: AppDatabase, sinceMs: number | null) {
  const selection = db
    .select({
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${llmUsage.cachedTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)`,
      costMicros: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    })
    .from(llmUsage);

  const row = (
    sinceMs === null ? selection : selection.where(gte(llmUsage.createdAt, sinceMs))
  ).get();

  return {
    calls: row?.calls ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    cachedTokens: row?.cachedTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    costMicros: row?.costMicros ?? 0,
  };
}

function isExpectedModel(model: string, expectedModel: string) {
  return model === expectedModel || model.startsWith(`${expectedModel}-`);
}

export interface AdminLlmUsageQuery {
  expectedModel: string;
  limit: number;
  purpose: string | null;
}

export function readAdminLlmUsage(db: AppDatabase, clock: Clock, query: AdminLlmUsageQuery) {
  const now = clock.now();
  const base = readLlmUsage(db, { purpose: query.purpose, sinceMs: null, limit: query.limit });

  const byPurpose = db
    .select({
      purpose: llmUsage.purpose,
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${llmUsage.cachedTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)`,
      costMicros: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    })
    .from(llmUsage)
    .groupBy(llmUsage.purpose)
    .orderBy(desc(sql`coalesce(sum(${llmUsage.costMicros}), 0)`), desc(sql`count(*)`))
    .all();

  const modelSelection = db
    .select({
      model: llmUsage.model,
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${llmUsage.cachedTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)`,
      costMicros: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    })
    .from(llmUsage);

  const modelRows = (
    query.purpose === null
      ? modelSelection
      : modelSelection.where(eq(llmUsage.purpose, query.purpose))
  )
    .groupBy(llmUsage.model)
    .orderBy(desc(sql`coalesce(sum(${llmUsage.costMicros}), 0)`), desc(sql`count(*)`))
    .all();

  const dailySpendCapMicros =
    parseMicrosSetting(db, "llm.daily_spend_cap_micros") ??
    parseUsdSettingMicros(db, "llm.cap_global_day_usd");

  const monthlySpendCapMicros = parseMicrosSetting(db, "llm.monthly_spend_cap_micros");

  return {
    ...base,
    now,
    expectedModel: query.expectedModel,
    today: readTotalsWindow(db, dayStartUtc(now)),
    month: readTotalsWindow(db, monthStartUtc(now)),
    allTime: readTotalsWindow(db, null),
    byPurpose,
    byModel: modelRows.map((row) => ({
      cachedTokens: row.cachedTokens,
      calls: row.calls,
      costMicros: row.costMicros,
      inputTokens: row.inputTokens,
      model: row.model,
      outputTokens: row.outputTokens,
      unexpected: !isExpectedModel(row.model, query.expectedModel),
    })),
    caps: {
      dailySpendCapMicros,
      monthlySpendCapMicros,
      userDailyCapMicros: parseUsdSettingMicros(db, "llm.cap_user_day_usd"),
      taggingDailyCapMicros: parseUsdSettingMicros(db, "llm.cap_tagging_day_usd"),
    },
  };
}
