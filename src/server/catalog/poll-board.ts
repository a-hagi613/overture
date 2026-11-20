import { and, eq, gte, isNull, notInArray, sql } from "drizzle-orm";

import type { AppDatabase, DatabaseWriter } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import { companyBoards, postings } from "../platform/db/schema.ts";
import { normalizeApplyUrl, normalizeTitle } from "./normalize.ts";
import { contentHash } from "./content-hash.ts";
import { dedupeKeyFor } from "./dedupe-key.ts";
import { storePostingTags, salaryPeriodForColumn } from "./tag-store.ts";
import { tagPosting } from "./tag-rules.ts";

import type { BoardFeed, FeedContent, FeedPosting } from "./board-feed.ts";

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
const POSTINGS_PER_CHUNK = 50;

export interface PollBoardReport {
  boardId: string;
  outcome: "polled" | "not_modified" | "gone" | "error";
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

async function yieldToEventLoop() {
  await Bun.sleep(0);
}

function latestChangeMsForBoard(db: AppDatabase, boardId: string) {
  const row = db
    .select({
      latestSource: sql<number | null>`max(${postings.sourceUpdatedAt})`,
      latestPosted: sql<number | null>`max(${postings.postedAt})`,
    })
    .from(postings)
    .where(and(eq(postings.boardId, boardId), isNull(postings.closedAt)))
    .get();

  const candidates = [row?.latestSource ?? null, row?.latestPosted ?? null].filter(
    (value): value is number => value !== null,
  );

  return candidates.length === 0 ? null : Math.max(...candidates);
}

async function fetchDetailOrNull(feed: BoardFeed, boardToken: string, atsJobId: string) {
  if (feed.fetchPostingDetail === undefined) {
    return null;
  }

  try {
    return await feed.fetchPostingDetail(boardToken, atsJobId);
  } catch {
    return null;
  }
}

function touchWithoutChange(db: AppDatabase, clock: Clock, board: BoardRow, now: number) {
  const latestChangeMs = latestChangeMsForBoard(db, board.id);

  db.update(postings)
    .set({ missingPolls: sql`${postings.missingPolls} + 1` })
    .where(
      and(eq(postings.boardId, board.id), isNull(postings.closedAt), gte(postings.missingPolls, 1)),
    )
    .run();

  const closed = closeMissingPostings(db, clock, board.id);

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
    closed,
    error: null,
  } satisfies PollBoardReport;
}

function closeMissingPostings(db: AppDatabase, clock: Clock, boardId: string) {
  const closed = db
    .update(postings)
    .set({ closedAt: clock.now() })
    .where(
      and(
        eq(postings.boardId, boardId),
        isNull(postings.closedAt),
        gte(postings.missingPolls, MISSING_POLLS_TO_CLOSE),
      ),
    )
    .returning({ id: postings.id })
    .all();

  return closed.length;
}

function postingValues(
  board: BoardRow,
  posting: FeedPosting,
  detail: FeedContent | null,
  now: number,
) {
  const descriptionText = detail?.descriptionText ?? null;
  const titleNorm = normalizeTitle(posting.title);
  const locationRaw = detail?.locationRaw ?? posting.locationRaw;

  const tags = tagPosting({
    title: posting.title,
    department: detail?.department ?? null,
    locationRaw,
    workplaceType: null,
    isRemote: null,
    employmentType: null,
    language: posting.language,
    salary: null,
    descriptionText: descriptionText === null ? null : descriptionText.slice(0, 20_000),
  });

  const dedupeKey = dedupeKeyFor({
    companyId: board.companyId,
    titleNorm,
    countryCode: tags.countryCode,
    city: tags.city,
  });

  const values = {
    url: posting.url,
    applyUrl: null,
    applyUrlNorm: normalizeApplyUrl(posting.url),
    title: posting.title,
    titleNorm,
    department: detail?.department ?? null,
    locationRaw,
    countryCode: tags.countryCode,
    region: tags.region,
    city: tags.city,
    language: tags.language,
    workplace: tags.workplace,
    employmentType: tags.employmentType,
    salaryMinMinor: tags.salaryMinMinor,
    salaryMaxMinor: tags.salaryMaxMinor,
    salaryCurrency: tags.salaryCurrency,
    salaryPeriod: salaryPeriodForColumn(tags.salaryPeriod),
    postedAt: parseMs(posting.postedAt),
    sourceUpdatedAt: parseMs(posting.sourceUpdatedAt),
    lastSeenAt: now,
    missingPolls: 0,
    closedAt: null,
    dedupeKey,
    descriptionGz: descriptionText === null ? null : gzip(descriptionText),
    descriptionHash: descriptionText === null ? null : contentHash(descriptionText),
    tagSource: "rules" as const,
    taggedAt: now,
  };

  return { values, tags };
}

async function syncPostings(
  db: AppDatabase,
  clock: Clock,
  feed: BoardFeed,
  board: BoardRow,
  boardPostings: FeedPosting[],
  now: number,
) {
  const report = { added: 0, updated: 0, closed: 0 };
  const seenJobIds = new Set<string>(boardPostings.map((posting) => posting.atsJobId));

  const existingRows = db
    .select({
      id: postings.id,
      atsJobId: postings.atsJobId,
      sourceUpdatedAt: postings.sourceUpdatedAt,
      closedAt: postings.closedAt,
    })
    .from(postings)
    .where(eq(postings.boardId, board.id))
    .all();

  const existingByJobId = new Map(existingRows.map((row) => [row.atsJobId, row]));

  const changedPostings = boardPostings.filter((posting) => {
    const existing = existingByJobId.get(posting.atsJobId);
    const sourceUpdatedAtMs = parseMs(posting.sourceUpdatedAt);

    const unchanged =
      existing?.closedAt === null &&
      existing.sourceUpdatedAt !== null &&
      existing.sourceUpdatedAt === sourceUpdatedAtMs;

    return !unchanged;
  });

  const detailPairs = await Promise.all(
    changedPostings.map(async (posting) => {
      const content = posting.descriptionPending
        ? await fetchDetailOrNull(feed, board.boardToken, posting.atsJobId)
        : posting.content;

      return [posting.atsJobId, content] as const;
    }),
  );

  const contentByJobId = new Map<string, FeedContent | null>(detailPairs);

  async function writeChunk(offset: number) {
    const chunk = boardPostings.slice(offset, offset + POSTINGS_PER_CHUNK);

    db.transaction((tx) => {
      for (const posting of chunk) {
        const existing = existingByJobId.get(posting.atsJobId);

        if (existing !== undefined && !contentByJobId.has(posting.atsJobId)) {
          touchUnchangedPosting(tx, existing.id, now);

          continue;
        }

        const detail = posting.descriptionPending
          ? (contentByJobId.get(posting.atsJobId) ?? null)
          : posting.content;

        const { values, tags } = postingValues(board, posting, detail, now);

        if (existing === undefined) {
          const inserted = tx
            .insert(postings)
            .values({
              id: crypto.randomUUID(),
              boardId: board.id,
              companyId: board.companyId,
              ats: board.ats,
              atsJobId: posting.atsJobId,
              firstSeenAt: now,
              ...values,
            })
            .onConflictDoNothing()
            .returning({ id: postings.id })
            .all()
            .at(0);

          if (inserted !== undefined) {
            storePostingTags(tx, inserted.id, tags, now);

            report.added += 1;
          }

          continue;
        }

        tx.update(postings).set(values).where(eq(postings.id, existing.id)).run();

        storePostingTags(tx, existing.id, tags, now);

        report.updated += 1;
      }
    });

    const next = offset + chunk.length;

    if (next < boardPostings.length) {
      await yieldToEventLoop();
      await writeChunk(next);
    }
  }

  await writeChunk(0);

  const missingFilter =
    seenJobIds.size === 0
      ? and(eq(postings.boardId, board.id), isNull(postings.closedAt))
      : and(
          eq(postings.boardId, board.id),
          isNull(postings.closedAt),
          notInArray(postings.atsJobId, [...seenJobIds]),
        );

  db.update(postings)
    .set({ missingPolls: sql`${postings.missingPolls} + 1` })
    .where(missingFilter)
    .run();

  report.closed += closeMissingPostings(db, clock, board.id);

  return report;
}

function touchUnchangedPosting(db: DatabaseWriter, postingId: string, now: number) {
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
  result: { etag: string | null; bodyHash: string; postings: FeedPosting[] },
) {
  const now = clock.now();
  const latestChangeMs = latestChangeMsForBoard(db, board.id);

  db.update(companyBoards)
    .set({
      etag: result.etag,
      contentHash: result.bodyHash,
      lastPolledAt: now,
      nextPollAt: nextPollAtMs(now, latestChangeMs),
      backoffLevel: 0,
      consecutiveErrors: 0,
      notFoundPolls: 0,
      status: result.postings.length === 0 ? "empty" : "active",
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
  feed: BoardFeed,
  board: BoardRow,
) => {
  const now = clock.now();

  let result;

  try {
    result = await feed.fetchBoard(board.boardToken, {
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

  const rows = await syncPostings(db, clock, feed, board, result.postings, now);

  markBoardPolled(db, clock, board, result);

  return { boardId: board.id, outcome: "polled", ...rows, error: null };
};
