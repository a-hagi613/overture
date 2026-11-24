import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import type { RoleGroup } from "../../shared/tag-taxonomy.ts";
import type { SupplyFilters } from "../../shared/supply.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { countSupplyLive, countSupportedSupply } from "./supply.ts";
import { ANY_ROLE_FACET, rebuildSupplyFacets, supplyFacetTotals } from "./supply-facets.ts";

const NOW = 1_800_000_000_000;

const ROLES: readonly RoleGroup[] = [
  "Software Engineering",
  "Operations",
  "Design",
  "Sales",
  "Finance",
];

const COUNTRIES = ["US", "US", "GB", "DE", "CA", null] as const;

const REGIONS = [
  "Texas",
  "TX",
  "England",
  "ENG",
  "Bavaria",
  "Ontario",
  "California",
  null,
] as const;

const CITIES = ["Austin", "London", "Berlin", "Toronto", null] as const;
const WORKPLACES = ["remote", "hybrid", "onsite", "unknown"] as const;
const SUB_ROLES = ["Platform", "Core", "Growth", "Infrastructure"] as const;

const PLACES = [
  null,
  "United States",
  "Texas, USA",
  "United Kingdom",
  "England",
  "Germany",
  "California",
  "Austin",
  "Berlin",
  "Nowhere",
] as const;

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

const INSERT_POSTING = `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url,
  apply_url_norm, title, title_norm, location_raw, country_code, region, city, language, workplace,
  employment_type, first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
  VALUES (?, ?, 'company', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, 'full_time', ?, ?, ?, ?, ?, ?)`;

interface Seed {
  ats: "ashby" | "greenhouse" | "lever" | "workable";
  applySupported: boolean;
  city: string | null;
  closed: boolean;
  countryCode: string | null;
  id: string;
  region: string | null;
  role: RoleGroup | null;
  subrole: string | null;
  workplace: "hybrid" | "onsite" | "remote" | "unknown";
}

function randomSource(seed: number) {
  let state = seed % 2_147_483_647;

  if (state <= 0) {
    state += 2_147_483_646;
  }

  return () => {
    state = (state * 16_807) % 2_147_483_647;

    return (state - 1) / 2_147_483_646;
  };
}

function pick<T>(values: readonly T[], random: () => number) {
  const value = values[Math.floor(random() * values.length)];

  if (value === undefined) {
    throw new Error("cannot pick from an empty list");
  }

  return value;
}

function catalog() {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  handles.push(sqlite);
  migrateCatalogDatabase(db, "drizzle-catalog");

  sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('company', 'Co', 'co', 1)",
  );

  for (const ats of ["greenhouse", "lever", "ashby", "workable"] as const) {
    sqlite
      .prepare(
        "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES (?, 'company', ?, ?, 'us', 'active', 'import', 1)",
      )
      .run(`board-${ats}`, ats, ats);
  }

  return { db, sqlite };
}

function insertSeed(sqlite: Database, seed: Seed) {
  const url = `https://jobs.example/${seed.id}`;

  sqlite
    .prepare(INSERT_POSTING)
    .run(
      seed.id,
      `board-${seed.ats}`,
      seed.ats,
      seed.id,
      url,
      url,
      `Role ${seed.id}`,
      `role ${seed.id}`,
      seed.city === null ? (seed.countryCode ?? "Remote") : `${seed.city}, ${seed.countryCode}`,
      seed.countryCode,
      seed.region,
      seed.city,
      seed.workplace,
      NOW,
      NOW,
      seed.closed ? NOW : null,
      seed.closed ? "closed" : "open",
      seed.applySupported ? 1 : 0,
      seed.id,
    );

  if (seed.role !== null) {
    sqlite
      .prepare(
        "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'role', ?, 'rules')",
      )
      .run(seed.id, seed.role);
  }

  if (seed.subrole !== null) {
    sqlite
      .prepare(
        "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'subrole', ?, 'rules')",
      )
      .run(seed.id, seed.subrole);
  }
}

function seededCatalog(count: number, seed = 42) {
  const target = catalog();
  const random = randomSource(seed);

  target.sqlite.run("BEGIN");

  for (let index = 0; index < count; index += 1) {
    const role = random() < 0.1 ? null : pick(ROLES, random);

    insertSeed(target.sqlite, {
      ats: pick(["greenhouse", "lever", "ashby", "workable"] as const, random),
      applySupported: random() < 0.8,
      city: pick(CITIES, random),
      closed: random() < 0.1,
      countryCode: pick(COUNTRIES, random),
      id: `posting-${String(index)}`,
      region: pick(REGIONS, random),
      role,
      subrole: random() < 0.4 ? pick(SUB_ROLES, random) : null,
      workplace: pick(WORKPLACES, random),
    });
  }

  target.sqlite.run("COMMIT");
  target.sqlite.run("ANALYZE");
  rebuildSupplyFacets(target.db);

  return target;
}

function filter(overrides: Partial<SupplyFilters> = {}) {
  return {
    location: null,
    radiusKm: null,
    remote: false,
    role: null,
    ...overrides,
  } satisfies SupplyFilters;
}

function expectParity(db: ReturnType<typeof catalog>["db"], filters: SupplyFilters) {
  const live = countSupplyLive(db, filters);
  const faceted = supplyFacetTotals(db, filters);

  if (faceted !== null) {
    expect(faceted).toEqual(live);
  }

  expect(countSupportedSupply(db, filters)).toEqual(live);
}

describe("supply_facets", () => {
  test("matches the live count for every deterministic filter combination", () => {
    const target = seededCatalog(600);

    for (const role of [null, ...ROLES]) {
      for (const location of PLACES) {
        for (const remote of [false, true]) {
          expectParity(target.db, filter({ location, remote, role }));
        }
      }
    }
  });

  test("matches the live count across random filter combinations", () => {
    const target = seededCatalog(400, 7);
    const random = randomSource(1337);

    for (let attempt = 0; attempt < 250; attempt += 1) {
      expectParity(
        target.db,
        filter({
          location: pick(PLACES, random),
          remote: random() < 0.5,
          role: random() < 0.2 ? null : pick(ROLES, random),
        }),
      );
    }
  });

  test("uses the rollup for role, country/region and remote filters", () => {
    const target = seededCatalog(200);

    expect(supplyFacetTotals(target.db, filter())).not.toBeNull();
    expect(supplyFacetTotals(target.db, filter({ role: "Design" }))).not.toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "United States" }))).not.toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "Texas, USA" }))).not.toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "England" }))).not.toBeNull();
  });

  test("declines city and raw-text places so the caller keeps the indexed live query", () => {
    const target = seededCatalog(200);

    expect(supplyFacetTotals(target.db, filter({ location: "Austin" }))).toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "Berlin" }))).toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "Nowhere" }))).toBeNull();

    expectParity(target.db, filter({ location: "Austin", role: "Design", remote: true }));
  });

  test("declines metro, remote-scoped, multi-place and radius locations so the live R-Tree answers", () => {
    const target = seededCatalog(300);

    for (const location of ["Bay Area", "GTA", "Remote - Canada", "Canada; Germany"]) {
      expect(supplyFacetTotals(target.db, filter({ location }))).toBeNull();
      expectParity(target.db, filter({ location }));
      expectParity(target.db, filter({ location, remote: true }));
    }

    expect(supplyFacetTotals(target.db, filter({ location: "Toronto", radiusKm: 40 }))).toBeNull();
    expectParity(target.db, filter({ location: "Toronto", radiusKm: 40 }));
  });

  test("still answers a single country or region from the rollup", () => {
    const target = seededCatalog(200);

    expect(supplyFacetTotals(target.db, filter({ location: "Canada" }))).not.toBeNull();
    expect(supplyFacetTotals(target.db, filter({ location: "Ontario" }))).not.toBeNull();
    expectParity(target.db, filter({ location: "Canada" }));
    expectParity(target.db, filter({ location: "Ontario" }));
  });

  test("falls back cleanly while the rollup has not been built and when it is absent", () => {
    const target = catalog();

    target.sqlite.run("BEGIN");

    for (let index = 0; index < 40; index += 1) {
      insertSeed(target.sqlite, {
        ats: "greenhouse",
        applySupported: true,
        city: "Austin",
        closed: false,
        countryCode: "US",
        id: `posting-${String(index)}`,
        region: "Texas",
        role: pick(ROLES, randomSource(index)),
        subrole: null,
        workplace: index % 2 === 0 ? "remote" : "hybrid",
      });
    }

    target.sqlite.run("COMMIT");

    expect(supplyFacetTotals(target.db, filter())).toBeNull();
    expectParity(target.db, filter({ role: "Software Engineering", remote: true }));

    rebuildSupplyFacets(target.db);
    expect(supplyFacetTotals(target.db, filter())).not.toBeNull();

    target.sqlite.run("DROP TABLE supply_facets");

    expect(supplyFacetTotals(target.db, filter())).toBeNull();
    expectParity(target.db, filter({ location: "United States", role: "Design" }));
  });

  test("counts a Posting with matching role and subrole tags once, and multi-tag Postings once in the total", () => {
    const target = catalog();

    insertSeed(target.sqlite, {
      ats: "greenhouse",
      applySupported: true,
      city: "Austin",
      closed: false,
      countryCode: "US",
      id: "design-design",
      region: "Texas",
      role: "Design",
      subrole: "Design",
      workplace: "remote",
    });
    insertSeed(target.sqlite, {
      ats: "lever",
      applySupported: true,
      city: "Berlin",
      closed: false,
      countryCode: "DE",
      id: "sales-design",
      region: "Bavaria",
      role: "Sales",
      subrole: "Design",
      workplace: "hybrid",
    });

    rebuildSupplyFacets(target.db);

    expect(countSupportedSupply(target.db, filter()).total).toBe(2);
    expect(countSupportedSupply(target.db, filter({ role: "Design" })).total).toBe(2);
    expect(countSupportedSupply(target.db, filter({ role: "Sales" })).total).toBe(1);
    expect(countSupportedSupply(target.db, filter({ role: "Finance" })).total).toBe(0);

    const anyRole = target.sqlite
      .query("select sum(postings) as total from supply_facets where role = ?")
      .get(ANY_ROLE_FACET);

    expect(anyRole).toEqual({ total: 2 });
  });

  test("stores SQL NULL country and region as the empty sentinel, never as a NULL primary key", () => {
    const target = catalog();

    insertSeed(target.sqlite, {
      ats: "greenhouse",
      applySupported: true,
      city: null,
      closed: false,
      countryCode: null,
      id: "no-country",
      region: null,
      role: "Operations",
      subrole: null,
      workplace: "unknown",
    });

    rebuildSupplyFacets(target.db);

    expect(
      target.sqlite
        .query("select country_code, region from supply_facets where role = ?")
        .all(ANY_ROLE_FACET),
    ).toEqual([{ country_code: "", region: "" }]);
  });
});
