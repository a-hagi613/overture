import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { companies, postings } from "../platform/db/catalog-schema.ts";
import { applications, matches } from "../platform/db/schema.ts";

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

const POSTING_CHUNK = 400;

function openPostingIds(catalogDb: CatalogDatabase, ids: readonly string[]) {
  const open = new Set<string>();

  for (let start = 0; start < ids.length; start += POSTING_CHUNK) {
    const chunk = ids.slice(start, start + POSTING_CHUNK);

    for (const row of catalogDb
      .select({ id: postings.id })
      .from(postings)
      .where(and(inArray(postings.id, chunk), eq(postings.status, "open")))
      .all()) {
      open.add(row.id);
    }
  }

  return open;
}

/**
 * Reads the user's newest matches: the stored AI score only, ordered by the code rank that never
 * leaves the server. A row with no stored score stays `null` so the screen says "Scoring…".
 *
 * @param deps The app database and the catalog the postings live in.
 * @param userId The signed-in user.
 * @param limit How many matches the caller renders.
 * @returns The newest matches and how many unpicked, still-open matches the user has.
 */
export function newMatchesOf(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  userId: string,
  limit: number,
) {
  const picked = deps.db
    .select({ one: sql`1` })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.postingId, matches.postingId)));

  const unpicked = deps.db
    .select({ id: matches.postingId, score: matches.score })
    .from(matches)
    .where(and(eq(matches.userId, userId), notExists(picked)))
    .orderBy(desc(matches.codeRank))
    .all();

  if (unpicked.length === 0) {
    return { items: [], total: 0 } satisfies NewMatchesView;
  }

  const open = openPostingIds(
    deps.catalogDb,
    unpicked.map((row) => row.id),
  );

  const visible = unpicked.filter((row) => open.has(row.id));
  const page = visible.slice(0, limit);

  if (page.length === 0) {
    return { items: [], total: 0 } satisfies NewMatchesView;
  }

  const postingRows = deps.catalogDb
    .select({
      company: companies.name,
      id: postings.id,
      location: postings.locationRaw,
      title: postings.title,
    })
    .from(postings)
    .innerJoin(companies, eq(companies.id, postings.companyId))
    .where(
      inArray(
        postings.id,
        page.map((row) => row.id),
      ),
    )
    .all();

  const byId = new Map(postingRows.map((row) => [row.id, row]));

  return {
    items: page.flatMap((row) => {
      const posting = byId.get(row.id);

      return posting === undefined
        ? []
        : [
            {
              company: posting.company,
              id: posting.id,
              location: posting.location,
              score: row.score ?? null,
              title: posting.title,
            },
          ];
    }),
    total: visible.length,
  } satisfies NewMatchesView;
}
