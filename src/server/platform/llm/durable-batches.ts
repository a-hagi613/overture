import { createHash } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";
import type { LlmBatchCall, LlmRequest } from "../ports/llm.ts";

import { bgJobs } from "../db/schema.ts";
import { enqueueJob } from "../jobs/queue.ts";
import { logError, logInfo } from "../log.ts";
import {
  applyLlmBatchResultsOnce,
  createLlmBatchRow,
  failLlmBatch,
  findLlmBatch,
  findLlmBatchByRevision,
  recordLlmBatchError,
  recordLlmBatchPoll,
  recordLlmBatchSubmission,
  reopenLlmBatch,
} from "./batch-store.ts";

import type { LlmBatchRecord } from "./batch-store.ts";

export const LLM_BATCH_POLL_JOB_KIND = "llm.batch_poll";

const DEFAULT_CREATING_STALE_MS = 120_000;
const EXPIRED_GRACE_MS = 3_600_000;
const SETTLED = { kind: "settled" } as const;

const batchCallSchema = z.object({
  customId: z.string(),
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
});

const storedResultsSchema = z.array(batchCallSchema);

const pollPayloadSchema = z.object({ batchRecordId: z.string().min(1) });

export type ProviderBatchStatus = "in_progress" | "canceling" | "ended";

export interface ProviderBatch {
  id: string;
  processingStatus: ProviderBatchStatus;
  resultsUrl: string | null;
  expiresAt: number | null;
}

export class BatchGoneError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "BatchGoneError";
  }
}

export interface BatchProvider {
  create: (requests: readonly LlmRequest[], idempotencyKey: string) => Promise<ProviderBatch>;
  retrieve: (batchId: string) => Promise<ProviderBatch>;
  results: (resultsUrl: string) => Promise<LlmBatchCall[]>;
}

type RecordedPoll =
  | { kind: "pending" }
  | { kind: "retry"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "applied"; calls: LlmBatchCall[] };

export interface DurableBatchOptions {
  db: AppDatabase;
  clock: Clock;
  model: string;
  provider: BatchProvider;
  pollIntervalMs: number;
  maxWaitMs: number;
  creatingStaleMs?: number;
}

async function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describe(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function pollJobKey(recordId: string) {
  return `${LLM_BATCH_POLL_JOB_KIND}:${recordId}`;
}

function storedResults(record: LlmBatchRecord) {
  if (record.results === null) {
    throw new Error(`the batch record ${record.id} is applied without results`);
  }

  return storedResultsSchema.parse(JSON.parse(record.results));
}

export function parseLlmBatchPollPayload(payload: string) {
  return pollPayloadSchema.parse(JSON.parse(payload));
}

export function createDurableBatches(options: DurableBatchOptions) {
  const { db, clock, model, provider } = options;
  const creatingStaleMs = options.creatingStaleMs ?? DEFAULT_CREATING_STALE_MS;

  function inputRevisionHash(requests: readonly LlmRequest[]) {
    return createHash("sha256").update(JSON.stringify({ model, requests })).digest("hex");
  }

  function load(recordId: string) {
    const record = findLlmBatch(db, recordId);

    if (record === undefined) {
      throw new Error(`the batch record ${recordId} is missing`);
    }

    return record;
  }

  function ensureRecord(requests: readonly LlmRequest[]) {
    const hash = inputRevisionHash(requests);
    const existing = findLlmBatchByRevision(db, hash);

    if (existing !== undefined) {
      return { record: existing, owned: false };
    }

    return createLlmBatchRow(db, clock, {
      id: crypto.randomUUID(),
      inputRevisionHash: hash,
      model,
    });
  }

  function fail(recordId: string, message: string) {
    failLlmBatch(db, clock, recordId, message);
    logError("llm.batch", message);

    return message;
  }

  function settle(recordId: string) {
    db.delete(bgJobs)
      .where(
        and(
          eq(bgJobs.kind, LLM_BATCH_POLL_JOB_KIND),
          eq(bgJobs.dedupeKey, pollJobKey(recordId)),
          eq(bgJobs.status, "queued"),
        ),
      )
      .run();
  }

  function ensurePollJob(recordId: string) {
    const existing = db
      .select({ id: bgJobs.id })
      .from(bgJobs)
      .where(
        and(
          eq(bgJobs.kind, LLM_BATCH_POLL_JOB_KIND),
          eq(bgJobs.dedupeKey, pollJobKey(recordId)),
          inArray(bgJobs.status, ["queued", "running"]),
        ),
      )
      .get();

    if (existing !== undefined) {
      return;
    }

    enqueueJob(db, clock, LLM_BATCH_POLL_JOB_KIND, JSON.stringify({ batchRecordId: recordId }), {
      dedupeKey: pollJobKey(recordId),
      runAt: clock.now() + options.pollIntervalMs,
    });
  }

  const pollRecord: (record: LlmBatchRecord) => Promise<RecordedPoll> = async (record) => {
    if (record.batchId === null) {
      return { kind: "pending" };
    }

    try {
      const batch = await provider.retrieve(record.batchId);

      recordLlmBatchPoll(db, clock, record.id, batch.expiresAt);

      if (batch.processingStatus === "canceling") {
        return {
          kind: "failed",
          message: fail(record.id, `batch ${batch.id} is canceling and will not complete`),
        };
      }

      if (batch.processingStatus === "in_progress") {
        return { kind: "pending" };
      }

      if (batch.resultsUrl === null) {
        return {
          kind: "failed",
          message: fail(record.id, `batch ${batch.id} ended without a results url`),
        };
      }

      const calls = await provider.results(batch.resultsUrl);
      const applied = applyLlmBatchResultsOnce(db, clock, record.id, JSON.stringify(calls));

      if (!applied) {
        return { kind: "applied", calls: storedResults(load(record.id)) };
      }

      logInfo(
        "llm.batch",
        `applied ${String(calls.length)} results for batch ${batch.id} (${record.id})`,
      );

      return { kind: "applied", calls };
    } catch (error) {
      if (error instanceof BatchGoneError) {
        return { kind: "failed", message: fail(record.id, error.message) };
      }

      const message = describe(error);

      recordLlmBatchError(db, clock, record.id, message);

      return { kind: "retry", message };
    }
  };

  async function waitForBatchId(recordId: string, until: number) {
    const record = load(recordId);

    if (record.batchId !== null || record.resultAppliedAt !== null || clock.now() >= until) {
      return record;
    }

    await delay(Math.min(options.pollIntervalMs, Math.max(until - clock.now(), 1)));

    return waitForBatchId(recordId, until);
  }

  async function submitOrAdopt(
    record: LlmBatchRecord,
    owned: boolean,
    requests: readonly LlmRequest[],
  ) {
    if (!owned) {
      const waited = await waitForBatchId(record.id, record.updatedAt + creatingStaleMs);

      if (waited.batchId !== null || waited.resultAppliedAt !== null) {
        return waited;
      }
    }

    const batch = await provider.create(requests, record.inputRevisionHash);

    recordLlmBatchSubmission(db, clock, record.id, {
      batchId: batch.id,
      expiresAt: batch.expiresAt,
    });

    logInfo("llm.batch", `${owned ? "submitted" : "resumed"} batch ${batch.id} (${record.id})`);

    return load(record.id);
  }

  const awaitApplied: (recordId: string, deadline: number) => Promise<LlmBatchCall[]> = async (
    recordId,
    deadline,
  ) => {
    const record = load(recordId);

    if (record.resultAppliedAt !== null) {
      settle(recordId);

      return storedResults(record);
    }

    if (record.status === "failed") {
      throw new Error(record.lastError ?? `the batch record ${recordId} failed`);
    }

    if (record.batchId !== null) {
      const polled = await pollRecord(record);

      if (polled.kind === "applied") {
        settle(recordId);

        return polled.calls;
      }

      if (polled.kind === "failed") {
        throw new Error(polled.message);
      }
    }

    if (clock.now() >= deadline) {
      throw new Error(
        `batch ${record.batchId ?? recordId} did not end within ${String(options.maxWaitMs)}ms; it stays recorded so the next run resumes it`,
      );
    }

    await delay(Math.min(options.pollIntervalMs, Math.max(deadline - clock.now(), 1)));

    return awaitApplied(recordId, deadline);
  };

  async function run(requests: readonly LlmRequest[]) {
    const ensured = ensureRecord(requests);
    let { record, owned } = ensured;

    if (record.status === "failed") {
      owned = reopenLlmBatch(db, clock, record.id);
      record = load(record.id);
    }

    if (record.resultAppliedAt !== null) {
      settle(record.id);

      return storedResults(record);
    }

    if (record.batchId === null) {
      record = await submitOrAdopt(record, owned, requests);
    }

    ensurePollJob(record.id);

    return awaitApplied(record.id, clock.now() + options.maxWaitMs);
  }

  async function pollOnce(recordId: string) {
    const record = findLlmBatch(db, recordId);

    if (record === undefined) {
      return SETTLED;
    }

    if (record.batchId === null || record.resultAppliedAt !== null || record.status === "failed") {
      return SETTLED;
    }

    if (record.expiresAt !== null && clock.now() >= record.expiresAt + EXPIRED_GRACE_MS) {
      fail(record.id, `batch ${record.batchId} expired without results`);

      return SETTLED;
    }

    const polled = await pollRecord(record);

    if (polled.kind === "applied" || polled.kind === "failed") {
      return SETTLED;
    }

    return { kind: "wait" as const, delayMs: options.pollIntervalMs };
  }

  return { run, pollOnce };
}

export type DurableBatches = ReturnType<typeof createDurableBatches>;
