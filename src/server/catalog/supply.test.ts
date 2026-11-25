import { afterEach, describe, expect, test } from "bun:test";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { CatalogDatabase } from "../platform/db/client.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { countSupplyLive, countSupportedSupply } from "./supply.ts";
import { rebuildSupplyFacets, supplyFacetTotals } from "./supply-facets.ts";

const NOW = 1_800_000_000_000;

const INSERT_POSTING = `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm,
  title, title_norm, location_raw, country_code, city, language, workplace, employment_type,
  first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
  VALUES (?, ?, 'company', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, 'full_time', ?, ?, ?, ?, ?, ?)`;

const INSERT_TAG =
  "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, ?, ?, 'rules')";

const bindingsSchema = z.array(
  z.union([z.string(), z.number(), z.bigint(), z.boolean(), z.null(), z.instanceof(Uint8Array)]),
);

const planSchema = z.object({ detail: z.string() });

interface PostingSeed {
  ats: "greenhouse" | "lever" | "smartrecruiters";
  applySupported: boolean;
  city: string | null;
  closed: boolean;
  countryCode: string;
  extraTags?: readonly { dimension: "role" | "granular_role"; value: string }[];
  granularRole?: string;
  id: string;
  locationRaw: string;
  role: string;
  subrole?: string;
  workplace: "hybrid" | "onsite" | "remote";
}

interface LoggedQuery {
  params: readonly unknown[];
  query: string;
}

interface Fixture {
  db: CatalogDatabase;
  path: string;
  queries: LoggedQuery[];
  sqlite: Database;
}

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

const SEEDS: readonly PostingSeed[] = [
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "gh-swe-remote-1",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "gh-swe-remote-2",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "lever",
    applySupported: true,
    city: "New York",
    closed: false,
    countryCode: "US",
    id: "lever-swe-remote-3",
    locationRaw: "New York, NY",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Toronto",
    closed: false,
    countryCode: "CA",
    id: "gh-swe-onsite-1",
    locationRaw: "Toronto, ON",
    role: "Software Engineering",
    workplace: "onsite",
  },
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Toronto",
    closed: false,
    countryCode: "CA",
    id: "gh-swe-onsite-2",
    locationRaw: "Toronto, ON",
    role: "Software Engineering",
    workplace: "onsite",
  },
  {
    ats: "lever",
    applySupported: true,
    city: "London",
    closed: false,
    countryCode: "GB",
    id: "lever-ops-remote-1",
    locationRaw: "London, United Kingdom",
    role: "Operations",
    workplace: "remote",
  },
  {
    ats: "lever",
    applySupported: true,
    city: "London",
    closed: false,
    countryCode: "GB",
    id: "lever-ops-remote-2",
    locationRaw: "London, United Kingdom",
    role: "Operations",
    workplace: "remote",
  },
  {
    ats: "lever",
    applySupported: true,
    city: "London",
    closed: false,
    countryCode: "GB",
    id: "lever-ops-hybrid-1",
    locationRaw: "London, United Kingdom",
    role: "Operations",
    workplace: "hybrid",
  },
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Berlin",
    closed: false,
    countryCode: "DE",
    id: "gh-ops-platform-1",
    locationRaw: "Berlin, Germany",
    role: "Operations",
    subrole: "Platform",
    workplace: "hybrid",
  },
  {
    ats: "smartrecruiters",
    applySupported: false,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "sr-unsupported-1",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "smartrecruiters",
    applySupported: false,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "sr-unsupported-2",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "smartrecruiters",
    applySupported: false,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "sr-unsupported-3",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "smartrecruiters",
    applySupported: false,
    city: "Austin",
    closed: false,
    countryCode: "US",
    id: "sr-unsupported-4",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "greenhouse",
    applySupported: true,
    city: "Austin",
    closed: true,
    countryCode: "US",
    id: "gh-closed-1",
    locationRaw: "Austin, TX",
    role: "Software Engineering",
    workplace: "remote",
  },
  {
    ats: "lever",
    applySupported: true,
    city: "New York",
    closed: true,
    countryCode: "US",
    id: "lever-closed-2",
    locationRaw: "New York, NY",
    role: "Software Engineering",
    workplace: "remote",
  },
];

const BOARDS = [
  { ats: "greenhouse", id: "board-gh" },
  { ats: "lever", id: "board-lever" },
  { ats: "smartrecruiters", id: "board-sr" },
] as const;

function boardFor(ats: PostingSeed["ats"]) {
  const board = BOARDS.find((candidate) => candidate.ats === ats);

  if (board === undefined) {
    throw new Error(`no board for ${ats}`);
  }

  return board;
}

function insertSeed(sqlite: Database, seed: PostingSeed) {
  const board = boardFor(seed.ats);

  sqlite
    .prepare(INSERT_POSTING)
    .run(
      seed.id,
      board.id,
      seed.ats,
      seed.id,
      `https://jobs.example/${seed.id}`,
      `https://jobs.example/${seed.id}`,
      `Role ${seed.id}`,
      "role",
      seed.locationRaw,
      seed.countryCode,
      seed.city,
      seed.workplace,
      NOW,
      NOW,
      seed.closed ? NOW : null,
      seed.closed ? "closed" : "open",
      seed.applySupported ? 1 : 0,
      seed.id,
    );
  sqlite.prepare(INSERT_TAG).run(seed.id, "role", seed.role);

  if (seed.granularRole !== undefined) {
    sqlite.prepare(INSERT_TAG).run(seed.id, "granular_role", seed.granularRole);
  }

  for (const tag of seed.extraTags ?? []) {
    sqlite.prepare(INSERT_TAG).run(seed.id, tag.dimension, tag.value);
  }

  if (seed.subrole !== undefined) {
    sqlite.prepare(INSERT_TAG).run(seed.id, "subrole", seed.subrole);
  }
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "supply-"));

  scratchDirectories.push(directory);

  const path = join(directory, "catalog.sqlite");
  const queries: LoggedQuery[] = [];

  const { db, sqlite } = openCatalogDatabase(path, {
    logger: { logQuery: (query, params) => queries.push({ params, query }) },
  });

  handles.push(sqlite);
  migrateCatalogDatabase(db, "drizzle-catalog");

  sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('company', 'Co', 'co', 1)",
  );

  for (const board of BOARDS) {
    sqlite
      .prepare(
        "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES (?, 'company', ?, ?, 'us', 'active', 'import', 1)",
      )
      .run(board.id, board.ats, board.id);
  }

  sqlite.run("BEGIN");

  for (const seed of SEEDS) {
    insertSeed(sqlite, seed);
  }

  sqlite.run("COMMIT");
  sqlite.run("ANALYZE");
  rebuildSupplyFacets(db);
  queries.length = 0;

  return { db, path, queries, sqlite };
}

function filter(overrides: Partial<SupplyFilters> = {}) {
  return {
    granularRole: null,
    location: null,
    radiusKm: null,
    remote: false,
    role: null,
    ...overrides,
  } satisfies SupplyFilters;
}

function countQueries(queries: readonly LoggedQuery[]) {
  const aggregates = queries.filter(
    (entry) => entry.query.includes("count(*)") || entry.query.includes("sum("),
  );

  return aggregates.length;
}

function queryPlan(target: Fixture, logged: LoggedQuery) {
  const params = bindingsSchema.parse(logged.params);

  return target.sqlite
    .query<{ detail: string }, SQLQueryBindings[]>(`EXPLAIN QUERY PLAN ${logged.query}`)
    .all(...params)
    .map((row) => planSchema.parse(row).detail);
}

describe("countSupportedSupply", () => {
  test("counts only open, apply-supported Postings", () => {
    const target = fixture();

    expect(countSupportedSupply(target.db, filter())).toEqual({
      byAts: [
        { ats: "greenhouse", count: 5 },
        { ats: "lever", count: 4 },
      ],
      total: 9,
    });
  });

  test("filters by role, including a subrole tag", () => {
    const target = fixture();

    expect(countSupportedSupply(target.db, filter({ role: "Software Engineering" })).total).toBe(5);
    expect(countSupportedSupply(target.db, filter({ role: "Operations" })).total).toBe(4);
    expect(countSupportedSupply(target.db, filter({ role: "Design" })).total).toBe(0);
  });

  test("filters by Level-1 category, Level-2 granular role and every label a multi-label Posting carries", () => {
    const target = fixture();

    insertSeed(target.sqlite, {
      ats: "greenhouse",
      applySupported: true,
      city: "Austin",
      closed: false,
      countryCode: "US",
      extraTags: [
        { dimension: "role", value: "Data & Analytics" },
        { dimension: "granular_role", value: "Data Scientist" },
      ],
      granularRole: "Software Engineer",
      id: "gh-hybrid-swe-data",
      locationRaw: "Austin, TX",
      role: "Software Engineering",
      workplace: "remote",
    });
    insertSeed(target.sqlite, {
      ats: "lever",
      applySupported: true,
      city: "London",
      closed: false,
      countryCode: "GB",
      id: "lever-legacy-backend",
      locationRaw: "London, United Kingdom",
      role: "Backend Engineer",
      workplace: "hybrid",
    });

    rebuildSupplyFacets(target.db);

    expect(countSupportedSupply(target.db, filter()).total).toBe(11);
    expect(countSupportedSupply(target.db, filter({ role: "Software Engineering" })).total).toBe(6);
    expect(countSupportedSupply(target.db, filter({ role: "Data & Analytics" })).total).toBe(1);
    expect(
      countSupportedSupply(target.db, filter({ granularRole: "Software Engineer" })).total,
    ).toBe(1);
    expect(countSupportedSupply(target.db, filter({ granularRole: "Data Scientist" })).total).toBe(
      1,
    );
    expect(
      countSupportedSupply(target.db, filter({ granularRole: "Backend Engineer" })).total,
    ).toBe(1);
    expect(
      countSupportedSupply(
        target.db,
        filter({ granularRole: "Software Engineer", role: "Data & Analytics" }),
      ).total,
    ).toBe(1);
    expect(
      countSupportedSupply(target.db, filter({ granularRole: "Registered Nurse" })).total,
    ).toBe(0);
  });

  test("reads a taxonomy id, a current name or a retired name on a catalog tagged with taxonomy ids", () => {
    const target = fixture();

    const nurse = (id: string, role: string, ats: PostingSeed["ats"]) => {
      insertSeed(target.sqlite, {
        ats,
        applySupported: true,
        city: "Houston",
        closed: false,
        countryCode: "US",
        granularRole: role,
        id,
        locationRaw: "Houston, TX",
        role: "healthcare",
        subrole: "healthcare/nursing",
        workplace: "onsite",
      });
    };

    nurse("rn-1", "health.rn", "greenhouse");
    nurse("rn-2", "health.rn", "lever");
    nurse("np-1", "health.np", "greenhouse");

    const live = (overrides: Partial<SupplyFilters>) =>
      countSupplyLive(target.db, filter(overrides)).total;

    const counted = (overrides: Partial<SupplyFilters>) =>
      countSupportedSupply(target.db, filter(overrides)).total;

    for (const read of [live, counted]) {
      expect(read({ role: "healthcare" })).toBe(3);
      expect(read({ role: "Healthcare" })).toBe(3);
      expect(read({ granularRole: "healthcare/nursing" })).toBe(3);
      expect(read({ granularRole: "health.rn" })).toBe(2);
      expect(read({ granularRole: "Registered Nurse" })).toBe(2);
      expect(read({ granularRole: "Nurse Practitioner / Anesthetist / Midwife" })).toBe(1);
      expect(read({ granularRole: "health.rn", role: "software-it" })).toBe(2);
    }

    rebuildSupplyFacets(target.db);

    expect(supplyFacetTotals(target.db, filter({ granularRole: "Registered Nurse" }))?.total).toBe(
      2,
    );
    expect(counted({ role: "Healthcare" })).toBe(3);
    expect(counted({ granularRole: "health.rn" })).toBe(2);
  });

  test("filters by location, remote, and both together", () => {
    const target = fixture();

    expect(countSupportedSupply(target.db, filter({ location: "London" })).total).toBe(3);
    expect(countSupportedSupply(target.db, filter({ location: "United Kingdom" })).total).toBe(3);
    expect(countSupportedSupply(target.db, filter({ location: "United States" })).total).toBe(3);
    expect(countSupportedSupply(target.db, filter({ location: "Toronto" })).total).toBe(2);
    expect(countSupportedSupply(target.db, filter({ remote: true })).total).toBe(5);
    expect(
      countSupportedSupply(target.db, filter({ remote: true, role: "Software Engineering" })).total,
    ).toBe(3);
    expect(
      countSupportedSupply(target.db, filter({ location: "Berlin", remote: true })).total,
    ).toBe(0);
    expect(countSupportedSupply(target.db, filter({ location: "Nowhere" })).total).toBe(0);
  });

  test("serves a repeated identical request from the cache", () => {
    const target = fixture();

    countSupportedSupply(target.db, filter({ role: "Software Engineering" }));
    expect(countQueries(target.queries)).toBe(1);

    const afterFirst = target.queries.length;

    expect(countSupportedSupply(target.db, filter({ role: "Software Engineering" })).total).toBe(5);
    expect(target.queries.length).toBe(afterFirst);
  });

  test("invalidates when this connection writes and when the sweep's connection writes", () => {
    const target = fixture();

    expect(countSupportedSupply(target.db, filter()).total).toBe(9);

    insertSeed(target.sqlite, {
      ats: "lever",
      applySupported: true,
      city: "Austin",
      closed: false,
      countryCode: "US",
      id: "lever-new-1",
      locationRaw: "Austin, TX",
      role: "Software Engineering",
      workplace: "remote",
    });
    rebuildSupplyFacets(target.db);

    expect(countSupportedSupply(target.db, filter()).total).toBe(10);

    const worker = openCatalogDatabase(target.path);

    handles.push(worker.sqlite);

    try {
      insertSeed(worker.sqlite, {
        ats: "greenhouse",
        applySupported: true,
        city: "Austin",
        closed: false,
        countryCode: "US",
        id: "gh-worker-1",
        locationRaw: "Austin, TX",
        role: "Software Engineering",
        workplace: "remote",
      });
    } finally {
      worker.sqlite.close();
    }

    rebuildSupplyFacets(target.db);

    expect(countSupportedSupply(target.db, filter()).total).toBe(11);
  });

  test("keeps the cache bounded, so the oldest entry is recomputed", () => {
    const target = fixture();

    for (let index = 0; index < 320; index += 1) {
      countSupportedSupply(target.db, filter({ location: `Place ${String(index)}` }));
    }

    const before = target.queries.length;

    countSupportedSupply(target.db, filter({ location: "Place 0" }));
    expect(target.queries.length).toBeGreaterThan(before);
    expect(countSupportedSupply(target.db, filter({ role: "Software Engineering" })).total).toBe(5);
  });

  test("plans the live city count through a covering supply index and no posting_tags scan", () => {
    const target = fixture();

    countSupportedSupply(
      target.db,
      filter({ location: "Austin", remote: true, role: "Software Engineering" }),
    );

    const countQuery = target.queries.find((entry) => entry.query.includes("count(*)"));

    if (countQuery === undefined) {
      throw new Error("the grouped count ran");
    }

    const plan = queryPlan(target, countQuery).join("\n");

    expect(plan).toContain("postings_supply_");
    expect(plan).not.toMatch(/SCAN postings\b/u);
    expect(plan).not.toMatch(/SCAN posting_tags/u);
    expect(plan).toMatch(/SEARCH posting_tags/u);
  });

  test("counts a large catalog in a few milliseconds", () => {
    const target = fixture();
    const rows = 5000;

    target.sqlite.run("BEGIN");

    for (let index = 0; index < rows; index += 1) {
      insertSeed(target.sqlite, {
        ats: index % 2 === 0 ? "greenhouse" : "lever",
        applySupported: true,
        city: "Austin",
        closed: index % 10 === 0,
        countryCode: "US",
        id: `bulk-${String(index)}`,
        locationRaw: "Austin, TX",
        role: index % 3 === 0 ? "Software Engineering" : "Operations",
        workplace: index % 2 === 0 ? "remote" : "hybrid",
      });
    }

    target.sqlite.run("COMMIT");
    target.sqlite.run("ANALYZE");
    rebuildSupplyFacets(target.db);

    const filters = filter({ remote: true, role: "Software Engineering" });
    const started = performance.now();

    const totals = countSupportedSupply(target.db, filters);
    const durationMs = performance.now() - started;

    expect(totals.total).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(250);

    const cachedStart = performance.now();

    countSupportedSupply(target.db, filters);

    expect(performance.now() - cachedStart).toBeLessThan(10);
  });
});
