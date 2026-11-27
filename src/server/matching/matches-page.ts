import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";
import { matchBandOf, orderedMatchesWithPending } from "./match-sort.ts";
import { readStoredMatches } from "./match-store.ts";
import { openPostingDisplayRows } from "./posting-display.ts";

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

const MAX_REASONS = 3;

const BAND_BY_LABEL = { Good: "good", Possible: "possible", Strong: "strong" } as const;

const REASON_BOUNDARY = /(?<=[.!?])\s+/u;

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

function bandOf(score: number | null) {
  const band = score === null ? null : matchBandOf(score);

  return band === null ? null : BAND_BY_LABEL[band];
}

function safePageSize(pageSize: number) {
  return Math.min(50, Math.max(1, Math.floor(pageSize)));
}

function emptyPage(page: number, pageSize: number) {
  return { items: [], page, pageSize, total: 0, totalPages: 1 } satisfies MatchesPageView;
}

function pageRowsOf(deps: { db: AppDatabase; catalogDb: CatalogDatabase }, userId: string) {
  const stored = readStoredMatches(deps.db, userId);

  if (stored.length === 0) {
    return [];
  }

  const display = openPostingDisplayRows(
    deps,
    stored.map((row) => row.id),
  );

  const ordered = orderedMatchesWithPending(stored.filter((row) => display.has(row.id)));

  const rows: MatchesPageRow[] = ordered.flatMap((row) => {
    const posting = display.get(row.id);

    return posting === undefined
      ? []
      : [
          {
            applicationId: null,
            band: bandOf(row.score),
            company: posting.company,
            id: row.id,
            location: posting.location,
            postedAt: posting.postedAt,
            reasons:
              row.reasons.length > 0
                ? [...row.reasons].slice(0, MAX_REASONS)
                : reasonsOf(row.reason),
            score: row.score,
            title: posting.title,
          },
        ];
  });

  return rows;
}

/**
 * Reads one server-paged screen of the user's stored matches in the ADR 0045 order. A job that is
 * closed drops out; an unscored job keeps "Scoring…" after every scored row.
 *
 * @param deps The app database and the catalog the legacy postings live in.
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
  const ordered = pageRowsOf(deps, userId);

  if (ordered.length === 0) {
    return emptyPage(wanted, size);
  }

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

  return { items: pageRows, page, pageSize: size, total, totalPages } satisfies MatchesPageView;
}
