import { sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";

export interface SearchablePosting {
  id: string;
  title: string;
  company: string;
  location: string;
  department: string | null;
}

export interface SearchQuery {
  text: string;
  openOnly: boolean;
  limit: number;
}

export interface SearchHitRow {
  id: string;
  title: string;
  titleNorm: string;
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

export function indexPosting(db: AppDatabase, posting: SearchablePosting) {
  removePosting(db, posting.id);

  db.run(
    sql`insert into postings_fts (rowid, title, company, location, department)
      select p.rowid, ${posting.title}, ${posting.company}, ${posting.location}, ${posting.department ?? null}
      from postings p where p.id = ${posting.id}`,
  );
}

export function removePosting(db: AppDatabase, postingId: string) {
  db.run(
    sql`delete from postings_fts where rowid = (select p.rowid from postings p where p.id = ${postingId})`,
  );
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
    select id, title, title_norm as titleNorm, company, location, department, url, apply_url as applyUrl, ats,
      closed_at as closedAt, posted_at as postedAt, rank
    from (
      select p.id, p.title, p.title_norm as titleNorm, c.name as company,
        p.location_raw as location, p.department, p.url, p.apply_url_norm as applyUrl, p.ats,
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
