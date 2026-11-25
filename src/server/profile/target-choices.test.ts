import { describe, expect, test } from "bun:test";

import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { openCatalogDatabase } from "../platform/db/client.ts";
import { locationChoiceCounts, locationChoices, targetChoices } from "./target-choices.ts";

const NOW = 1_795_000_000_000;

const CITIES = ["Berlin", "Lisbon", "Toronto", "Austin"] as const;
const WORKPLACES = ["remote", "hybrid", "onsite"] as const;

type Fixture = ReturnType<typeof migrated>;

function migrated() {
  const { db: catalogDb, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(catalogDb, "drizzle-catalog");
  sqlite.run("INSERT INTO companies (id, name, name_norm, created_at) VALUES ('c', 'Co', 'co', 1)");
  sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('b', 'c', 'greenhouse', 't', 'us', 'active', 'import', 1)",
  );

  return { catalogDb, sqlite };
}

function addPosting(fixture: Fixture, input: { closed: boolean; index: number }) {
  const city = CITIES[input.index % CITIES.length] ?? "Berlin";
  const workplace = WORKPLACES[input.index % WORKPLACES.length] ?? "remote";

  fixture.sqlite
    .prepare(
      `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
        location_raw, country_code, city, language, workplace, employment_type, first_seen_at, last_seen_at,
        closed_at, status, apply_supported, dedupe_key)
       VALUES (?, 'b', 'c', 'greenhouse', ?, ?, ?, ?, ?, ?, 'DE', ?, 'en', ?, 'full_time', ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      `p${String(input.index)}`,
      String(input.index),
      `https://example.test/p${String(input.index)}`,
      `https://example.test/p${String(input.index)}`,
      city,
      city.toLowerCase(),
      `${city}, DE`,
      city,
      workplace,
      NOW,
      NOW,
      input.closed ? NOW : null,
      input.closed ? "closed" : "open",
      `p${String(input.index)}`,
    );
}

function seeded() {
  const fixture = migrated();

  for (let index = 0; index < 400; index += 1) {
    addPosting(fixture, { closed: index % 7 === 0, index });
  }

  fixture.sqlite.run("ANALYZE");

  return fixture;
}

function planOf(fixture: Fixture) {
  const compiled = locationChoiceCounts(fixture.catalogDb).toSQL();

  return fixture.sqlite
    .query<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${compiled.sql}`)
    .all()
    .map((row) => row.detail);
}

describe("the open-Posting location query", () => {
  test("reads a covering index, never the table or a temporary b-tree", () => {
    const plan = planOf(seeded()).join("\n");

    expect(plan).toContain("USING COVERING INDEX postings_open_location");
    expect(plan).not.toMatch(/SCAN postings\b(?! USING COVERING INDEX)/mu);
    expect(plan).not.toContain("TEMP B-TREE");
  });

  test("offers each city an open Posting names exactly once", () => {
    const { catalogDb } = seeded();

    expect(locationChoices(catalogDb).toSorted()).toEqual([
      "Austin",
      "Berlin",
      "Lisbon",
      "Toronto",
    ]);
  });
});

describe("targetChoices roleCounts", () => {
  test("returns open-posting counts by taxonomy name even beyond top 12 and ignores closed postings", () => {
    const fixture = migrated();

    const roles: [string, number][] = [
      ["sw.general", 20],
      ["sw.backend", 18],
      ["sw.frontend", 16],
      ["sw.fullstack", 15],
      ["sw.mobile", 14],
      ["sw.embedded", 13],
      ["sw.game", 12],
      ["sw.qa", 11],
      ["sw.web", 10],
      ["sw.erp", 9],
      ["sw.devops", 8],
      ["sw.sysadmin", 7],
      ["health.rn", 4],
      ["health.lpn", 2],
    ];

    let index = 0;

    for (const [roleId, total] of roles) {
      for (let i = 0; i < total; i += 1) {
        addPosting(fixture, { closed: false, index });
        fixture.sqlite
          .prepare(
            "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'granular_role', ?, 'rules')",
          )
          .run(`p${String(index)}`, roleId);
        index += 1;
      }
    }

    addPosting(fixture, { closed: true, index });
    fixture.sqlite
      .prepare(
        "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'granular_role', 'health.lpn', 'rules')",
      )
      .run(`p${String(index)}`);

    const choices = targetChoices(fixture.catalogDb);

    expect(choices.roles).toHaveLength(12);
    expect(choices.roles[0]).toBe("Software Engineer (general)");
    expect(choices.roleCounts["Software Engineer (general)"]).toBe(20);
    expect(choices.roleCounts["Registered Nurse"]).toBe(4);
    expect(choices.roleCounts["LPN / LVN"]).toBe(2);
  });
});
