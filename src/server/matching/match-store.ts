import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";

import { jobs, matches } from "../platform/db/schema.ts";
import { parseScoreReply, scoreOf } from "./score-schema.ts";
import type { ScoreBlocker, ScoreReply } from "./score-schema.ts";
import type { SortableMatch } from "./match-sort.ts";

const BLOCKERS_SCHEMA = /^\[.*\]$/su;

/** Everything a stored score must match before it can be reused instead of re-rolled. */
export interface ScoreIdentity {
  scorerVersion: string;
  resumeId: string | null;
  targetsVersion: number;
  descriptionHash: string | null;
}

export interface StoredMatch extends SortableMatch {
  userId: string;
  codeRank: number;
  reason: string | null;
  scoredAt: number | null;
  reasons: readonly string[];
  roleFit: number | null;
  skills: number | null;
  level: number | null;
  logistics: number | null;
  descriptionHash: string | null;
  scorerVersion: string | null;
  resumeId: string | null;
  targetsVersion: number | null;
}

function stringList(value: string) {
  if (!BLOCKERS_SCHEMA.test(value)) {
    return [];
  }

  try {
    const parsed = z.array(z.string()).safeParse(JSON.parse(value));

    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function blockerList(value: string) {
  return stringList(value).filter(
    (item): item is ScoreBlocker =>
      item === "license_required" ||
      item === "language_required" ||
      item === "level_far_off" ||
      item === "wrong_field" ||
      item === "location_incompatible" ||
      item === "not_a_job",
  );
}

/**
 * Reads every stored match for one user, including unscored rows, so the page can render "Scoring…" honestly.
 * @param db The application database.
 * @param userId The signed-in user.
 * @returns The stored rows, unsorted.
 */
export function readStoredMatches(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(matches)
    .where(eq(matches.userId, userId))
    .all()
    .map((row) => ({
      blockers: blockerList(row.blockers),
      codeRank: row.codeRank,
      companyKey: row.companyKey ?? "",
      descriptionHash: row.descriptionHash,
      exactRole: row.exactRole,
      id: row.postingId,
      level: row.level,
      logistics: row.logistics,
      postedAt: row.postedAt,
      reason: row.reason,
      reasons: stringList(row.reasons),
      resumeId: row.resumeId,
      roleFit: row.roleFit,
      score: row.score,
      scoredAt: row.scoredAt,
      scorerVersion: row.scorerVersion,
      skills: row.skills,
      targetsVersion: row.targetsVersion,
      userId: row.userId,
    }));
}

/**
 * Whether a stored score still describes this candidate, prompt and posting. A changed resume, targets version,
 * scorer version or description means it must be scored again.
 * @param row The stored row.
 * @param identity The current identity.
 * @returns True when the score may be reused.
 */
export function matchIsReusable(row: StoredMatch, identity: ScoreIdentity) {
  return (
    row.score !== null &&
    row.scorerVersion === identity.scorerVersion &&
    row.resumeId === identity.resumeId &&
    row.targetsVersion === identity.targetsVersion &&
    row.descriptionHash === identity.descriptionHash
  );
}

/**
 * Records a job in the pool before it is scored, so the Matches page can show the row as "Scoring…" rather than
 * inventing a number. It never clears a stored score the identity still allows.
 * @param db The application database.
 * @param input The job and its current identity.
 */
export function writePendingMatch(
  db: AppDatabase,
  input: {
    userId: string;
    jobId: string;
    codeRank: number;
    postedAt: number | null;
    exactRole: boolean;
    companyKey: string;
    descriptionHash: string | null;
  },
) {
  db.insert(matches)
    .values({
      codeRank: input.codeRank,
      companyKey: input.companyKey,
      descriptionHash: input.descriptionHash,
      exactRole: input.exactRole,
      postingId: input.jobId,
      postedAt: input.postedAt,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [matches.userId, matches.postingId],
      set: {
        codeRank: input.codeRank,
        companyKey: input.companyKey,
        descriptionHash: input.descriptionHash,
        exactRole: input.exactRole,
        postedAt: input.postedAt,
        scoredAt: null,
        score: null,
      },
    })
    .run();
}

/**
 * Stores one validated score exactly once. The score is the sum of the anchored sub-scores; the model never supplies
 * an overall number.
 * @param db The application database.
 * @param clock The clock the scored-at timestamp comes from.
 * @param input The user, job, reply and identity.
 * @returns The stored score.
 */
export function writeScoredMatch(
  db: AppDatabase,
  clock: Clock,
  input: {
    userId: string;
    jobId: string;
    codeRank: number;
    postedAt: number | null;
    exactRole: boolean;
    companyKey: string;
    identity: ScoreIdentity;
    reply: ScoreReply;
  },
) {
  const score = scoreOf(input.reply);
  const scoredAt = clock.now();

  db.insert(matches)
    .values({
      blockers: JSON.stringify(input.reply.blockers),
      codeRank: input.codeRank,
      companyKey: input.companyKey,
      descriptionHash: input.identity.descriptionHash,
      exactRole: input.exactRole,
      level: input.reply.level,
      logistics: input.reply.logistics,
      postingId: input.jobId,
      postedAt: input.postedAt,
      reason: input.reply.reasons[0] ?? null,
      reasons: JSON.stringify(input.reply.reasons),
      resumeId: input.identity.resumeId,
      roleFit: input.reply.role_fit,
      score,
      scoredAt,
      scorerVersion: input.identity.scorerVersion,
      skills: input.reply.skills,
      targetsVersion: input.identity.targetsVersion,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [matches.userId, matches.postingId],
      set: {
        blockers: JSON.stringify(input.reply.blockers),
        codeRank: input.codeRank,
        companyKey: input.companyKey,
        descriptionHash: input.identity.descriptionHash,
        exactRole: input.exactRole,
        level: input.reply.level,
        logistics: input.reply.logistics,
        postedAt: input.postedAt,
        reason: input.reply.reasons[0] ?? null,
        reasons: JSON.stringify(input.reply.reasons),
        resumeId: input.identity.resumeId,
        roleFit: input.reply.role_fit,
        score,
        scoredAt,
        scorerVersion: input.identity.scorerVersion,
        skills: input.reply.skills,
        targetsVersion: input.identity.targetsVersion,
      },
    })
    .run();

  return score;
}

/**
 * Drops the stored rows for jobs a filter change removed, so a removed role or place never leaves a stale card.
 * @param db The application database.
 * @param userId The signed-in user.
 * @param keepJobIds The jobs still in the pool.
 * @returns How many rows were removed.
 */
export function dropMatchesNotIn(db: AppDatabase, userId: string, keepJobIds: readonly string[]) {
  const keep = new Set(keepJobIds);

  const stored = db
    .select({ jobId: matches.postingId })
    .from(matches)
    .where(eq(matches.userId, userId))
    .all()
    .map((row) => row.jobId)
    .filter((jobId) => !keep.has(jobId));

  const jobIds = new Set<string>();

  for (let start = 0; start < stored.length; start += 400) {
    for (const row of db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, stored.slice(start, start + 400)))
      .all()) {
      jobIds.add(row.id);
    }
  }

  let removed = 0;

  for (const jobId of stored) {
    if (!jobIds.has(jobId)) {
      continue;
    }

    db.delete(matches)
      .where(and(eq(matches.userId, userId), eq(matches.postingId, jobId)))
      .run();
    removed += 1;
  }

  return removed;
}

/**
 * Converts a stored row's JSON columns back into the validated shape, for callers that already have a row.
 * @param row The stored match.
 * @returns The reply, or null when the row has no score.
 */
export function replyOf(row: StoredMatch) {
  if (
    row.score === null ||
    row.roleFit === null ||
    row.skills === null ||
    row.level === null ||
    row.logistics === null
  ) {
    return null;
  }

  return parseScoreReply(
    JSON.stringify({
      blockers: row.blockers,
      level: row.level,
      logistics: row.logistics,
      reasons: row.reasons,
      role_fit: row.roleFit,
      skills: row.skills,
    }),
  );
}
