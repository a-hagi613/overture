import { and, gte, inArray, isNotNull, sql } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { COVER_LETTER_PURPOSE, OPEN_TEXT_PURPOSE } from "../pipeline/open-text.ts";
import { QUESTION_MAPPING_PURPOSE } from "../catalog/question-mapping.ts";
import { SCORE_PURPOSE } from "../matching/score.ts";
import { llmUsage } from "../platform/db/schema.ts";

/**
 * The model-call purposes whose spend sits inside cost per completed
 * Application (ADR 0026). Tagging, inbox classification, the resume PDF and
 * live checks are reported beside the number, not inside it.
 */
export const APPLICATION_LLM_PURPOSES = [
  SCORE_PURPOSE,
  OPEN_TEXT_PURPOSE,
  COVER_LETTER_PURPOSE,
  QUESTION_MAPPING_PURPOSE,
] as const;

/**
 * Anthropic spend for Application purposes, summed per user. `llm_usage` has
 * no application id, so the spend is attributed to the user who made the
 * call; the caller decides which users' spend belongs to its population.
 * @param db The database to read.
 * @param sinceMs The earliest call time in epoch milliseconds, or null for all time.
 * @returns Cost in micros keyed by user id.
 */
export function applicationLlmMicrosByUser(db: AppDatabase, sinceMs: number | null) {
  const filters = [
    inArray(llmUsage.purpose, [...APPLICATION_LLM_PURPOSES]),
    isNotNull(llmUsage.userId),
  ];

  if (sinceMs !== null) {
    filters.push(gte(llmUsage.createdAt, sinceMs));
  }

  const rows = db
    .select({
      userId: llmUsage.userId,
      total: sql<number>`coalesce(sum(${llmUsage.costMicros}), 0)`,
    })
    .from(llmUsage)
    .where(and(...filters))
    .groupBy(llmUsage.userId)
    .all();

  return new Map(
    rows.flatMap((row) => (row.userId === null ? [] : [[row.userId, row.total] as const])),
  );
}
