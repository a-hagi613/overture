import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { companies, postings } from "../platform/db/catalog-schema.ts";
import { applications, matches } from "../platform/db/schema.ts";

/** One row of the Matches table: a stored score and its stored reasons, or "Scoring…". */
export interface MatchesPageRow {
  applicationId: string | null;
  band: MatchBand | null;
  company: string;
  id: string;
  location: string | null;
  postedAt: number | null;
  reasons: string[];
  score: number | null;
  title: string;
}

/** The band the score falls in, using the scorer's Strong · Good · Possible thresholds. */
export type MatchBand = "strong" | "good" | "possible";

/** One server-paged screen of the Matches table. */
export interface MatchesPageView {
  items: MatchesPageRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const POSTING_CHUNK = 400;

const STRONG_SCORE = 85;
const GOOD_SCORE = 70;
const POSSIBLE_SCORE = 50;
const MAX_REASONS = 3;

const REASON_BOUNDARY = /(?<=[.!?])\s+/u;

function bandOf(score: number | null) {
  if (score === null) {
    return null;
  }

  if (score >= STRONG_SCORE) {
    return "strong";
  }

  if (score >= GOOD_SCORE) {
    return "good";
  }

  return score >= POSSIBLE_SCORE ? "possible" : null;
}

const storedReasonsSchema = z.array(z.string());

function parsedReasons(stored: string) {
  if (!stored.startsWith("[")) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    const reasons = storedReasonsSchema.safeParse(parsed);

    return reasons.success ? reasons.data : null;
  } catch {
    return null;
  }
}

/**
 * Reads the reasons a stored score carries: a JSON array of short sentences, or one stored
 * sentence split into at most three. An unscored job has none, so the screen says "Scoring…".
 *
 * @param stored The stored `matches.reason` text, if a score exists.
 * @returns Up to three short reasons, never a ranking point.
 */
export function reasonsOf(stored: string | null) {
  if (stored === null) {
    return [];
  }

  const trimmed = stored.trim();

  if (trimmed === "") {
    return [];
  }

  const array = parsedReasons(trimmed);

  if (array !== null) {
    return array.slice(0, MAX_REASONS);
  }

  return trimmed
    .split(REASON_BOUNDARY)
    .map((reason) => reason.trim())
    .flatMap((reason) => (reason === "" ? [] : [reason]))
    .slice(0, MAX_REASONS);
}

function compareDescending(a: number | null, b: number | null) {
  if (a === b) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  return b === null ? -1 : b - a;
}

/**
 * The Matches order: highest stored score first, then the newest posting, then the job id, so a
 * page never repeats or skips a row. Ranking points are never read.
 *
 * @param left One row.
 * @param right Another row.
 * @returns The sort order.
 */
export function compareMatches(left: MatchesPageRow, right: MatchesPageRow) {
  const byScore = compareDescending(left.score, right.score);

  if (byScore !== 0) {
    return byScore;
  }

  const byPosted = compareDescending(left.postedAt, right.postedAt);

  return byPosted === 0 ? left.id.localeCompare(right.id) : byPosted;
}

function openPostingsOf(catalogDb: CatalogDatabase, ids: readonly string[]) {
  const found = new Map<
    string,
    { company: string; id: string; location: string | null; postedAt: number | null; title: string }
  >();

  for (let start = 0; start < ids.length; start += POSTING_CHUNK) {
    const chunk = ids.slice(start, start + POSTING_CHUNK);

    const rows = catalogDb
      .select({
        company: companies.name,
        id: postings.id,
        location: postings.locationRaw,
        postedAt: postings.postedAt,
        title: postings.title,
      })
      .from(postings)
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(and(inArray(postings.id, chunk), eq(postings.status, "open")))
      .all();

    for (const row of rows) {
      found.set(row.id, row);
    }
  }

  return found;
}

function applicationIdsOf(db: AppDatabase, userId: string, ids: readonly string[]) {
  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const rows = db
    .select({ id: applications.id, postingId: applications.postingId })
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.postingId, [...ids])))
    .all();

  return new Map(rows.map((row) => [row.postingId, row.id]));
}

function safePageSize(pageSize: number) {
  return Math.min(50, Math.max(1, Math.floor(pageSize)));
}

function emptyPage(page: number, pageSize: number) {
  return { items: [], page, pageSize, total: 0, totalPages: 1 } satisfies MatchesPageView;
}

/**
 * Reads one server-paged screen of the user's stored matches. A job that is closed or has no
 * stored score still keeps its honest place: closed jobs drop out, unscored jobs show "Scoring…".
 *
 * @param deps The app database and the catalog the postings live in.
 * @param userId The signed-in user.
 * @param paging The requested page and its size.
 * @returns The page's rows plus the honest total and page count.
 */
export function matchesPageOf(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  userId: string,
  paging: { page: number; pageSize: number },
) {
  const size = safePageSize(paging.pageSize);

  const wanted = Math.max(1, Math.floor(paging.page));

  const stored = deps.db
    .select({ postingId: matches.postingId, reason: matches.reason, score: matches.score })
    .from(matches)
    .where(eq(matches.userId, userId))
    .all();

  if (stored.length === 0) {
    return emptyPage(wanted, size);
  }

  const postingsById = openPostingsOf(
    deps.catalogDb,
    stored.map((row) => row.postingId),
  );

  const visible: MatchesPageRow[] = [];

  for (const row of stored) {
    const posting = postingsById.get(row.postingId);

    if (posting !== undefined) {
      visible.push({
        applicationId: null,
        band: bandOf(row.score),
        company: posting.company,
        id: posting.id,
        location: posting.location,
        postedAt: posting.postedAt,
        reasons: reasonsOf(row.reason),
        score: row.score,
        title: posting.title,
      });
    }
  }

  const ordered = visible.toSorted(compareMatches);

  const total = ordered.length;

  const totalPages = Math.max(1, Math.ceil(total / size));

  const page = Math.min(wanted, totalPages);

  const start = (page - 1) * size;

  const pageRows = ordered.slice(start, start + size);

  const applicationIds = applicationIdsOf(
    deps.db,
    userId,
    pageRows.map((row) => row.id),
  );

  for (const row of pageRows) {
    row.applicationId = applicationIds.get(row.id) ?? null;
  }

  const view: MatchesPageView = { items: pageRows, page, pageSize: size, total, totalPages };

  return view;
}
