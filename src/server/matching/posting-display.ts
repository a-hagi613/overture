import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase, CatalogDatabase } from "../platform/db/client.ts";

import { companies, postings } from "../platform/db/catalog-schema.ts";
import { jobs } from "../platform/db/schema.ts";

const ID_CHUNK = 400;

/** The display copy Home and Matches show for one open Posting, read from whichever table still holds it. */
export interface OpenPostingDisplay {
  company: string;
  id: string;
  location: string | null;
  postedAt: number | null;
  title: string;
}

/**
 * Reads the display fields of the open Postings among `ids`. A freehire job lives in the shared `jobs` table and a
 * legacy Posting in the read-only catalog, so both are read in the same chunks and keyed by id; a closed row is left
 * out so neither screen shows a job the person can no longer act on.
 * @param deps The app database and the catalog the legacy postings live in.
 * @param ids The Posting ids to read.
 * @returns The display fields that exist, by Posting id.
 */
export function openPostingDisplayRows(
  deps: { db: AppDatabase; catalogDb: CatalogDatabase },
  ids: readonly string[],
) {
  const byId = new Map<string, OpenPostingDisplay>();

  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    const chunk = ids.slice(start, start + ID_CHUNK);

    for (const row of deps.db
      .select({
        company: jobs.company,
        id: jobs.id,
        location: jobs.locationRaw,
        postedAt: jobs.postedAt,
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
        postedAt: postings.postedAt,
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
