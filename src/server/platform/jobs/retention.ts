import { and, asc, eq, gt, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../db/client.ts";
import type { Clock } from "../ports/clock.ts";

import { postings } from "../db/catalog-schema.ts";
import { applications } from "../db/schema.ts";
import { logInfo } from "../log.ts";
import { WRITE_BATCH_ROWS, yieldToEventLoop } from "../db/batches.ts";
import { retryWhenBusy } from "../db/busy.ts";
import { enqueueJob } from "./queue.ts";

const HOUR_MS = 3_600_000;

const DAY_MS = 24 * HOUR_MS;
export const RETENTION_JOB_KIND = "maintenance.retention";
const RETENTION_INTERVAL_MS = HOUR_MS;
const EVENT_RETENTION_MS = DAY_MS;
const DONE_JOB_RETENTION_MS = 7 * DAY_MS;
const DEAD_JOB_RETENTION_MS = 30 * DAY_MS;
const ADMIN_CANCELLED_JOB_ERROR = "Cancelled from the admin jobs page.";

const ATTEMPT_RETENTION_MS = 180 * DAY_MS;
const LLM_BATCH_RETENTION_MS = 30 * DAY_MS;

const CATALOG_DESCRIPTION_RETENTION_MS = 30 * DAY_MS;
const CATALOG_CLOSED_POSTING_RETENTION_MS = 90 * DAY_MS;
const CATALOG_CHUNK_ROWS = WRITE_BATCH_ROWS;
const CATALOG_MAX_CHUNKS = 20;

const TABLE_KEYS = {
  attempts: "id",
  bg_jobs: "id",
  events: "seq",
  llm_batches: "id",
} as const;

type Table = keyof typeof TABLE_KEYS;

/**
 * The per-run bounds of the catalog prune. A smaller chunk keeps every write lock short; the chunk cap keeps one run
 * from monopolising its job slot, and the next hourly run continues where this one stopped.
 */
export interface CatalogRetentionLimits {
  readonly chunkRows?: number;
  readonly maxChunks?: number;
}

/**
 * What one catalog prune run did. `descriptionsCapped` and `postingsCapped` are true when the run stopped at its
 * chunk cap with rows left, so the next run has work; `postingsHeld` counts the closed Postings left alone because an
 * Application still waiting to send points at them.
 */
export interface CatalogPruneSummary {
  readonly descriptionsCapped: boolean;
  readonly descriptionsNulled: number;
  readonly postingsCapped: boolean;
  readonly postingsDeleted: number;
  readonly postingsHeld: number;
}

async function deleteInChunks(db: AppDatabase, table: Table, where: ReturnType<typeof sql>) {
  const key = sql.raw(TABLE_KEYS[table]);
  const name = sql.raw(table);

  const removeChunk: (total: number) => Promise<number> = async (total) => {
    const removed = await retryWhenBusy(
      () =>
        db.all(
          sql`DELETE FROM ${name} WHERE ${key} IN (
            SELECT ${key} FROM ${name} WHERE ${where} LIMIT ${WRITE_BATCH_ROWS}
          ) RETURNING 1 AS removed`,
        ).length,
      `retention.${table}`,
    );

    if (removed < WRITE_BATCH_ROWS) {
      return total + removed;
    }

    await yieldToEventLoop();

    return removeChunk(total + removed);
  };

  return removeChunk(0);
}

function nullDescriptionChunk(
  catalogDb: CatalogDatabase,
  chunkRows: number,
  descriptionBefore: number,
  deletionBefore: number,
) {
  return catalogDb.transaction((tx) => {
    const ids = tx
      .select({ id: postings.id })
      .from(postings)
      .where(
        and(
          isNotNull(postings.closedAt),
          lt(postings.closedAt, descriptionBefore),
          gte(postings.closedAt, deletionBefore),
          isNotNull(postings.descriptionGz),
        ),
      )
      .limit(chunkRows)
      .all()
      .map((row) => row.id);

    if (ids.length === 0) {
      return 0;
    }

    return tx
      .update(postings)
      .set({ descriptionGz: null })
      .where(inArray(postings.id, ids))
      .returning({ id: postings.id })
      .all().length;
  });
}

async function pruneDescriptions(
  catalogDb: CatalogDatabase,
  descriptionBefore: number,
  deletionBefore: number,
  limits: Required<CatalogRetentionLimits>,
) {
  const pruneChunk: (
    chunk: number,
    total: number,
  ) => Promise<{ nulled: number; capped: boolean }> = async (chunk, total) => {
    if (chunk >= limits.maxChunks) {
      return { capped: true, nulled: total };
    }

    const count = await retryWhenBusy(
      () => nullDescriptionChunk(catalogDb, limits.chunkRows, descriptionBefore, deletionBefore),
      "retention.catalog.descriptions",
    );

    if (count < limits.chunkRows) {
      return { capped: false, nulled: total + count };
    }

    await yieldToEventLoop();

    return pruneChunk(chunk + 1, total + count);
  };

  return pruneChunk(0, 0);
}

function unsentPostingIds(db: AppDatabase) {
  const rows = db
    .selectDistinct({ postingId: applications.postingId })
    .from(applications)
    .where(inArray(applications.status, ["ready", "approved"]))
    .all();

  return new Set(rows.map((row) => row.postingId));
}

function deletePostingsChunk(catalogDb: CatalogDatabase, ids: readonly string[]) {
  return catalogDb.transaction(
    (tx) =>
      tx
        .delete(postings)
        .where(inArray(postings.id, [...ids]))
        .returning({ id: postings.id })
        .all().length,
  );
}

async function pruneClosedPostings(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  closedBefore: number,
  limits: Required<CatalogRetentionLimits>,
) {
  const held = new Set<string>();
  const unsent = unsentPostingIds(db);

  const pruneChunk: (
    chunk: number,
    total: number,
    cursor: { closedAt: number; id: string } | null,
  ) => Promise<{ deleted: number; held: number; capped: boolean }> = async (
    chunk,
    total,
    cursor,
  ) => {
    if (chunk >= limits.maxChunks) {
      return { capped: true, deleted: total, held: held.size };
    }

    const candidates = catalogDb
      .select({ closedAt: postings.closedAt, id: postings.id })
      .from(postings)
      .where(
        and(
          isNotNull(postings.closedAt),
          lt(postings.closedAt, closedBefore),
          cursor === null
            ? undefined
            : or(
                gt(postings.closedAt, cursor.closedAt),
                and(eq(postings.closedAt, cursor.closedAt), gt(postings.id, cursor.id)),
              ),
        ),
      )
      .orderBy(asc(postings.closedAt), asc(postings.id))
      .limit(limits.chunkRows)
      .all();

    if (candidates.length === 0) {
      return { capped: false, deleted: total, held: held.size };
    }

    const deletable = candidates.flatMap((row) => (unsent.has(row.id) ? [] : [row.id]));

    for (const row of candidates) {
      if (unsent.has(row.id)) {
        held.add(row.id);
      }
    }

    const removed =
      deletable.length === 0
        ? 0
        : await retryWhenBusy(
            () => deletePostingsChunk(catalogDb, deletable),
            "retention.catalog.postings",
          );

    const last = candidates.at(-1);

    if (last === undefined) {
      return { capped: false, deleted: total + removed, held: held.size };
    }

    if (last.closedAt === null) {
      return { capped: false, deleted: total + removed, held: held.size };
    }

    if (candidates.length < limits.chunkRows) {
      return { capped: false, deleted: total + removed, held: held.size };
    }

    await yieldToEventLoop();

    return pruneChunk(chunk + 1, total + removed, { closedAt: last.closedAt, id: last.id });
  };

  return pruneChunk(0, 0, null);
}

/**
 * Bounds `catalog.sqlite` growth without touching user history (ADR 0036): a Posting closed more than 30 days loses
 * its compressed description, and one closed more than 90 days is deleted together with the tag, question and
 * `postings_fts` rows its foreign keys and trigger clean up. Both phases run in bounded chunks so no single write
 * lock is held long; the description phase leaves a Posting already in the deletion window to the delete phase, and a
 * Posting an Application still waiting to send (`ready` or `approved`) points at is left for the next sweep to
 * reconcile.
 * @param db The application database, read only for the held-Posting check.
 * @param catalogDb The catalog database.
 * @param clock The clock that fixes both cutoffs.
 * @param limits Optional smaller bounds for one run.
 * @returns What the run nulled, deleted and held.
 */
export async function pruneCatalog(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
  limits: CatalogRetentionLimits = {},
) {
  const startedAt = performance.now();
  const now = clock.now();
  const closeBefore = now - CATALOG_CLOSED_POSTING_RETENTION_MS;

  const bounds = {
    chunkRows: limits.chunkRows ?? CATALOG_CHUNK_ROWS,
    maxChunks: limits.maxChunks ?? CATALOG_MAX_CHUNKS,
  };

  const descriptions = await pruneDescriptions(
    catalogDb,
    now - CATALOG_DESCRIPTION_RETENTION_MS,
    closeBefore,
    bounds,
  );

  const pruned = await pruneClosedPostings(db, catalogDb, closeBefore, bounds);

  const summary: CatalogPruneSummary = {
    descriptionsCapped: descriptions.capped,
    descriptionsNulled: descriptions.nulled,
    postingsCapped: pruned.capped,
    postingsDeleted: pruned.deleted,
    postingsHeld: pruned.held,
  };

  logInfo(
    "retention.catalog",
    `descriptions_nulled=${String(summary.descriptionsNulled)} descriptions_capped=${String(summary.descriptionsCapped)} postings_deleted=${String(summary.postingsDeleted)} postings_capped=${String(summary.postingsCapped)} postings_held=${String(summary.postingsHeld)} duration_ms=${String(Math.round(performance.now() - startedAt))}`,
  );

  return summary;
}

export async function runRetention(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
  limits: CatalogRetentionLimits = {},
) {
  const now = clock.now();

  const events = await deleteInChunks(db, "events", sql`created_at < ${now - EVENT_RETENTION_MS}`);

  const attempts = await deleteInChunks(
    db,
    "attempts",
    sql`started_at < ${now - ATTEMPT_RETENTION_MS}`,
  );

  const doneJobs = await deleteInChunks(
    db,
    "bg_jobs",
    sql`status = 'done' AND updated_at < ${now - DONE_JOB_RETENTION_MS}`,
  );

  const cancelledJobs = await deleteInChunks(
    db,
    "bg_jobs",
    sql`status = 'failed' AND last_error = ${ADMIN_CANCELLED_JOB_ERROR} AND updated_at < ${now - DONE_JOB_RETENTION_MS}`,
  );

  const deadJobs = await deleteInChunks(
    db,
    "bg_jobs",
    sql`status = 'dead' AND updated_at < ${now - DEAD_JOB_RETENTION_MS}`,
  );

  const llmBatches = await deleteInChunks(
    db,
    "llm_batches",
    sql`status IN ('applied', 'failed') AND updated_at < ${now - LLM_BATCH_RETENTION_MS}`,
  );

  const catalog = await pruneCatalog(db, catalogDb, clock, limits);

  return { attempts, cancelledJobs, deadJobs, doneJobs, events, llmBatches, ...catalog };
}

export function ensureRetentionQueued(db: AppDatabase, clock: Clock) {
  return enqueueJob(db, clock, RETENTION_JOB_KIND, "{}", {
    dedupeKey: RETENTION_JOB_KIND,
    maxAttempts: 1,
    runAt: clock.now() + RETENTION_INTERVAL_MS,
  }).inserted;
}

export async function retentionJobHandler(
  db: AppDatabase,
  catalogDb: CatalogDatabase,
  clock: Clock,
) {
  try {
    await runRetention(db, catalogDb, clock);
  } finally {
    ensureRetentionQueued(db, clock);
  }
}
