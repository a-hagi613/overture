import { afterEach, describe, expect, test } from "bun:test";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { CatalogDatabase } from "../platform/db/client.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { countMatchingPostings } from "./targets.ts";

const NOW = 1_800_000_000_000;

const CITIES = [
  { city: "Berlin", country: "DE", region: "Berlin" },
  { city: "Lisbon", country: "PT", region: "Lisboa" },
  { city: "Toronto", country: "CA", region: "Ontario" },
  { city: "Austin", country: "US", region: "Texas" },
] as const;

const ROLE_TAGS = ["Backend Engineer", "Product Designer"] as const;
const SENIORITY_TAGS = ["entry", "mid", "senior"] as const;
const WORKPLACES = ["remote", "hybrid", "onsite"] as const;
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract"] as const;

const POSTING_INSERT = `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm,
  title, title_norm, location_raw, country_code, region, city, language, workplace, employment_type,
  salary_min_minor, salary_currency, first_seen_at, last_seen_at, closed_at, dedupe_key)
  VALUES (?, 'board', 'company', 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const TAG_INSERT =
  "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, ?, ?, 'rules')";

const scratchDirectories: string[] = [];
const handles: Database[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }

  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function postingValues(index: number) {
  const place = CITIES[index % CITIES.length] ?? CITIES[0];
  const role = ROLE_TAGS[index % ROLE_TAGS.length] ?? ROLE_TAGS[0];
  const seniority = SENIORITY_TAGS[index % SENIORITY_TAGS.length] ?? SENIORITY_TAGS[0];
  const workplace = WORKPLACES[index % WORKPLACES.length] ?? WORKPLACES[0];

  const employmentType =
    EMPLOYMENT_TYPES[Math.floor(index / 6) % EMPLOYMENT_TYPES.length] ?? EMPLOYMENT_TYPES[0];

  const language = index % 4 === 0 ? "de" : "en";
  const id = `p${String(index)}`;
  let salaryMinMinor: number | null = null;

  if (index % 6 === 2) {
    salaryMinMinor = 9_000_000;
  } else if (index % 6 === 0) {
    salaryMinMinor = 3_000_000;
  }

  return {
    id,
    role,
    seniority,
    values: [
      id,
      id,
      `https://example.test/${id}`,
      `https://example.test/${id}`,
      `Job ${String(index)}`,
      role,
      `${place.city}, ${place.country}`,
      place.country,
      place.region,
      place.city,
      language,
      workplace,
      employmentType,
      salaryMinMinor,
      salaryMinMinor === null ? null : "USD",
      NOW,
      NOW,
      index % 7 === 0 ? NOW : null,
      id,
    ],
  };
}

function insertPosting(sqlite: Database, index: number) {
  const posting = postingValues(index);

  sqlite.prepare(POSTING_INSERT).run(...posting.values);
  sqlite.prepare(TAG_INSERT).run(posting.id, "role", posting.role);
  sqlite.prepare(TAG_INSERT).run(posting.id, "seniority", posting.seniority);

  if (index % 5 === 0) {
    sqlite.prepare(TAG_INSERT).run(posting.id, "subrole", "Platform");
  }
}

interface LoggedQuery {
  query: string;
  params: readonly unknown[];
}

interface Fixture {
  db: CatalogDatabase;
  path: string;
  queries: LoggedQuery[];
  sqlite: Database;
}

function seed(sqlite: Database, count: number) {
  sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('company', 'Co', 'co', 1)",
  );
  sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('board', 'company', 'greenhouse', 'token', 'us', 'active', 'import', 1)",
  );
  sqlite.run("BEGIN");

  for (let index = 0; index < count; index += 1) {
    insertPosting(sqlite, index);
  }

  sqlite.run("COMMIT");
  sqlite.run("ANALYZE");
}

function fixture(count = 240) {
  const directory = mkdtempSync(join(tmpdir(), "targets-cache-"));

  scratchDirectories.push(directory);

  const path = join(directory, "catalog.sqlite");
  const queries: LoggedQuery[] = [];

  const { db, sqlite } = openCatalogDatabase(path, {
    logger: { logQuery: (query, params) => queries.push({ params, query }) },
  });

  handles.push(sqlite);
  migrateCatalogDatabase(db, "drizzle-catalog");
  seed(sqlite, count);

  queries.length = 0;

  return { db, path, queries, sqlite } satisfies Fixture;
}

async function nextTurn() {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function countQueries(queries: readonly LoggedQuery[]) {
  return queries.filter((entry) => entry.query.includes("count(*)")).length;
}

type FilterInput = Parameters<typeof countMatchingPostings>[1];

function countFresh(target: Fixture, input: FilterInput, languages: string[]) {
  const { db, sqlite } = openCatalogDatabase(target.path);

  try {
    return countMatchingPostings(db, input, languages);
  } finally {
    sqlite.close();
  }
}

function filter(overrides: Partial<FilterInput> = {}) {
  return {
    roles: ["backend", "designer"],
    seniorities: [...SENIORITY_TAGS],
    workplaces: [...WORKPLACES],
    locations: CITIES.map((place) => place.city),
    employmentTypes: [...EMPLOYMENT_TYPES],
    salaryFloorMinor: null,
    salaryCurrency: null,
    ...overrides,
  } satisfies FilterInput;
}

const bindingsSchema = z.array(
  z.union([z.string(), z.number(), z.bigint(), z.boolean(), z.null(), z.instanceof(Uint8Array)]),
);

function queryPlan(target: Fixture, logged: LoggedQuery) {
  const params = bindingsSchema.parse(logged.params);

  return target.sqlite
    .query<{ detail: string }, SQLQueryBindings[]>(`EXPLAIN QUERY PLAN ${logged.query}`)
    .all(...params)
    .map((row) => row.detail);
}

describe("countMatchingPostings", () => {
  test("counts the open Postings the filters name", () => {
    const target = fixture(12);

    expect(countMatchingPostings(target.db, filter(), ["en", "de"])).toBe(10);
    expect(countMatchingPostings(target.db, filter(), ["en"])).toBe(8);
    expect(countMatchingPostings(target.db, filter({ roles: ["backend"] }), ["en", "de"])).toBe(5);
    expect(
      countMatchingPostings(
        target.db,
        filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "USD" }),
        ["en", "de"],
      ),
    ).toBe(9);
    expect(
      countMatchingPostings(
        target.db,
        filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "EUR" }),
        ["en", "de"],
      ),
    ).toBe(10);
    expect(countMatchingPostings(target.db, filter({ locations: ["Berlin"] }), ["de"])).toBe(2);
    expect(countMatchingPostings(target.db, filter({ locations: ["Germany"] }), ["de"])).toBe(2);
  });

  test("returns 0 for an empty filter or language list", () => {
    const target = fixture(12);

    expect(countMatchingPostings(target.db, filter({ roles: [] }), ["en"])).toBe(0);
    expect(countMatchingPostings(target.db, filter({ locations: [] }), ["en"])).toBe(0);
    expect(countMatchingPostings(target.db, filter(), [])).toBe(0);
  });

  test("answers exactly as an uncached handle across diverse filters", () => {
    const target = fixture();

    const cases: { input: ReturnType<typeof filter>; languages: string[] }[] = [
      { input: filter(), languages: ["en", "de"] },
      { input: filter(), languages: ["en"] },
      { input: filter(), languages: ["de"] },
      { input: filter({ roles: ["backend"] }), languages: ["en"] },
      { input: filter({ roles: ["designer", "backend"] }), languages: ["en", "de"] },
      { input: filter({ roles: ["platform"] }), languages: ["en", "de"] },
      { input: filter({ seniorities: ["senior"] }), languages: ["en", "de"] },
      { input: filter({ workplaces: ["remote"] }), languages: ["en", "de"] },
      { input: filter({ workplaces: ["hybrid", "onsite"] }), languages: ["en", "de"] },
      { input: filter({ employmentTypes: ["part_time"] }), languages: ["en", "de"] },
      { input: filter({ locations: ["Berlin"] }), languages: ["en", "de"] },
      { input: filter({ locations: ["Berlin", "Lisbon"] }), languages: ["en"] },
      { input: filter({ locations: ["Germany", "Portugal"] }), languages: ["de"] },
      { input: filter({ locations: ["Nowhere"] }), languages: ["en", "de"] },
      { input: filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "USD" }), languages: ["en"] },
      { input: filter({ salaryFloorMinor: 20_000_000, salaryCurrency: "USD" }), languages: ["en"] },
      { input: filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "EUR" }), languages: ["de"] },
    ];

    for (const { input, languages } of cases) {
      const uncached = countFresh(target, input, languages);

      expect(countMatchingPostings(target.db, input, languages)).toBe(uncached);
      expect(countMatchingPostings(target.db, input, languages)).toBe(uncached);
    }
  });

  test("shares one entry for filters that differ only in order, case or duplicates", () => {
    const target = fixture(12);
    const base = filter();

    expect(countMatchingPostings(target.db, base, ["en", "de"])).toBe(10);
    const afterFirst = target.queries.length;

    expect(
      countMatchingPostings(
        target.db,
        {
          ...base,
          roles: ["Designer", "BACKEND"],
          seniorities: ["senior", "entry", "mid", "mid"],
          workplaces: ["onsite", "remote", "hybrid", "remote"],
          locations: ["berlin", "LISBON", "toronto", "austin"],
          employmentTypes: ["contract", "full_time", "part_time", "full_time"],
        },
        ["DE", " en ", "en"],
      ),
    ).toBe(10);
    expect(target.queries.length).toBe(afterFirst);
  });

  test("serves a repeated identical request from the cache", () => {
    const target = fixture(12);
    const input = filter();

    countMatchingPostings(target.db, input, ["en", "de"]);
    const afterFirst = target.queries.length;

    expect(countQueries(target.queries)).toBe(1);
    expect(countMatchingPostings(target.db, input, ["en", "de"])).toBe(10);
    expect(target.queries.length).toBe(afterFirst);
  });

  test("invalidates when this connection inserts, closes or updates a Posting", () => {
    const target = fixture(12);
    const input = filter();
    const initial = countMatchingPostings(target.db, input, ["en", "de"]);

    insertPosting(target.sqlite, 9999);
    const afterInsert = countMatchingPostings(target.db, input, ["en", "de"]);

    expect(afterInsert).toBe(initial + 1);

    target.sqlite.run("UPDATE postings SET closed_at = ? WHERE id = 'p2'", [NOW]);
    const afterClose = countMatchingPostings(target.db, input, ["en", "de"]);

    expect(afterClose).toBe(afterInsert - 1);

    target.sqlite.run("UPDATE postings SET last_seen_at = last_seen_at + 1 WHERE id = 'p3'");
    expect(countMatchingPostings(target.db, input, ["en", "de"])).toBe(afterClose);
    expect(countQueries(target.queries)).toBe(4);
  });

  test("invalidates when the sweep worker's separate connection writes", () => {
    const target = fixture(12);
    const input = filter();
    const initial = countMatchingPostings(target.db, input, ["en", "de"]);

    expect(countMatchingPostings(target.db, input, ["en", "de"])).toBe(initial);

    const worker = openCatalogDatabase(target.path);

    handles.push(worker.sqlite);

    try {
      insertPosting(worker.sqlite, 9998);
    } finally {
      worker.sqlite.close();
    }

    expect(countMatchingPostings(target.db, input, ["en", "de"])).toBe(initial + 1);
  });

  test("keeps the store bounded, so an old entry is recomputed", () => {
    const target = fixture(60);

    for (let index = 0; index < 600; index += 1) {
      countMatchingPostings(target.db, filter({ roles: [`word${String(index)}`] }), ["en"]);
    }

    const before = target.queries.length;

    countMatchingPostings(target.db, filter({ roles: ["word0"] }), ["en"]);
    expect(target.queries.length).toBeGreaterThan(before);
  });

  test("plans the count through indexes, never a posting_tags scan or temporary b-tree", () => {
    const target = fixture(400);
    const input = filter({ locations: ["Berlin", "Lisbon"] });

    countMatchingPostings(target.db, input, ["en"]);
    target.queries.length = 0;
    countMatchingPostings(target.db, filter({ locations: ["Austin"] }), ["de"]);

    const roleQuery = target.queries.find((entry) => entry.query.includes("select distinct"));
    const countQuery = target.queries.find((entry) => entry.query.includes("count(*)"));

    if (roleQuery === undefined || countQuery === undefined) {
      throw new Error("the count and its role-tag lookup both ran");
    }

    const rolePlan = queryPlan(target, roleQuery).join("\n");
    const countPlan = queryPlan(target, countQuery).join("\n");

    expect(rolePlan).toContain("posting_tags_dimension_value");
    expect(rolePlan).not.toMatch(/SCAN posting_tags/u);
    expect(countPlan).not.toMatch(/SCAN posting_tags/u);
    expect(countPlan).not.toContain("TEMP B-TREE");
    expect(countPlan.match(/SEARCH posting_tags/gu)).toHaveLength(2);
    expect(countPlan.match(/SCAN postings/gu)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test("answers 25 concurrent filter changes under 500ms p95 during catalog writes", async () => {
    const target = fixture(1200);
    const worker = openCatalogDatabase(target.path);

    handles.push(worker.sqlite);

    const inputs = [
      filter({ roles: ["backend"] }),
      filter({ roles: ["designer"] }),
      filter({ locations: ["Berlin"] }),
      filter({ locations: ["Lisbon"] }),
      filter({ locations: ["Toronto"] }),
      filter({ locations: ["Austin"] }),
      filter({ locations: ["Germany"] }),
      filter({ locations: ["Portugal"] }),
      filter({ workplaces: ["remote"] }),
      filter({ workplaces: ["hybrid"] }),
      filter({ workplaces: ["onsite"] }),
      filter({ seniorities: ["entry"] }),
      filter({ seniorities: ["mid"] }),
      filter({ seniorities: ["senior"] }),
      filter({ employmentTypes: ["full_time"] }),
      filter({ employmentTypes: ["part_time"] }),
      filter({ employmentTypes: ["contract"] }),
      filter({ locations: ["Berlin", "Lisbon"], workplaces: ["remote"] }),
      filter({ locations: ["Toronto", "Austin"], workplaces: ["hybrid"] }),
      filter({ roles: ["backend"], seniorities: ["senior"] }),
      filter({ roles: ["designer"], workplaces: ["hybrid"] }),
      filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "USD" }),
      filter({ salaryFloorMinor: 5_000_000, salaryCurrency: "EUR" }),
      filter({ salaryFloorMinor: 20_000_000, salaryCurrency: "USD" }),
      filter({ roles: ["platform"], workplaces: ["onsite"] }),
    ].slice(0, 25);

    const durations: number[] = [];

    const tasks = inputs.flatMap((input, index) => [
      (async () => {
        await nextTurn();

        const started = performance.now();

        countMatchingPostings(target.db, input, ["en", "de"]);
        durations.push(performance.now() - started);
      })(),
      (async () => {
        await nextTurn();
        insertPosting(worker.sqlite, 5000 + index);
      })(),
    ]);

    await Promise.all(tasks);

    const sorted = durations.toSorted((left, right) => left - right);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const slowest = sorted.at(-1) ?? 0;

    expect(durations).toHaveLength(25);
    expect(p95).toBeLessThan(500);
    expect(slowest).toBeLessThan(500);
  });
});
