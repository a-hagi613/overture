import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../db/client.ts";

import type { EmploymentType, Seniority, Workplace } from "../../../shared/tag-taxonomy.ts";

export interface SearchFilters {
  role: string | null;
  seniority: Seniority | null;
  workplace: Workplace | null;
  location: string | null;
  employmentType: EmploymentType | null;
}

export interface SearchQuery {
  text: string;
  openOnly: boolean;
  limit: number;
  filters: SearchFilters;
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

function tagMatches(dimension: "role" | "seniority", value: string) {
  return sql` and exists (
    select 1 from posting_tags pt
    where pt.posting_id = p.id and pt.dimension = ${dimension} and pt.value = ${value}
  )`;
}

function filtersExpression(filters: SearchFilters) {
  const parts: SQL[] = [];

  if (filters.role !== null) {
    parts.push(tagMatches("role", filters.role));
  }

  if (filters.seniority !== null) {
    parts.push(tagMatches("seniority", filters.seniority));
  }

  if (filters.workplace !== null) {
    parts.push(sql` and p.workplace = ${filters.workplace}`);
  }

  if (filters.location !== null) {
    parts.push(sql` and lower(p.city) = lower(${filters.location})`);
  }

  if (filters.employmentType !== null) {
    parts.push(sql` and p.employment_type = ${filters.employmentType}`);
  }

  return parts.length === 0 ? sql`` : sql.join(parts, sql``);
}

export function searchPostings(db: CatalogDatabase, query: SearchQuery) {
  const match = ftsMatchExpression(query.text);

  if (match === null) {
    return [];
  }

  const openFilter = query.openOnly ? sql`and p.closed_at is null` : sql``;
  const filtersFilter = filtersExpression(query.filters);

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
      where postings_fts match ${match} ${openFilter} ${filtersFilter}
    )
    where rn = 1
    order by rank, id
    limit ${query.limit}
  `);
}
