import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { recordAdminAudit } from "../platform/audit/index.ts";
import { bgJobs } from "../platform/db/schema.ts";
import { notifyQueueWake } from "../platform/jobs/queue.ts";

export const JOB_STATUS_FILTERS = [
  "all",
  "queued",
  "running",
  "failed",
  "dead",
  "completed",
] as const;

export type JobStatusFilter = (typeof JOB_STATUS_FILTERS)[number];

export type JobStatus = (typeof bgJobs.$inferSelect)["status"];

export interface AdminJobsQuery {
  status: JobStatusFilter;
  kind?: string | undefined;
  limit: number;
}

export interface AdminJobRow {
  id: string;
  kind: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lockedUntil: number | null;
  lastError: string | null;
  dedupeKey: string | null;
  createdAt: number;
  updatedAt: number;
  payloadPreview: string;
}

export interface AdminJobCounts {
  queued: number;
  running: number;
  done: number;
  failed: number;
  dead: number;
  total: number;
}

export interface JobKindStatusCount {
  kind: string;
  status: JobStatus;
  total: number;
}

export interface AdminJobsView {
  now: number;
  limit: number;
  total: number;
  counts: AdminJobCounts;
  countsByKindStatus: JobKindStatusCount[];
  kinds: string[];
  jobs: AdminJobRow[];
}

export type JobConflictReason = "not_retryable" | "not_cancellable" | "duplicate_queued";

export type JobActionOutcome =
  | { outcome: "retried"; job: AdminJobRow }
  | { outcome: "cancelled"; job: AdminJobRow }
  | { outcome: "not_found" }
  | { outcome: "conflict"; reason: JobConflictReason; status: JobStatus };

const PREVIEW_LENGTH = 160;

const SENSITIVE_FIELD =
  /(?:pass(?:word|code)?|secret|token|cookie|credential|authorization|api[_-]?key|private[_-]?key|email|phone|address|resume|answer|content|body|message|url)$/iu;

const payloadFieldSchema = z.union([
  z.string().transform((value) => `text(${String(value.length)})`),
  z.number().transform(String),
  z.boolean().transform(String),
  z.null().transform(() => "null"),
  z.array(z.unknown()).transform((value) => `list(${String(value.length)})`),
  z
    .record(z.string(), z.unknown())
    .transform((value) => `object(${String(Object.keys(value).length)})`),
]);

const payloadObjectSchema = z.record(z.string(), payloadFieldSchema);

function parsePayload(payload: string) {
  try {
    const parsed: unknown = JSON.parse(payload);

    return parsed;
  } catch {
    return null;
  }
}

/**
 * A payload summary safe to show an owner: field names and value shapes only, never the
 * values that can hold an address, a token or an answer.
 * @param payload The stored job payload.
 * @returns A short, redacted summary of the payload.
 */
export function jobPayloadPreview(payload: string) {
  const parsed = payloadObjectSchema.safeParse(parsePayload(payload));

  if (!parsed.success) {
    return `text(${String(payload.length)})`;
  }

  const fields = Object.entries(parsed.data)
    .slice(0, 8)
    .map(([field, preview]) => `${field}: ${SENSITIVE_FIELD.test(field) ? "hidden" : preview}`);

  const summary = `{ ${fields.join(", ")} }`;

  return summary.length > PREVIEW_LENGTH ? `${summary.slice(0, PREVIEW_LENGTH - 1)}…` : summary;
}

function jobRow(row: typeof bgJobs.$inferSelect) {
  return {
    attempts: row.attempts,
    createdAt: row.createdAt,
    dedupeKey: row.dedupeKey,
    id: row.id,
    kind: row.kind,
    lastError: row.lastError,
    lockedUntil: row.lockedUntil,
    maxAttempts: row.maxAttempts,
    payloadPreview: jobPayloadPreview(row.payload),
    priority: row.priority,
    runAt: row.runAt,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

function statusesFor(filter: JobStatusFilter) {
  if (filter === "all") {
    return [] satisfies JobStatus[];
  }

  return (filter === "completed" ? ["done"] : [filter]) satisfies JobStatus[];
}

export function listAdminJobs(db: AppDatabase, clock: Clock, query: AdminJobsQuery) {
  const counts: AdminJobCounts = {
    dead: 0,
    done: 0,
    failed: 0,
    queued: 0,
    running: 0,
    total: 0,
  };

  for (const row of db
    .select({ status: bgJobs.status, total: count() })
    .from(bgJobs)
    .groupBy(bgJobs.status)
    .all()) {
    counts[row.status] = row.total;
    counts.total += row.total;
  }

  const countsByKindStatus = db
    .select({ kind: bgJobs.kind, status: bgJobs.status, total: count() })
    .from(bgJobs)
    .groupBy(bgJobs.kind, bgJobs.status)
    .orderBy(asc(bgJobs.kind), asc(bgJobs.status))
    .all();

  const statuses: JobStatus[] = statusesFor(query.status);
  const { kind } = query;

  const filter = and(
    statuses.length === 0 ? undefined : inArray(bgJobs.status, statuses),
    kind === undefined ? undefined : eq(bgJobs.kind, kind),
  );

  const total = db.select({ total: count() }).from(bgJobs).where(filter).get()?.total ?? 0;

  const jobs = db
    .select()
    .from(bgJobs)
    .where(filter)
    .orderBy(desc(bgJobs.updatedAt), desc(bgJobs.id))
    .limit(query.limit)
    .all()
    .map((row) => jobRow(row));

  return {
    counts,
    countsByKindStatus,
    jobs,
    kinds: [...new Set(countsByKindStatus.map((row) => row.kind))].toSorted((left, right) =>
      left.localeCompare(right),
    ),
    limit: query.limit,
    now: clock.now(),
    total,
  } satisfies AdminJobsView;
}

function readJob(db: AppDatabase, id: string) {
  const row = db.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

  return row === undefined ? undefined : jobRow(row);
}

function missingJob() {
  return { outcome: "not_found" } satisfies JobActionOutcome;
}

/**
 * Puts a dead or failed job back at the front of the queue in one transaction, then
 * records the owner's action and wakes the job worker.
 * @param db The application database.
 * @param clock The clock the new run time comes from.
 * @param id The job to retry.
 * @param actorId The owner who asked for the retry.
 * @returns Whether the job was retried, missing or refused.
 */
export async function retryAdminJob(db: AppDatabase, clock: Clock, id: string, actorId: string) {
  const result = db.transaction((tx) => {
    const row = tx.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

    if (row === undefined) {
      return { kind: "missing" } as const;
    }

    if (row.status !== "dead" && row.status !== "failed") {
      return { kind: "conflict", reason: "not_retryable", status: row.status } as const;
    }

    if (row.dedupeKey !== null) {
      const duplicate = tx
        .select({ id: bgJobs.id })
        .from(bgJobs)
        .where(and(eq(bgJobs.dedupeKey, row.dedupeKey), eq(bgJobs.status, "queued")))
        .get();

      if (duplicate !== undefined) {
        return { kind: "conflict", reason: "duplicate_queued", status: row.status } as const;
      }
    }

    const now = clock.now();

    tx.update(bgJobs)
      .set({
        attempts: 0,
        lastError: null,
        lockedUntil: null,
        runAt: now,
        status: "queued",
        updatedAt: now,
      })
      .where(eq(bgJobs.id, id))
      .run();

    return { kind: "retried", previousStatus: row.status } as const;
  });

  if (result.kind === "missing") {
    return missingJob();
  }

  if (result.kind === "conflict") {
    return {
      outcome: "conflict",
      reason: result.reason,
      status: result.status,
    } satisfies JobActionOutcome;
  }

  const job = readJob(db, id);

  if (job === undefined) {
    return missingJob();
  }

  await recordAdminAudit(db, clock, {
    action: "job.retry",
    actorId,
    detail: {
      jobId: id,
      kind: job.kind,
      previousStatus: result.previousStatus,
    },
    reason: `Retried the ${job.kind} job from the admin jobs page`,
  });

  notifyQueueWake();

  return { outcome: "retried", job } satisfies JobActionOutcome;
}

/**
 * Takes a queued or dead job out of the queue in one transaction, then records the
 * owner's action. A running or finished job is refused.
 * @param db The application database.
 * @param clock The clock the update time comes from.
 * @param id The job to cancel.
 * @param actorId The owner who asked for the cancel.
 * @returns Whether the job was cancelled, missing or refused.
 */
export async function cancelAdminJob(db: AppDatabase, clock: Clock, id: string, actorId: string) {
  const result = db.transaction((tx) => {
    const row = tx.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

    if (row === undefined) {
      return { kind: "missing" } as const;
    }

    if (row.status !== "queued" && row.status !== "dead") {
      return { kind: "conflict", reason: "not_cancellable", status: row.status } as const;
    }

    tx.update(bgJobs)
      .set({
        lastError: "Cancelled from the admin jobs page.",
        lockedUntil: null,
        status: "failed",
        updatedAt: clock.now(),
      })
      .where(eq(bgJobs.id, id))
      .run();

    return { kind: "cancelled", previousStatus: row.status } as const;
  });

  if (result.kind === "missing") {
    return missingJob();
  }

  if (result.kind === "conflict") {
    return {
      outcome: "conflict",
      reason: result.reason,
      status: result.status,
    } satisfies JobActionOutcome;
  }

  const job = readJob(db, id);

  if (job === undefined) {
    return missingJob();
  }

  await recordAdminAudit(db, clock, {
    action: "job.cancel",
    actorId,
    detail: {
      jobId: id,
      kind: job.kind,
      previousStatus: result.previousStatus,
    },
    reason: `Cancelled the ${job.kind} job from the admin jobs page`,
  });

  return { outcome: "cancelled", job } satisfies JobActionOutcome;
}
