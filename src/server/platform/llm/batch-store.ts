import { and, eq, isNull } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { llmBatches } from "../db/schema.ts";

export type LlmBatchRecord = typeof llmBatches.$inferSelect;

export function findLlmBatchByRevision(db: AppDatabase, inputRevisionHash: string) {
  return db
    .select()
    .from(llmBatches)
    .where(eq(llmBatches.inputRevisionHash, inputRevisionHash))
    .get();
}

export function findLlmBatch(db: AppDatabase, id: string) {
  return db.select().from(llmBatches).where(eq(llmBatches.id, id)).get();
}

export function createLlmBatchRow(
  db: AppDatabase,
  clock: Clock,
  input: { id: string; inputRevisionHash: string; model: string },
) {
  const now = clock.now();

  const [created] = db
    .insert(llmBatches)
    .values({
      id: input.id,
      inputRevisionHash: input.inputRevisionHash,
      model: input.model,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .all();

  if (created !== undefined) {
    return { record: created, owned: true };
  }

  const row = findLlmBatchByRevision(db, input.inputRevisionHash);

  if (row === undefined) {
    throw new Error("the batch record could not be created");
  }

  return { record: row, owned: false };
}

export function recordLlmBatchSubmission(
  db: AppDatabase,
  clock: Clock,
  id: string,
  input: { batchId: string; expiresAt: number | null },
) {
  db.update(llmBatches)
    .set({
      batchId: input.batchId,
      expiresAt: input.expiresAt,
      status: "in_progress",
      lastError: null,
      updatedAt: clock.now(),
    })
    .where(eq(llmBatches.id, id))
    .run();
}

export function recordLlmBatchPoll(
  db: AppDatabase,
  clock: Clock,
  id: string,
  expiresAt: number | null,
) {
  const now = clock.now();

  db.update(llmBatches)
    .set({ lastPolledAt: now, updatedAt: now, ...(expiresAt !== null && { expiresAt }) })
    .where(eq(llmBatches.id, id))
    .run();
}

export function recordLlmBatchError(db: AppDatabase, clock: Clock, id: string, error: string) {
  db.update(llmBatches)
    .set({ lastError: error, updatedAt: clock.now() })
    .where(eq(llmBatches.id, id))
    .run();
}

export function applyLlmBatchResultsOnce(
  db: AppDatabase,
  clock: Clock,
  id: string,
  resultsJson: string,
) {
  const now = clock.now();

  const applied = db
    .update(llmBatches)
    .set({
      results: resultsJson,
      status: "applied",
      resultAppliedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(and(eq(llmBatches.id, id), isNull(llmBatches.resultAppliedAt)))
    .returning({ id: llmBatches.id })
    .all();

  return applied.length > 0;
}

export function failLlmBatch(db: AppDatabase, clock: Clock, id: string, error: string) {
  db.update(llmBatches)
    .set({ status: "failed", lastError: error, updatedAt: clock.now() })
    .where(eq(llmBatches.id, id))
    .run();
}

export function reopenLlmBatch(db: AppDatabase, clock: Clock, id: string) {
  const reopened = db
    .update(llmBatches)
    .set({
      status: "creating",
      batchId: null,
      results: null,
      resultAppliedAt: null,
      expiresAt: null,
      lastError: null,
      updatedAt: clock.now(),
    })
    .where(and(eq(llmBatches.id, id), eq(llmBatches.status, "failed")))
    .returning({ id: llmBatches.id })
    .all();

  return reopened.length > 0;
}
