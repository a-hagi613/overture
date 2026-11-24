import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";

import type { CatalogDatabase } from "../platform/db/client.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import { postings } from "../platform/db/catalog-schema.ts";
import { rebuildPostingLocations, seedGeoPlaces } from "./geo-store.ts";
import { resolvedLocationCondition } from "./location-filter.ts";

const NOW = 1_800_000_000_000;

const GEO_NAMES = [
  "Toronto",
  "Mississauga",
  "Markham",
  "Brampton",
  "Ottawa",
  "London",
  "Montreal",
  "Vancouver",
  "New York City",
  "San Francisco",
  "Palo Alto",
  "San Jose",
  "Oakland",
  "Berlin",
  "Munich",
];

const scratch: { db: CatalogDatabase; sqlite: Database }[] = [];

afterEach(() => {
  for (const { sqlite } of scratch.splice(0)) {
    sqlite.close();
  }
});

interface PostingSeed {
  id: string;
  locationRaw: string;
  workplace: "onsite" | "hybrid" | "remote";
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
}

const POSTINGS: readonly PostingSeed[] = [
  { id: "toronto", locationRaw: "Toronto, ON, Canada", workplace: "onsite" },
  { id: "mississauga", locationRaw: "Mississauga, ON, Canada", workplace: "onsite" },
  { id: "markham", locationRaw: "Markham, ON, Canada", workplace: "hybrid" },
  { id: "brampton", locationRaw: "Brampton, ON, Canada", workplace: "onsite" },
  { id: "ottawa", locationRaw: "Ottawa, ON, Canada", workplace: "onsite" },
  { id: "london-ca", locationRaw: "London, ON, Canada", workplace: "onsite" },
  { id: "london-gb", locationRaw: "London, UK", workplace: "onsite" },
  { id: "montreal", locationRaw: "Montreal, QC, Canada", workplace: "onsite" },
  { id: "vancouver", locationRaw: "Vancouver, BC, Canada", workplace: "onsite" },
  { id: "san-francisco", locationRaw: "San Francisco, CA, USA", workplace: "onsite" },
  { id: "palo-alto", locationRaw: "Palo Alto, CA, USA", workplace: "onsite" },
  { id: "san-jose", locationRaw: "San Jose, CA, USA", workplace: "onsite" },
  { id: "new-york", locationRaw: "New York, NY, USA", workplace: "onsite" },
  { id: "berlin", locationRaw: "Berlin, Germany", workplace: "onsite" },
  { id: "munich", locationRaw: "Munich, Germany", workplace: "onsite" },
  { id: "remote-canada", locationRaw: "Remote - Canada", workplace: "remote" },
  { id: "remote-germany", locationRaw: "Remote - Germany", workplace: "remote" },
  { id: "remote-global", locationRaw: "Remote", workplace: "remote" },
];

function fixture() {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(db, "drizzle-catalog");
  seedGeoPlaces(db, { only: GEO_NAMES });

  sqlite.run(
    "insert into companies (id, name, name_norm, created_at) values ('company', 'Acme', 'acme', 1)",
  );
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values ('board', 'company', 'greenhouse', 'acme', 'us', 'active', 'v1_seed', 1)",
  );

  const insert = sqlite.prepare(
    `insert into postings
      (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
       country_code, region, city, location_raw, workplace, employment_type,
       first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
     values (?, 'board', 'company', 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'full_time', ?, ?, null, 'open', 1, ?)`,
  );

  for (const posting of POSTINGS) {
    insert.run(
      posting.id,
      posting.id,
      `https://jobs.example/${posting.id}`,
      `https://jobs.example/${posting.id}`,
      `Engineer ${posting.id}`,
      `engineer ${posting.id}`,
      posting.countryCode ?? null,
      posting.region ?? null,
      posting.city ?? null,
      posting.locationRaw,
      posting.workplace,
      NOW,
      NOW,
      posting.id,
    );
  }

  rebuildPostingLocations(db);

  const handle = { db, sqlite };

  scratch.push(handle);

  return handle;
}

function matching(db: CatalogDatabase, raw: string, radiusKm: number | null = null) {
  return db
    .select({ id: postings.id })
    .from(postings)
    .where(resolvedLocationCondition(db, raw, { radiusKm }))
    .all()
    .map((row) => row.id)
    .toSorted();
}

describe("resolvedLocationCondition", () => {
  test("Ontario matches every Ontario posting, including Toronto and Ottawa", () => {
    const { db } = fixture();
    const ids = matching(db, "Ontario");

    expect(ids).toEqual(["brampton", "london-ca", "markham", "mississauga", "ottawa", "toronto"]);
  });

  test("Toronto with a 40 km radius includes Mississauga, Markham and Brampton", () => {
    const { db } = fixture();
    const ids = matching(db, "Toronto", 40);

    expect(ids).toContain("toronto");
    expect(ids).toContain("mississauga");
    expect(ids).toContain("markham");
    expect(ids).toContain("brampton");
    expect(ids).not.toContain("ottawa");
    expect(ids).not.toContain("vancouver");
  });

  test("Toronto without a radius is an exact city match", () => {
    const { db } = fixture();

    expect(matching(db, "Toronto")).toEqual(["toronto"]);
  });

  test("London, ON, Canada never falls through to London, UK", () => {
    const { db } = fixture();
    const ids = matching(db, "London, ON, Canada");

    expect(ids).toContain("london-ca");
    expect(ids).not.toContain("london-gb");
  });

  test("Bay Area includes San Francisco, Palo Alto and San Jose", () => {
    const { db } = fixture();
    const ids = matching(db, "Bay Area");

    expect(ids).toContain("san-francisco");
    expect(ids).toContain("palo-alto");
    expect(ids).toContain("san-jose");
    expect(ids).not.toContain("toronto");
  });

  test("Europe includes on-site Berlin and remote-Germany, but not Canada", () => {
    const { db } = fixture();
    const ids = matching(db, "Europe");

    expect(ids).toContain("berlin");
    expect(ids).toContain("munich");
    expect(ids).toContain("remote-germany");
    expect(ids).not.toContain("toronto");
  });

  test("Canada includes Toronto and a remote-Canada posting", () => {
    const { db } = fixture();
    const ids = matching(db, "Canada");

    expect(ids).toContain("toronto");
    expect(ids).toContain("vancouver");
    expect(ids).toContain("remote-canada");
    expect(ids).not.toContain("berlin");
    expect(ids).not.toContain("remote-germany");
  });

  test("Remote - Canada matches only the remote-Canada posting", () => {
    const { db } = fixture();

    expect(matching(db, "Remote - Canada")).toEqual(["remote-canada"]);
  });

  test("a posting with no derived location row still matches through its own columns", () => {
    const { db, sqlite } = fixture();

    sqlite.run(
      `insert into postings
        (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
         country_code, city, location_raw, workplace, employment_type,
         first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
       values ('legacy', 'board', 'company', 'greenhouse', 'legacy', 'https://jobs.example/legacy',
         'https://jobs.example/legacy', 'Legacy Engineer', 'legacy engineer', 'CA', 'Toronto',
         'Toronto, Canada', 'onsite', 'full_time', ?, ?, null, 'open', 1, 'legacy')`,
      [NOW, NOW],
    );

    expect(matching(db, "Toronto")).toContain("legacy");
    expect(matching(db, "Canada")).toContain("legacy");
  });
});
