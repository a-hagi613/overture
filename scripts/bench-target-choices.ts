import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

import {
  catalogPathFor,
  openCatalogDatabase,
  openDatabase,
} from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createTargetChoicesCache, targetChoices } from "../src/server/profile/target-choices.ts";
import { countMatchingPostings } from "../src/server/profile/targets.ts";

const BOARDS = 14_000;
const POSTINGS = 200_000;
const ROLES = 60;
const SUBROLES = 240;
const SENIORITIES = ["intern", "entry", "mid", "senior", "staff", "principal", "manager"] as const;
const WORKPLACES = ["remote", "hybrid", "onsite", "unknown"] as const;
const EMPLOYMENT = ["full_time", "full_time", "full_time", "part_time", "contract"] as const;
const COUNTRIES = ["US", "GB", "DE", "CA", "NL", "FR", "IN", "AU", "ES", "SE"] as const;
const NOW = 1_795_000_000_000;

function pick<T>(values: readonly [T, ...T[]], index: number) {
  return values[index % values.length] ?? values[0];
}

function skewed(index: number, size: number) {
  return Math.floor(size * ((index * 2_654_435_761) % 1_000_003) ** 2 * 1e-12);
}

function build(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });

  const catalogPath = catalogPathFor(path);

  rmSync(catalogPath, { force: true });

  const { db } = openDatabase(path);
  const { db: catalogDb, sqlite } = openCatalogDatabase(catalogPath);

  migrateDatabase(db, "drizzle");
  migrateCatalogDatabase(catalogDb, "drizzle-catalog");
  sqlite.run("PRAGMA synchronous = OFF;");

  const company = sqlite.prepare(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES (?, ?, ?, ?)",
  );

  const board = sqlite.prepare(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES (?, ?, 'greenhouse', ?, 'us', 'active', 'import', ?)",
  );

  const posting = sqlite.prepare(
    `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
      location_raw, country_code, city, language, workplace, employment_type, first_seen_at, last_seen_at,
      closed_at, dedupe_key)
     VALUES (?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?, ?, ?, ?, ?)`,
  );

  const tag = sqlite.prepare(
    "INSERT OR IGNORE INTO posting_tags (posting_id, dimension, value, source) VALUES (?, ?, ?, 'rules')",
  );

  sqlite.transaction(() => {
    for (let index = 0; index < BOARDS; index += 1) {
      company.run(`c${String(index)}`, `Company ${String(index)}`, `company ${String(index)}`, NOW);
      board.run(`b${String(index)}`, `c${String(index)}`, `token${String(index)}`, NOW);
    }

    for (let index = 0; index < POSTINGS; index += 1) {
      const id = `p${String(index)}`;
      const owner = index % BOARDS;
      const country = pick(COUNTRIES, skewed(index, COUNTRIES.length));
      const city = `City ${String(skewed(index + 7, 2000))}`;
      const role = `Role ${String(skewed(index + 3, ROLES))}`;
      const closed = index % 4 === 0 ? NOW : null;

      posting.run(
        id,
        `b${String(owner)}`,
        `c${String(owner)}`,
        String(index),
        `https://example.test/${id}`,
        `https://example.test/${id}`,
        role,
        role.toLowerCase(),
        `${city}, ${country}`,
        country,
        city,
        pick(WORKPLACES, index),
        pick(EMPLOYMENT, index),
        NOW,
        NOW,
        closed,
        id,
      );

      tag.run(id, "role", role);
      tag.run(id, "subrole", `Subrole ${String(skewed(index + 11, SUBROLES))}`);
      tag.run(id, "seniority", pick(SENIORITIES, index));
    }
  })();

  sqlite.run("ANALYZE;");

  return { catalogDb, db };
}

function time<T>(label: string, run: () => T) {
  const started = performance.now();
  const result = run();
  const cold = performance.now() - started;
  const again = performance.now();

  run();

  process.stdout.write(
    `${label}: cold ${cold.toFixed(0)} ms, warm ${(performance.now() - again).toFixed(0)} ms\n`,
  );

  return result;
}

const path = process.argv.at(2);

if (path === undefined) {
  throw new Error("usage: bun scripts/bench-target-choices.ts <database path>");
}

const { catalogDb } = build(path);

const choices = time("targetChoices", () => targetChoices(catalogDb));

const cache = createTargetChoicesCache({
  catalogDb,
  now: () => performance.timeOrigin + performance.now(),
  staleMs: 600_000,
});

time("cache.read", () => cache.read());

time("countMatchingPostings", () =>
  countMatchingPostings(
    catalogDb,
    {
      employmentTypes: ["full_time"],
      locations: ["City 1"],
      roles: choices.roles.slice(0, 2),
      salaryCurrency: null,
      salaryFloorMinor: null,
      seniorities: ["senior"],
      workplaces: ["remote", "hybrid"],
    },
    ["en"],
  ),
);

process.stdout.write(
  `roles ${String(choices.roles.length)}, locations ${String(choices.locations.length)}\n`,
);
