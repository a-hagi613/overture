import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createSupplyRoutes } from "./supply.ts";
import { supplyCountsSchema } from "../../shared/supply.ts";

const NOW = 1_800_000_000_000;
const RATE_LIMIT_MAX = 120;

const INSERT_POSTING = `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm,
  title, title_norm, location_raw, country_code, city, language, workplace, employment_type,
  first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
  VALUES (?, 'board', 'company', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, 'full_time', ?, ?, ?, ?, ?, ?)`;

const handles: { close: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

function seedPosting(
  sqlite: Database,
  id: string,
  ats: "greenhouse" | "lever",
  role: "Operations" | "Software Engineering",
  workplace: "hybrid" | "remote",
  options: { closed?: boolean; granularRole?: string } = {},
) {
  const closed = options.closed === true;

  sqlite
    .prepare(INSERT_POSTING)
    .run(
      id,
      ats,
      id,
      `https://jobs.example/${id}`,
      `https://jobs.example/${id}`,
      `Role ${id}`,
      "role",
      "Austin, TX",
      "US",
      "Austin",
      workplace,
      NOW,
      NOW,
      closed ? NOW : null,
      closed ? "closed" : "open",
      1,
      id,
    );
  sqlite
    .prepare(
      "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'role', ?, 'rules')",
    )
    .run(id, role);

  if (options.granularRole !== undefined) {
    sqlite
      .prepare(
        "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'granular_role', ?, 'rules')",
      )
      .run(id, options.granularRole);
  }
}

function createTestApp() {
  const app = openDatabase(":memory:");
  const catalog = openCatalogDatabase(":memory:");

  handles.push(app.sqlite, catalog.sqlite);

  migrateDatabase(app.db, "drizzle");
  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  catalog.sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('company', 'Co', 'co', 1)",
  );
  catalog.sqlite.run(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES ('board', 'company', 'greenhouse', 'token', 'us', 'active', 'import', 1)",
  );

  catalog.sqlite.run("BEGIN");
  seedPosting(catalog.sqlite, "gh-swe-remote", "greenhouse", "Software Engineering", "remote");
  seedPosting(catalog.sqlite, "gh-swe-remote-2", "greenhouse", "Software Engineering", "remote", {
    granularRole: "Software Engineer",
  });
  seedPosting(catalog.sqlite, "lever-ops-remote", "lever", "Operations", "remote", {
    granularRole: "Operations Manager",
  });
  seedPosting(catalog.sqlite, "lever-ops-hybrid", "lever", "Operations", "hybrid");
  seedPosting(catalog.sqlite, "gh-swe-closed", "greenhouse", "Software Engineering", "remote", {
    closed: true,
  });
  catalog.sqlite.run("COMMIT");

  const routes = new Hono();

  routes.route(
    "/api",
    createSupplyRoutes({
      catalogDb: catalog.db,
      clientIpConfig: { flyAppName: undefined, nodeEnv: "test" },
      clock: createClock(),
      db: app.db,
    }),
  );

  return routes;
}

async function request(app: Hono, path: string, ip = "203.0.113.7") {
  return app.request(path, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/supply", () => {
  test("answers an unauthenticated aggregate count with a public cache header", async () => {
    const app = createTestApp();
    const response = await request(app, "/api/supply");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("CDN-Cache-Control")).toContain("public");

    const body = supplyCountsSchema.parse(await response.json());

    expect(body.total).toBe(4);
    expect(body.byAts).toEqual([
      { ats: "greenhouse", count: 2 },
      { ats: "lever", count: 2 },
    ]);
  });

  test("filters by role, location and remote", async () => {
    const app = createTestApp();

    const byRole = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=Software%20Engineering")).json(),
    );

    const byLocation = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?location=Austin")).json(),
    );

    const remote = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?remote=true")).json(),
    );

    const both = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=Software%20Engineering&remote=1")).json(),
    );

    const nothing = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=Design")).json(),
    );

    const byCategoryAlias = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?category=Software%20Engineering")).json(),
    );

    const byGranularRole = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?granularRole=Software%20Engineer")).json(),
    );

    const granularWins = supplyCountsSchema.parse(
      await (
        await request(app, "/api/supply?role=Operations&granularRole=Software%20Engineer&remote=1")
      ).json(),
    );

    expect(byRole.total).toBe(2);
    expect(byLocation.total).toBe(4);
    expect(remote.total).toBe(3);
    expect(both.total).toBe(2);
    expect(nothing.total).toBe(0);
    expect(byCategoryAlias.total).toBe(2);
    expect(byGranularRole.total).toBe(1);
    expect(granularWins.total).toBe(1);
  });

  test("refuses an unknown role, granular role or a one-character location with invalid_request", async () => {
    const app = createTestApp();
    const role = await request(app, "/api/supply?role=Wizard");
    const granular = await request(app, "/api/supply?granularRole=Wizard");
    const location = await request(app, "/api/supply?location=a");

    expect(role.status).toBe(400);
    expect(await role.json()).toMatchObject({ error: "invalid_request" });
    expect(granular.status).toBe(400);
    expect(await granular.json()).toMatchObject({ error: "invalid_request" });
    expect(location.status).toBe(400);
    expect(await location.json()).toMatchObject({ error: "invalid_request" });
  });

  test("rate limits one client and leaves another client with its own window", async () => {
    const app = createTestApp();

    const allowed = await Promise.all(
      Array.from({ length: RATE_LIMIT_MAX }, async () =>
        request(app, "/api/supply", "198.51.100.4"),
      ),
    );

    expect(allowed.every((response) => response.status === 200)).toBe(true);

    const limited = await request(app, "/api/supply", "198.51.100.4");

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toMatchObject({ error: "rate_limited" });
    expect((await request(app, "/api/supply", "198.51.100.5")).status).toBe(200);
  });
});
