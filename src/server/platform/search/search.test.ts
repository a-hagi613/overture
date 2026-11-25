import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import type { CatalogDatabase } from "../db/client.ts";
import type { SearchFilters } from "./search.ts";

import { sql } from "drizzle-orm";

import { openCatalogDatabase } from "../db/client.ts";
import { migrateCatalogDatabase } from "../db/migrate.ts";
import { rebuildPostingLocations, seedGeoPlaces } from "../../catalog/geo-store.ts";
import { searchPostings } from "./search.ts";

const NOW = 1_800_000_000_000;

const scratch: { db: CatalogDatabase; sqlite: Database }[] = [];

afterEach(() => {
  for (const { sqlite } of scratch.splice(0)) {
    sqlite.close();
  }
});

function noFilters(overrides: Partial<SearchFilters> = {}) {
  const filters: SearchFilters = {
    role: null,
    granularRole: null,
    seniority: null,
    workplace: null,
    location: null,
    radiusKm: null,
    employmentType: null,
    language: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    postedWithinMs: null,
    ...overrides,
  };

  return filters;
}

interface PostingSeed {
  id: string;
  title: string;
  department?: string | null;
  locationRaw?: string | null;
  workplace?: "remote" | "hybrid" | "onsite" | "unknown";
  language?: string;
  postedAt?: number;
  salaryMinUsd?: number | null;
  salaryMaxUsd?: number | null;
}

function fixture(rows: readonly PostingSeed[]) {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(db, "drizzle-catalog");
  seedGeoPlaces(db, { only: ["Toronto", "Berlin"] });

  sqlite.run(
    "insert into companies (id, name, name_norm, created_at) values ('company', 'Northwind Systems', 'northwind systems', 1)",
  );
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values ('board', 'company', 'greenhouse', 'northwind', 'us', 'active', 'v1_seed', 1)",
  );

  const insert = sqlite.prepare(
    `insert into postings
      (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
       department, location_raw, workplace, language, employment_type, posted_at,
       salary_min_usd, salary_max_usd, first_seen_at, last_seen_at, closed_at, status,
       apply_supported, dedupe_key)
     values (?, 'board', 'company', 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'full_time', ?,
       ?, ?, ?, ?, null, 'open', 1, ?)`,
  );

  for (const row of rows) {
    insert.run(
      row.id,
      row.id,
      `https://jobs.example/${row.id}`,
      `https://jobs.example/${row.id}`,
      row.title,
      row.title.toLowerCase(),
      row.department ?? null,
      row.locationRaw ?? null,
      row.workplace ?? "onsite",
      row.language ?? "en",
      row.postedAt ?? NOW,
      row.salaryMinUsd ?? null,
      row.salaryMaxUsd ?? null,
      NOW,
      NOW,
      row.id,
    );
  }

  const handle = { db, sqlite };

  rebuildPostingLocations(db);

  scratch.push(handle);

  return handle;
}

const SEARCH_ROWS: readonly PostingSeed[] = [
  { id: "backend", title: "Backend Engineer", locationRaw: "Toronto, ON, Canada" },
  {
    id: "senior-backend",
    title: "Senior Backend Engineer",
    locationRaw: "Toronto, ON, Canada",
    salaryMinUsd: 160_000,
    salaryMaxUsd: 190_000,
  },
  {
    id: "product",
    title: "Product Manager",
    department: "Product",
    locationRaw: "Berlin, Germany",
    language: "de",
    postedAt: NOW - 40 * 86_400_000,
  },
  {
    id: "remote-backend",
    title: "Backend Developer",
    locationRaw: "Remote - Canada",
    workplace: "remote",
    salaryMinUsd: 120_000,
  },
];

describe("searchPostings on the contentless FTS index", () => {
  test("ranks title matches with bm25 and returns them", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: "Backend",
      openOnly: true,
      limit: 10,
      filters: noFilters(),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id).toSorted()).toEqual([
      "backend",
      "remote-backend",
      "senior-backend",
    ]);
    expect(hits.every((hit) => hit.rank <= 0)).toBe(true);
    expect(hits[0]?.rank).toBeLessThanOrEqual(hits.at(-1)?.rank ?? 0);
  });

  test("a quoted phrase stays a phrase", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: '"Backend Engineer"',
      openOnly: true,
      limit: 10,
      filters: noFilters(),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id).toSorted()).toEqual(["backend", "senior-backend"]);
  });

  test("the index stores no duplicated text because it is contentless", () => {
    const { db } = fixture(SEARCH_ROWS);

    const rows = db.all<{ title: string | null }>(
      sql`select title from postings_fts where postings_fts match 'Backend' limit 1`,
    );

    expect(rows.at(0)?.title).toBeNull();
  });

  test("an empty FTS index falls back to the LIKE search", () => {
    const { db, sqlite } = fixture(SEARCH_ROWS);

    sqlite.run("delete from postings_fts");

    const hits = searchPostings(db, {
      text: "Backend",
      openOnly: true,
      limit: 10,
      filters: noFilters(),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id).toSorted()).toEqual([
      "backend",
      "remote-backend",
      "senior-backend",
    ]);
  });
});

describe("search filters", () => {
  test("matches a Level-1 category and a Level-2 granular role across multi-label Postings, primary label first", () => {
    const target = fixture([
      { id: "primary-swe", title: "Backend Engineer" },
      { id: "hybrid-role", title: "Backend Engineer" },
    ]);

    const tag = target.sqlite.prepare(
      "insert into posting_tags (posting_id, dimension, value, source, weight) values (?, ?, ?, 'rules', ?)",
    );

    tag.run("primary-swe", "role", "Software Engineering", 1);
    tag.run("primary-swe", "granular_role", "Backend Engineer", 1);
    tag.run("hybrid-role", "role", "Data & Analytics", 1);
    tag.run("hybrid-role", "granular_role", "Data Scientist", 1);
    tag.run("hybrid-role", "role", "Software Engineering", 0.4);
    tag.run("hybrid-role", "granular_role", "Backend Engineer", 0.4);

    const byCategory = searchPostings(target.db, {
      filters: noFilters({ role: "Software Engineering" }),
      limit: 10,
      nowMs: NOW,
      openOnly: true,
      text: "Backend",
    });

    const byGranular = searchPostings(target.db, {
      filters: noFilters({ granularRole: "Backend Engineer", role: "Software Engineering" }),
      limit: 10,
      nowMs: NOW,
      openOnly: true,
      text: "Backend",
    });

    expect(byCategory.map((hit) => hit.id)).toEqual(["primary-swe", "hybrid-role"]);
    expect(byGranular.map((hit) => hit.id)).toEqual(["primary-swe", "hybrid-role"]);
    expect(
      searchPostings(target.db, {
        filters: noFilters({ granularRole: "Data Scientist" }),
        limit: 10,
        nowMs: NOW,
        openOnly: true,
        text: "Backend",
      }).map((hit) => hit.id),
    ).toEqual(["hybrid-role"]);
  });

  test("reads a taxonomy id or a retired name on a catalog tagged with taxonomy ids, higher weight first", () => {
    const target = fixture([
      { id: "labelled", title: "Backend Engineer" },
      { id: "bridged", title: "Backend Engineer" },
      { id: "nurse", title: "Backend Nurse Educator" },
    ]);

    const tag = target.sqlite.prepare(
      "insert into posting_tags (posting_id, dimension, value, source, weight) values (?, ?, ?, 'llm', ?)",
    );

    tag.run("labelled", "role", "software-it", 1);
    tag.run("labelled", "granular_role", "sw.backend", 1);
    tag.run("bridged", "role", "software-it", 0.5);
    tag.run("bridged", "granular_role", "sw.backend", 0.5);
    tag.run("nurse", "role", "healthcare", 1);

    const ids = (filters: Partial<SearchFilters>) =>
      searchPostings(target.db, {
        filters: noFilters(filters),
        limit: 10,
        nowMs: NOW,
        openOnly: true,
        text: "Backend",
      }).map((hit) => hit.id);

    expect(ids({ granularRole: "sw.backend" })).toEqual(["labelled", "bridged"]);
    expect(ids({ granularRole: "Backend Engineer" })).toEqual(["labelled", "bridged"]);
    expect(ids({ role: "Software Engineering" })).toEqual(["labelled", "bridged"]);
    expect(ids({ role: "healthcare" })).toEqual(["nurse"]);
  });

  test("the location filter routes a city through posting_locations", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: "Backend",
      openOnly: true,
      limit: 10,
      filters: noFilters({ location: "Toronto" }),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id).toSorted()).toEqual(["backend", "senior-backend"]);
  });

  test("the USD salary floor filters on the normalized column", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: "Backend",
      openOnly: true,
      limit: 10,
      filters: noFilters({ salaryMinUsd: 150_000 }),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id)).toEqual(["senior-backend"]);
  });

  test("the posted-age filter keeps only fresh rows", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: "Manager",
      openOnly: true,
      limit: 10,
      filters: noFilters({ postedWithinMs: 7 * 86_400_000 }),
      nowMs: NOW,
    });

    expect(hits).toHaveLength(0);
  });

  test("the language filter narrows to the stored language", () => {
    const { db } = fixture(SEARCH_ROWS);

    const hits = searchPostings(db, {
      text: "Manager",
      openOnly: true,
      limit: 10,
      filters: noFilters({ language: "de" }),
      nowMs: NOW,
    });

    expect(hits.map((hit) => hit.id)).toEqual(["product"]);
  });
});
