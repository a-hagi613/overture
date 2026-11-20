import { and, desc, eq, isNull, notInArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { indexPosting } from "../platform/search/search.ts";
import { companies, companyBoards, postings } from "../platform/db/schema.ts";
import { htmlToText } from "./html-to-text.ts";
import { normalizeApplyUrl, normalizeTitle } from "./normalize.ts";
import { contentHash } from "./content-hash.ts";
import { dedupeKeyFor } from "./dedupe-key.ts";

import type { GreenhouseFeed, GreenhouseFeedJob } from "./greenhouse-feed.ts";

export type BoardRow = typeof companyBoards.$inferSelect;

const ACTIVE_INTERVAL_MS = 30 * 60_000;
const QUIET_INTERVAL_MS = 2 * 3_600_000;
const INACTIVE_INTERVAL_MS = 12 * 3_600_000;
const ACTIVE_WINDOW_MS = 24 * 3_600_000;
const QUIET_WINDOW_MS = 7 * ACTIVE_WINDOW_MS;
const ERROR_BACKOFF_BASE_MS = 60_000;
const ERROR_BACKOFF_CAP_MS = 48 * 3_600_000;
const NOT_FOUND_BACKOFF_MS = 30 * 60_000;
const MISSING_POLLS_TO_CLOSE = 2;
const NOT_FOUND_POLLS_TO_GONE = 2;

export interface PollBoardReport {
  boardId: string;
  outcome: "polled" | "not_modified" | "gone" | "error" | "skipped";
  added: number;
  updated: number;
  closed: number;
  error: string | null;
}

export function nextPollAtMs(now: number, latestChangeMs: number | null) {
  if (latestChangeMs === null) {
    return now + INACTIVE_INTERVAL_MS;
  }

  const age = now - latestChangeMs;

  if (age < ACTIVE_WINDOW_MS) {
    return now + ACTIVE_INTERVAL_MS;
  }

  if (age < QUIET_WINDOW_MS) {
    return now + QUIET_INTERVAL_MS;
  }

  return now + INACTIVE_INTERVAL_MS;
}

function parseMs(iso: string | null) {
  if (iso === null || iso.length === 0) {
    return null;
  }

  const ms = Date.parse(iso);

  return Number.isFinite(ms) ? ms : null;
}

function gzip(descriptionText: string) {
  return Buffer.from(Bun.gzipSync(descriptionText));
}

function latestSourceUpdatedAtForBoard(db: AppDatabase, boardId: string) {
  const row = db
    .select({ latest: postings.sourceUpdatedAt })
    .from(postings)
    .where(and(eq(postings.boardId, boardId), isNull(postings.closedAt)))
    .orderBy(desc(postings.sourceUpdatedAt))
    .limit(1)
    .get();

  return row?.latest ?? null;
}

async function fetchDetailOrNull(feed: GreenhouseFeed, boardToken: string, jobId: string) {
  try {
    return await feed.fetchJobDetail(boardToken, jobId);
  } catch {
    return null;
  }
}

async function fetchChangedDetails(feed: GreenhouseFeed, boardToken: string, jobIds: string[]) {
  return Promise.all(jobIds.map(async (jobId) => fetchDetailOrNull(feed, boardToken, jobId)));
}

function touchWithoutChange(db: AppDatabase, clock: Clock, board: BoardRow, now: number) {
  const latestChangeMs = latestSourceUpdatedAtForBoard(db, board.id);

  db.update(companyBoards)
    .set({
      lastPolledAt: now,
      nextPollAt: nextPollAtMs(now, latestChangeMs),
      backoffLevel: 0,
      consecutiveErrors: 0,
      notFoundPolls: 0,
    })
    .where(eq(companyBoards.id, board.id))
    .run();

  return {
    boardId: board.id,
    outcome: "not_modified" as const,
    added: 0,
    updated: 0,
    closed: 0,
    error: null,
  } satisfies PollBoardReport;
}

async function syncPostings(
  db: AppDatabase,
  clock: Clock,
  feed: GreenhouseFeed,
  board: BoardRow,
  jobs: GreenhouseFeedJob[],
  companyName: string,
  now: number,
) {
  const report = { added: 0, updated: 0, closed: 0 };
  const seenJobIds = new Set<string>();
  const changedJobIds: string[] = [];

  const existingByJobId = new Map<
    string,
    { id: string; closedAt: number | null; sourceUpdatedAt: number | null }
  >();

  for (const job of jobs) {
    seenJobIds.add(job.id);

    const existing = db
      .select()
      .from(postings)
      .where(and(eq(postings.boardId, board.id), eq(postings.atsJobId, job.id)))
      .get();

    if (existing !== undefined) {
      existingByJobId.set(job.id, {
        id: existing.id,
        closedAt: existing.closedAt,
        sourceUpdatedAt: existing.sourceUpdatedAt,
      });
    }

    const jobUpdatedAtMs = parseMs(job.updatedAt);

    const unchanged =
      existing?.closedAt === null &&
      existing.sourceUpdatedAt !== null &&
      existing.sourceUpdatedAt === jobUpdatedAtMs;

    if (!unchanged) {
      changedJobIds.push(job.id);
    }
  }

  const details = await fetchChangedDetails(feed, board.boardToken, changedJobIds);

  for (const [index, job] of jobs.entries()) {
    if (!changedJobIds.includes(job.id)) {
      const unchangedId = existingByJobId.get(job.id);

      if (unchangedId !== undefined) {
        touchUnchangedPosting(db, unchangedId.id, now);
      }

      continue;
    }

    if (existingByJobId.get(job.id) === undefined) {
      report.added += 1;
    } else {
      report.updated += 1;
    }

    const detail = details[index] ?? null;
    const descriptionText = htmlToText(detail?.contentHtml ?? null);
    const titleNorm = normalizeTitle(job.title);

    const dedupeKey = dedupeKeyFor({
      companyId: board.companyId,
      titleNorm,
      countryCode: null,
      city: null,
    });

    const values = {
      url: job.absoluteUrl ?? "",
      applyUrlNorm: normalizeApplyUrl(job.absoluteUrl ?? ""),
      title: job.title,
      titleNorm,
      department: detail?.department ?? null,
      locationRaw: detail?.locationName ?? job.locationName,
      language: job.language,
      postedAt: parseMs(job.firstPublished),
      sourceUpdatedAt: parseMs(job.updatedAt),
      lastSeenAt: now,
      missingPolls: 0,
      closedAt: null,
      dedupeKey,
      descriptionGz: descriptionText === null ? null : gzip(descriptionText),
      descriptionHash: descriptionText === null ? null : contentHash(descriptionText),
    };

    const existingId = existingByJobId.get(job.id);

    const postingId =
      existingId === undefined
        ? ((
            db
              .insert(postings)
              .values({
                id: crypto.randomUUID(),
                boardId: board.id,
                companyId: board.companyId,
                ats: board.ats,
                atsJobId: job.id,
                firstSeenAt: now,
                ...values,
              })
              .onConflictDoNothing()
              .returning({ id: postings.id })
              .all()
              .at(0) ?? null
          )?.id ?? null)
        : existingId.id;

    if (postingId !== null) {
      indexPosting(db, {
        id: postingId,
        title: titleNorm,
        company: companyName,
        location: values.locationRaw ?? "",
        department: values.department,
      });
    }
  }

  const missingFilter =
    seenJobIds.size === 0
      ? and(eq(postings.boardId, board.id), isNull(postings.closedAt))
      : and(
          eq(postings.boardId, board.id),
          isNull(postings.closedAt),
          notInArray(postings.atsJobId, [...seenJobIds]),
        );

  const missingRows = db
    .update(postings)
    .set({ missingPolls: 1 })
    .where(missingFilter)
    .returning({ id: postings.id, missingPolls: postings.missingPolls })
    .all();

  for (const row of missingRows) {
    if (row.missingPolls >= MISSING_POLLS_TO_CLOSE) {
      db.update(postings).set({ closedAt: clock.now() }).where(eq(postings.id, row.id)).run();

      report.closed += 1;
    }
  }

  return report;
}

function touchUnchangedPosting(db: AppDatabase, postingId: string, now: number) {
  db.update(postings)
    .set({ lastSeenAt: now, missingPolls: 0 })
    .where(eq(postings.id, postingId))
    .run();
}

function conditionMatchesByHash(board: BoardRow, bodyHash: string) {
  return board.etag === null && board.contentHash !== null && board.contentHash === bodyHash;
}

function markBoardPolled(
  db: AppDatabase,
  clock: Clock,
  board: BoardRow,
  result: { etag: string | null; bodyHash: string; jobs: GreenhouseFeedJob[] },
) {
  const now = clock.now();
  const latestChangeMs = latestSourceUpdatedAtForBoard(db, board.id);

  db.update(companyBoards)
    .set({
      etag: result.etag,
      contentHash: result.bodyHash,
      lastPolledAt: now,
      nextPollAt: nextPollAtMs(now, latestChangeMs),
      backoffLevel: 0,
      consecutiveErrors: 0,
      notFoundPolls: 0,
      status: result.jobs.length === 0 ? "empty" : "active",
    })
    .where(eq(companyBoards.id, board.id))
    .run();
}

function markBoardGone(db: AppDatabase, board: BoardRow, notFoundPolls: number, now: number) {
  const isGone = notFoundPolls >= NOT_FOUND_POLLS_TO_GONE;

  db.update(companyBoards)
    .set({
      notFoundPolls,
      status: isGone ? "gone" : board.status,
      lastPolledAt: now,
      nextPollAt: isGone ? null : now + NOT_FOUND_BACKOFF_MS,
    })
    .where(eq(companyBoards.id, board.id))
    .run();

  return {
    boardId: board.id,
    outcome: "gone" as const,
    added: 0,
    updated: 0,
    closed: 0,
    error: null,
  } satisfies PollBoardReport;
}

function markBoardError(db: AppDatabase, board: BoardRow, now: number, message: string) {
  const backoffLevel = Math.min(board.backoffLevel + 1, 6);
  const backoffMs = Math.min(ERROR_BACKOFF_BASE_MS * 2 ** (backoffLevel - 1), ERROR_BACKOFF_CAP_MS);

  db.update(companyBoards)
    .set({
      consecutiveErrors: board.consecutiveErrors + 1,
      backoffLevel,
      lastPolledAt: now,
      nextPollAt: now + backoffMs,
    })
    .where(eq(companyBoards.id, board.id))
    .run();

  return {
    boardId: board.id,
    outcome: "error" as const,
    added: 0,
    updated: 0,
    closed: 0,
    error: message,
  } satisfies PollBoardReport;
}

export const pollBoard = async (
  db: AppDatabase,
  clock: Clock,
  feed: GreenhouseFeed,
  board: BoardRow,
) => {
  if (board.status === "gone" || board.nextPollAt === null || board.nextPollAt > clock.now()) {
    return { boardId: board.id, outcome: "skipped", added: 0, updated: 0, closed: 0, error: null };
  }

  const now = clock.now();

  let result;

  try {
    result = await feed.fetchBoardList(board.boardToken, {
      etag: board.etag,
      bodyHash: board.contentHash,
    });
  } catch (error) {
    return markBoardError(db, board, now, error instanceof Error ? error.message : String(error));
  }

  if (result.status === "gone") {
    return markBoardGone(db, board, board.notFoundPolls + 1, now);
  }

  if (result.status === "not_modified") {
    return touchWithoutChange(db, clock, board, now);
  }

  if (conditionMatchesByHash(board, result.bodyHash)) {
    return touchWithoutChange(db, clock, board, now);
  }

  const company = db.select().from(companies).where(eq(companies.id, board.companyId)).get();

  const rows = await syncPostings(db, clock, feed, board, result.jobs, company?.name ?? "", now);

  markBoardPolled(db, clock, board, result);

  return { boardId: board.id, outcome: "polled", ...rows, error: null };
};
