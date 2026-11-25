import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { CatalogDatabase } from "../db/client.ts";

import type { EmploymentType, Seniority, Workplace } from "../../../shared/tag-taxonomy.ts";

import { resolvedLocationCondition } from "../../catalog/location-filter.ts";
import { roleFilterCondition, roleFilterTagValues } from "../../matching/role-targets.ts";

export interface SearchFilters {
  /** A category: a role-taxonomy id or name, or a retired category name (issue #660). */
  role: string | null;
  /** A role or subcategory id or name, or a retired ESCO name; when set it is the filter and `role` only a hint. */
  granularRole: string | null;
  seniority: Seniority | null;
  workplace: Workplace | null;
  location: string | null;
  /** The radius around a resolved city; null keeps an exact city match. */
  radiusKm: number | null;
  employmentType: EmploymentType | null;
  language: string | null;
  /** Annual USD floor, normalized during the ETL (issue #630). */
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  /** Only postings first seen within this many milliseconds. */
  postedWithinMs: number | null;
}

export interface SearchQuery {
  text: string;
  openOnly: boolean;
  limit: number;
  filters: SearchFilters;
  /** The clock reading the posted-age filter uses; defaults to `Date.now()`. */
  nowMs: number;
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

const POSTED_WITHIN = new Map(
  Object.entries({
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
  } satisfies Record<string, number>),
);

/**
 * Turns free text into an FTS5 MATCH expression.
 * @param text The visitor's words.
 * @returns The MATCH expression, or null when no word remains.
 */
export function ftsMatchExpression(text: string) {
  const phrases = [...text.matchAll(/"(?<phrase>[^"]+)"/gu)].flatMap((match) => {
    const phrase = match.groups?.phrase?.trim() ?? "";

    return phrase.length > 0 ? [`"${phrase.replaceAll('"', "")}"`] : [];
  });

  const tokens = text
    .replaceAll(/"[^"]*"/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', "").replaceAll("*", "")}"*`);

  const match = [...phrases, ...tokens].join(" ");

  return match.length === 0 ? null : match;
}

function tagMatches(dimensions: readonly string[], value: string) {
  return sql`exists (
    select 1 from posting_tags pt
    where pt.posting_id = postings.id
      and pt.dimension in (${sql.join(
        dimensions.map((dimension) => sql`${dimension}`),
        sql`, `,
      )})
      and pt.value = ${value}
  )`;
}

function filterConditions(db: CatalogDatabase, filters: SearchFilters, nowMs: number) {
  const parts: SQL[] = [];
  const roleValue = filters.granularRole ?? filters.role;

  if (roleValue !== null) {
    parts.push(roleFilterCondition(roleValue));
  }

  if (filters.seniority !== null) {
    parts.push(tagMatches(["seniority"], filters.seniority));
  }

  if (filters.workplace !== null) {
    parts.push(sql`postings.workplace = ${filters.workplace}`);
  }

  if (filters.employmentType !== null) {
    parts.push(sql`postings.employment_type = ${filters.employmentType}`);
  }

  if (filters.language !== null) {
    parts.push(sql`lower(postings.language) = ${filters.language.toLowerCase()}`);
  }

  if (filters.salaryMinUsd !== null) {
    parts.push(
      sql`coalesce(postings.salary_max_usd, postings.salary_min_usd, 0) >= ${filters.salaryMinUsd}`,
    );
  }

  if (filters.salaryMaxUsd !== null) {
    parts.push(
      sql`coalesce(postings.salary_min_usd, postings.salary_max_usd, 0) > 0
        and coalesce(postings.salary_min_usd, postings.salary_max_usd) <= ${filters.salaryMaxUsd}`,
    );
  }

  if (filters.postedWithinMs !== null) {
    parts.push(
      sql`postings.posted_at is not null and postings.posted_at >= ${nowMs - filters.postedWithinMs}`,
    );
  }

  if (filters.location !== null) {
    parts.push(resolvedLocationCondition(db, filters.location, { radiusKm: filters.radiusKm }));
  }

  return parts;
}

function postedWithinMs(value: string | null) {
  if (value === null) {
    return null;
  }

  return POSTED_WITHIN.get(value) ?? null;
}

function ftsHasRows(db: CatalogDatabase) {
  return db.all<{ one: number }>(sql`select 1 as one from postings_fts limit 1`).length > 0;
}

function likeExpression(text: string) {
  const tokens = text
    .replaceAll('"', " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => `%${token.toLowerCase()}%`);

  if (tokens.length === 0) {
    return null;
  }

  return sql.join(
    tokens.map(
      (token) => sql`(
        lower(postings.title) like ${token}
        or lower(c.name) like ${token}
        or lower(coalesce(postings.department, '')) like ${token}
        or lower(coalesce(postings.location_raw, '')) like ${token}
      )`,
    ),
    sql` and `,
  );
}

function roleWeight(value: string | null) {
  if (value === null) {
    return { column: sql`0 as tagWeight`, order: sql`rank, id` };
  }

  return {
    column: sql`(select max(coalesce(pt.weight, 0)) from posting_tags pt
      where pt.posting_id = postings.id
        and pt.dimension in ('role', 'subrole', 'granular_role')
        and pt.value in (${sql.join(
          roleFilterTagValues(value).map((tag) => sql`${tag}`),
          sql`, `,
        )})) as tagWeight`,
    order: sql`tagWeight desc, rank, id`,
  };
}

/**
 * Runs one catalog search. The keyword half reads the contentless `postings_fts` index through `bm25()`;
 * when that index is empty (a bare test fixture) the same query falls back to an indexed LIKE over the
 * posting columns, so a search never silently returns nothing.
 * @param db The catalog database.
 * @param query The validated search text, filters and limit.
 * @returns The matching postings, best rank first, primary-label matches ahead of secondary labels.
 */
export function searchPostings(db: CatalogDatabase, query: SearchQuery) {
  const match = ftsMatchExpression(query.text);

  if (match === null) {
    return [];
  }

  const { nowMs } = query;
  const openFilter = query.openOnly ? sql`and postings.closed_at is null` : sql``;
  const filters = filterConditions(db, query.filters, nowMs);
  const filterFilter = filters.length === 0 ? sql`` : sql`and ${sql.join(filters, sql` and `)}`;
  const useFts = ftsHasRows(db);
  const weight = roleWeight(query.filters.granularRole ?? query.filters.role);

  if (useFts) {
    return db.all<SearchHitRow>(sql`
      select id, title, company, location, department, url, applyUrl, ats, closedAt, postedAt, rank,
        tagWeight
      from (
        select postings.id, postings.title, c.name as company,
          postings.location_raw as location, postings.department, postings.url,
          coalesce(postings.apply_url, postings.apply_url_norm) as applyUrl, postings.ats,
          postings.closed_at as closedAt, postings.posted_at as postedAt, f.rank as rank,
          ${weight.column},
          row_number() over (
            partition by postings.dedupe_key
            order by postings.closed_at is not null, postings.first_seen_at, postings.id
          ) as rn
        from postings
        join companies c on c.id = postings.company_id
        join postings_fts f on f.rowid = postings.rowid
        where postings_fts match ${match} ${openFilter} ${filterFilter}
      )
      where rn = 1
      order by ${weight.order}
      limit ${query.limit}
    `);
  }

  const like = likeExpression(query.text);

  if (like === null) {
    return [];
  }

  return db.all<SearchHitRow>(sql`
    select id, title, company, location, department, url, applyUrl, ats, closedAt, postedAt, rank,
      tagWeight
    from (
      select postings.id, postings.title, c.name as company,
        postings.location_raw as location, postings.department, postings.url,
        coalesce(postings.apply_url, postings.apply_url_norm) as applyUrl, postings.ats,
        postings.closed_at as closedAt, postings.posted_at as postedAt, 0 as rank,
        ${weight.column},
        row_number() over (
          partition by postings.dedupe_key
          order by postings.closed_at is not null, postings.first_seen_at, postings.id
        ) as rn
      from postings
      join companies c on c.id = postings.company_id
      where ${like} ${openFilter} ${filterFilter}
    )
    where rn = 1
    order by ${weight.order}
    limit ${query.limit}
  `);
}

export { postedWithinMs };
