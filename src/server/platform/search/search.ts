import { sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";

export interface SearchQuery {
  text: string;
  openOnly: boolean;
  limit: number;
}

export interface SearchHitRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  department: string | null;
  url: string;
  applyUrl: string;
  ats: string;
  closedAt: number | null;
  postedAt: number | null;
  rank: number;
}

function ftsMatchExpression(text: string) {
  const tokens = text
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', "").replaceAll("*", "")}"*`);

  const match = tokens.join(" ");

  return match.length === 0 ? null : match;
}

export function searchPostings(db: AppDatabase, query: SearchQuery) {
  const match = ftsMatchExpression(query.text);

  if (match === null) {
    return [];
  }

  const openFilter = query.openOnly ? sql`and p.closed_at is null` : sql``;

  return db.all<SearchHitRow>(sql`
    select id, title, company, location, department, url, applyUrl, ats, closedAt, postedAt, rank
    from (
      select p.id, p.title, c.name as company,
        p.location_raw as location, p.department, p.url,
        coalesce(p.apply_url, p.apply_url_norm) as applyUrl, p.ats,
        p.closed_at as closedAt, p.posted_at as postedAt, f.rank as rank,
        row_number() over (
          partition by p.dedupe_key
          order by p.closed_at is not null, p.first_seen_at, p.id
        ) as rn
      from postings p
      join companies c on c.id = p.company_id
      join postings_fts f on f.rowid = p.rowid
      where postings_fts match ${match} ${openFilter}
    )
    where rn = 1
    order by rank, id
    limit ${query.limit}
  `);
}
