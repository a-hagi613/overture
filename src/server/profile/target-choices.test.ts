import { describe, expect, test } from "bun:test";

import { migrateDatabase } from "../platform/db/migrate.ts";
import { openDatabase } from "../platform/db/client.ts";
import { locationChoiceCounts, locationChoices } from "./target-choices.ts";

const NOW = 1_795_000_000_000;

const CITIES = ["Berlin", "Lisbon", "Toronto", "Austin"] as const;
const WORKPLACES = ["remote", "hybrid", "onsite"] as const;

type Fixture = ReturnType<typeof migrated>;

function migrated() {
  const { db, sqlite } = openDatabase(":memory:");

  migrateDatabase(db, "drizzle");
  sqlite.run("INSERT INTO companies (id, name, name_norm, created_at) VALUES ('c', 'Co', 'co', 1)");
  sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('b', 'c', 'greenhouse', 't', 'us', 'active', 'import', 1)",
  );

  return { db, sqlite };
}

function addPosting(fixture: Fixture, input: { closed: boolean; index: number }) {
  const city = CITIES[input.index % CITIES.length] ?? "Berlin";
  const workplace = WORKPLACES[input.index % WORKPLACES.length] ?? "remote";

  fixture.sqlite
    .prepare(
      `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
        location_raw, country_code, city, language, workplace, employment_type, first_seen_at, last_seen_at,
        closed_at, dedupe_key)
       VALUES (?, 'b', 'c', 'greenhouse', ?, ?, ?, ?, ?, ?, 'DE', ?, 'en', ?, 'full_time', ?, ?, ?, ?)`,
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
  const compiled = locationChoiceCounts(fixture.db).toSQL();

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
    const { db } = seeded();

    expect(locationChoices(db).toSorted()).toEqual(["Austin", "Berlin", "Lisbon", "Toronto"]);
  });
});
