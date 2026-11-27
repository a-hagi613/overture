import { eq } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";
import { orderedMatchesWithPending } from "./match-sort.ts";
import { readStoredMatches } from "./match-store.ts";
import { openPostingDisplayRows } from "./posting-display.ts";

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

  const visible = openPostingDisplayRows(
    deps,
    unpicked.map((row) => row.id),
  );

  const shown = orderedMatchesWithPending(unpicked.filter((row) => visible.has(row.id)));
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
