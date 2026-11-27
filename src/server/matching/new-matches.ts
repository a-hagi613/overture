import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { companies, postings } from "../platform/db/catalog-schema.ts";
import { applications, jobs } from "../platform/db/schema.ts";
import { orderedMatches } from "./match-sort.ts";
import { readStoredMatches } from "./match-store.ts";
import type { StoredMatch } from "./match-store.ts";

/** One scored (or still scoring) job the user has not picked yet, as Home and Matches show it. */
export interface NewMatch {
  company: string;
  id: string;
  location: string | null;
  score: number | null;
  title: string;
}

/** The newest matches with their honest total, so a section count never counts past the list. */
export interface NewMatchesView {
  items: NewMatch[];
  total: number;
}

const ID_CHUNK = 400;

interface DisplayRow {
  company: string;
  id: string;
  location: string | null;
  title: string;
}

function displayRows(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  ids: readonly string[],
) {
  const byId = new Map<string, DisplayRow>();

  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);

    for (const row of deps.db
      .select({
        company: jobs.company,
        id: jobs.id,
        location: jobs.locationRaw,
        title: jobs.title,
      })
      .from(jobs)
      .where(and(inArray(jobs.id, chunk), eq(jobs.status, "open")))
      .all()) {
      byId.set(row.id, row);
    }

    for (const row of deps.catalogDb
      .select({
        company: companies.name,
        id: postings.id,
        location: postings.locationRaw,
        title: postings.title,
      })
      .from(postings)
      .innerJoin(companies, eq(companies.id, postings.companyId))
      .where(and(inArray(postings.id, chunk), eq(postings.status, "open")))
      .all()) {
      byId.set(row.id, row);
    }
  }

  return byId;
}

function scoringOrder(rows: readonly StoredMatch[]) {
  const scored = orderedMatches(rows);
  const scoredIds = new Set(scored.map((row) => row.id));

  const unscored = rows
    .filter((row) => row.score === null && row.blockers.length === 0 && !scoredIds.has(row.id))
    .toSorted((left, right) => {
      if (left.codeRank !== right.codeRank) {
        return right.codeRank - left.codeRank;
      }

      const posted = (right.postedAt ?? 0) - (left.postedAt ?? 0);

      return posted === 0 ? left.id.localeCompare(right.id) : posted;
    });

  return [...scored, ...unscored];
}

/**
 * Reads the user's newest matches: the stored score and the ADR 0045 order, never the code rank as a number. A row
 * with no stored score stays `null` so the screen says "Scoring…".
 *
 * @param deps The app database and the catalog the legacy postings live in.
 * @param userId The signed-in user.
 * @param limit How many matches the caller renders.
 * @returns The newest matches and how many unpicked, still-open matches the user has.
 */
export function newMatchesOf(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  userId: string,
  limit: number,
) {
  const picked = new Set(
    deps.db
      .select({ postingId: applications.postingId })
      .from(applications)
      .where(eq(applications.userId, userId))
      .all()
      .map((row) => row.postingId),
  );

  const unpicked = readStoredMatches(deps.db, userId).filter((row) => !picked.has(row.id));

  if (unpicked.length === 0) {
    return { items: [], total: 0 } satisfies NewMatchesView;
  }

  const visible = displayRows(
    deps,
    unpicked.map((row) => row.id),
  );

  const open = unpicked.filter((row) => visible.has(row.id));
  const shown = scoringOrder(open);
  const page = shown.slice(0, limit);

  return {
    items: page.flatMap((row) => {
      const posting = visible.get(row.id);

      return posting === undefined
        ? []
        : [
            {
              company: posting.company,
              id: posting.id,
              location: posting.location,
              score: row.score,
              title: posting.title,
            },
          ];
    }),
    total: shown.length,
  } satisfies NewMatchesView;
}
