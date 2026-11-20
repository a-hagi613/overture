import { sql } from "drizzle-orm";

import type { AppDatabase } from "../db/client.ts";

export interface SearchablePosting {
  id: string;
  title: string;
  company: string;
  location: string;
  department: string | null;
}

export interface SearchHit {
  id: string;
  rank: number;
}

export function indexPosting(db: AppDatabase, posting: SearchablePosting): void {
  removePosting(db, posting.id);

  db.run(
    sql`insert into postings_fts (rowid, title, company, location, department)
      select p.rowid, ${posting.title}, ${posting.company}, ${posting.location}, ${posting.department ?? null}
      from postings p where p.id = ${posting.id}`,
  );
}

export function removePosting(db: AppDatabase, postingId: string): void {
  db.run(sql`delete from postings_fts where rowid = (select p.rowid from postings p where p.id = ${postingId})`);
}

export interface SearchQuery {
  text: string;
  openOnly: boolean;
  limit: number;
}

export function searchPostings(db: AppDatabase, query: SearchQuery): string[] {
  const match = query.text
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', "").replaceAll("*", "")}"*`)
    .join(" ");

  if (match.length === 0) {
    return [];
  }

  const rows = db.all<{ id: string }>(sql`
    select p.id
    from postings p
    join postings_fts f on f.rowid = p.rowid
    where postings_fts match ${match}
      and ${query.openOnly ? sql`p.closed_at is null` : sql`1 = 1`}
    order by rank, p.id
    limit ${query.limit}
  `);

  return rows.map((row) => row.id);
}
