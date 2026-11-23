import { and, asc, count, eq, lt } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MasterKeyring } from "../platform/crypto.ts";

import { recordAdminAudit } from "../platform/audit/index.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { userKeys } from "../platform/db/schema.ts";
import { rewrapUserKey, storedUserKeyBlob, storedUserKeyFromBlob } from "../platform/crypto.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { logInfo } from "../platform/log.ts";

export const MASTER_KEY_ROTATION_JOB_KIND = "maintenance.master-key-rotation";

/** Rows re-wrapped per immediate transaction: short write locks, and a crash loses at most one batch. */
export const MASTER_KEY_ROTATION_BATCH_ROWS = 250;

/** Batches one background run takes before it queues the next, so a large rotation never owns the worker. */
export const MASTER_KEY_ROTATION_JOB_BATCHES = 25;

const SYSTEM_ACTOR = "system:master-key-rotation";

export const masterKeyRotationPayloadSchema = z.object({
  dryRun: z.boolean().default(false),
});

export type MasterKeyRotationPayload = z.infer<typeof masterKeyRotationPayloadSchema>;

export interface MasterKeyRotationOptions {
  /** Who `admin_audit` credits; the background job uses its system actor. */
  actorId?: string;
  batchRows?: number;
  db: AppDatabase;
  clock: Clock;
  dryRun?: boolean;
  keyring: MasterKeyring;
  /** Stop after this many batches; the job passes a bound and queues the next run. */
  maxBatches?: number;
  /** Called with each re-wrapped person, so a process's key cache drops the old wrapping. */
  onRotated?: (userId: string) => void;
}

export interface MasterKeyRotationSummary {
  batches: number;
  dryRun: boolean;
  /** Rows still wrapped under a version below the current one when the run stopped. */
  remaining: number;
  rotated: number;
  toVersion: number;
}

/**
 * Counts the rows a rotation would re-wrap, or re-wraps them in bounded batches. Every batch
 * selects the next rows still below the current version, re-wraps their data keys outside the
 * write lock and commits all of them in one `{ behavior: "immediate" }` transaction that only
 * updates a row while it still carries the version it was read at. A crash, or a run that stops
 * at its batch bound, therefore resumes at the same place and never re-wraps a row twice.
 * @param options The database, clock, keyring, batch and dry-run settings.
 * @returns What the run did and what is left.
 */
export async function runMasterKeyRotation(options: MasterKeyRotationOptions) {
  const { db, clock, keyring } = options;
  const batchRows = options.batchRows ?? MASTER_KEY_ROTATION_BATCH_ROWS;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  const toVersion = keyring.current.version;
  const newer = keyring.keys.find((key) => key.version > toVersion);

  if (newer !== undefined) {
    throw new Error(
      `MASTER_KEY_V${String(newer.version)} is configured but MASTER_KEY_CURRENT is ${String(toVersion)}: raise MASTER_KEY_CURRENT before rotating, or the run has no target version and re-wraps nothing.`,
    );
  }

  const remainingNow = () =>
    db
      .select({ total: count() })
      .from(userKeys)
      .where(lt(userKeys.masterKeyVersion, toVersion))
      .get()?.total ?? 0;

  const before = remainingNow();

  if (options.dryRun === true) {
    logInfo(
      "master_key.rotation",
      `dry run: ${String(before)} row(s) would be re-wrapped under MASTER_KEY_V${String(toVersion)}`,
    );

    const counted: MasterKeyRotationSummary = {
      batches: 0,
      dryRun: true,
      remaining: before,
      rotated: 0,
      toVersion,
    };

    return counted;
  }

  let batches = 0;
  let rotated = 0;

  const rotateBatch = async (batch: number) => {
    if (batch > maxBatches) {
      return;
    }

    const stale = db
      .select()
      .from(userKeys)
      .where(lt(userKeys.masterKeyVersion, toVersion))
      .orderBy(asc(userKeys.userId))
      .limit(batchRows)
      .all();

    if (stale.length === 0) {
      return;
    }

    const rewrapped = await Promise.all(
      stale.map(async (row) => ({
        fromVersion: row.masterKeyVersion,
        userId: row.userId,
        wrappedDek: storedUserKeyBlob(
          await rewrapUserKey(
            keyring,
            storedUserKeyFromBlob(row.wrappedDek, row.masterKeyVersion),
            toVersion,
          ),
        ),
      })),
    );

    const changed = await retryWhenBusy(
      () =>
        db.transaction(
          (tx) => {
            const updated: string[] = [];

            for (const row of rewrapped) {
              const rows = tx
                .update(userKeys)
                .set({ masterKeyVersion: toVersion, wrappedDek: row.wrappedDek })
                .where(
                  and(
                    eq(userKeys.userId, row.userId),
                    eq(userKeys.masterKeyVersion, row.fromVersion),
                  ),
                )
                .returning({ userId: userKeys.userId })
                .all();

              updated.push(...rows.map((changedRow) => changedRow.userId));
            }

            return updated;
          },
          { behavior: "immediate" },
        ),
      "master_key.rotation.batch",
    );

    batches = batch;
    rotated += changed.length;

    for (const userId of changed) {
      options.onRotated?.(userId);
    }

    await recordAdminAudit(db, clock, {
      action: "master_key.rotate",
      actorId: options.actorId ?? SYSTEM_ACTOR,
      detail: {
        batch,
        batchRows,
        remaining: remainingNow(),
        rotated: changed.length,
        toVersion,
      },
      reason: `Re-wrapped one batch of user data keys under MASTER_KEY_V${String(toVersion)}.`,
    });

    if (changed.length > 0 && stale.length === batchRows) {
      await rotateBatch(batch + 1);
    }
  };

  await rotateBatch(1);

  const remaining = remainingNow();

  await recordAdminAudit(db, clock, {
    action: "master_key.rotate.summary",
    actorId: options.actorId ?? SYSTEM_ACTOR,
    detail: { batches, remaining, rotated, toVersion },
    reason: `A master-key rotation run re-wrapped ${String(rotated)} row(s) under MASTER_KEY_V${String(toVersion)}.`,
  });

  logInfo(
    "master_key.rotation",
    `re-wrapped ${String(rotated)} row(s) under MASTER_KEY_V${String(toVersion)} in ${String(batches)} batch(es); ${String(remaining)} left`,
  );

  const summary: MasterKeyRotationSummary = {
    batches,
    dryRun: false,
    remaining,
    rotated,
    toVersion,
  };

  return summary;
}

/**
 * Queues one rotation run. The dedupe key keeps a second operator from queueing a duplicate
 * while one is waiting; a running job queues its own next run when it stops at its batch bound.
 * @param db The application database.
 * @param clock The queue clock.
 * @param input Whether the queued run only counts.
 * @returns The new job id, or the queued job it matched.
 */
export function enqueueMasterKeyRotation(
  db: AppDatabase,
  clock: Clock,
  input: Partial<MasterKeyRotationPayload> = {},
) {
  const dryRun = input.dryRun ?? false;

  return enqueueJob(db, clock, MASTER_KEY_ROTATION_JOB_KIND, JSON.stringify({ dryRun }), {
    dedupeKey: `${MASTER_KEY_ROTATION_JOB_KIND}:${dryRun ? "dry-run" : "live"}`,
    maxAttempts: 3,
  });
}

/**
 * The reason `user_keys` holds a version this process has no key for, if it does. The boot check
 * uses it so removing an old secret too early stops the server with the row count instead of
 * serving `null` for every encrypted value.
 * @param db The application database.
 * @param keyring The configured keys.
 * @returns A clear operator message, or undefined when every stored row is readable.
 */
export function masterKeyCoverageProblem(db: Pick<AppDatabase, "select">, keyring: MasterKeyring) {
  const configured = new Set(keyring.keys.map((key) => key.version));

  const missing = db
    .select({ total: count(), version: userKeys.masterKeyVersion })
    .from(userKeys)
    .groupBy(userKeys.masterKeyVersion)
    .orderBy(asc(userKeys.masterKeyVersion))
    .all()
    .filter((row) => !configured.has(row.version));

  const held = missing
    .map((row) => `${String(row.total)} row(s) under MASTER_KEY_V${String(row.version)}`)
    .join(", ");

  return missing.length === 0
    ? undefined
    : `user_keys holds ${held}, which ${missing.length === 1 ? "is" : "are"} not configured: run the master-key rotation before removing an older key.`;
}

/**
 * Refuses to start a process whose stored data keys it could never open.
 * @param db The application database.
 * @param keyring The configured keys.
 */
export function assertMasterKeyCoverage(db: Pick<AppDatabase, "select">, keyring: MasterKeyring) {
  const problem = masterKeyCoverageProblem(db, keyring);

  if (problem !== undefined) {
    throw new Error(problem);
  }
}
