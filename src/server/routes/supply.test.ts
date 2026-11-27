import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { count } from "drizzle-orm";
import { Hono } from "hono";

import type { FreehireJobRecord } from "../../shared/freehire.ts";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";
import { createClock } from "../platform/ports/clock.ts";
import { createJobStore } from "../jobs/store.ts";
import { postings } from "../platform/db/catalog-schema.ts";
import { suggestLocations } from "../catalog/geo-suggest.ts";
import { resolvePlaceText } from "../places/resolve.ts";
import { createSupplyRoutes } from "./supply.ts";
import { locationSuggestionsResponseSchema, supplyCountsSchema } from "../../shared/supply.ts";

const NOW = 1_800_000_000_000;
const RATE_LIMIT_MAX = 120;

const handles: { close: () => void }[] = [];

beforeAll(() => {
  suggestLocations("ott");
  resolvePlaceText("Ottawa");
});

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.close();
  }
});

type TestAts = "ashby" | "greenhouse" | "lever";

const record: (overrides?: Partial<FreehireJobRecord>) => FreehireJobRecord = (overrides = {}) => {
  const publicSlug = overrides.public_slug ?? "senior-software-engineer-acme";

  return {
    apply_url: null,
    cities: ["Toronto"],
    closed_at: null,
    company: "Acme",
    company_slug: "acme",
    countries: ["ca"],
    created_at: "2026-11-20T09:00:00Z",
    description: null,
    enrichment: { category: "software_engineering" },
    external_id: `acme:${publicSlug}`,
    location: "Toronto, Canada",
    metros: null,
    posted_at: "2026-11-20T00:00:00Z",
    public_slug: publicSlug,
    reality: null,
    regions: null,
    skills: null,
    source: "greenhouse",
    title: "Senior Software Engineer",
    url: null,
    work_mode: null,
    ...overrides,
  };
};

function storeJob(
  db: ReturnType<typeof openDatabase>["db"],
  job: FreehireJobRecord,
  ats: TestAts = "greenhouse",
) {
  createJobStore({ clock: { now: () => NOW }, db }).upsert(job, {
    applyUrl: `https://jobs.example/${job.public_slug}`,
    ats,
    atsJobId: job.public_slug,
    boardToken: "acme",
    via: "direct",
  });
}

function seedJobs(db: ReturnType<typeof openDatabase>["db"]) {
  storeJob(
    db,
    record({
      cities: ["Toronto"],
      countries: ["ca"],
      public_slug: "gh-swe-remote-toronto",
      work_mode: "remote",
    }),
  );
  storeJob(
    db,
    record({
      cities: ["Austin"],
      countries: ["us"],
      location: "Austin, United States",
      public_slug: "gh-swe-remote-austin",
      work_mode: "remote",
    }),
  );
  storeJob(
    db,
    record({
      cities: ["New York"],
      countries: ["us"],
      enrichment: { category: "operations" },
      external_id: "lever:ops-remote",
      location: "New York, United States",
      public_slug: "lever-ops-remote-new-york",
      source: "lever",
      title: "Operations Manager",
      work_mode: "remote",
    }),
    "lever",
  );
  storeJob(
    db,
    record({
      cities: ["Toronto"],
      countries: ["ca"],
      enrichment: { category: "operations" },
      external_id: "lever:ops-hybrid",
      public_slug: "lever-ops-hybrid-toronto",
      source: "lever",
      title: "Operations Manager",
      work_mode: "hybrid",
    }),
    "lever",
  );
  storeJob(
    db,
    record({
      cities: ["Berlin"],
      countries: ["de"],
      enrichment: { category: "design" },
      external_id: "ashby:design-berlin",
      location: "Berlin, Germany",
      public_slug: "ashby-design-berlin",
      source: "ashby",
      title: "Product Designer",
      work_mode: "onsite",
    }),
    "ashby",
  );
  storeJob(
    db,
    record({
      cities: ["Ottawa"],
      countries: ["ca"],
      enrichment: { category: "education" },
      location: "Ottawa, Canada",
      public_slug: "gh-teacher-ottawa",
      title: "Primary Teacher",
      work_mode: "hybrid",
    }),
  );
  storeJob(
    db,
    record({
      cities: ["Mississauga"],
      countries: ["ca"],
      enrichment: { category: "support" },
      location: "Mississauga, Canada",
      public_slug: "gh-support-mississauga",
      title: "Customer Support Specialist",
      work_mode: "hybrid",
    }),
  );
  storeJob(
    db,
    record({
      cities: ["Austin"],
      countries: ["us"],
      enrichment: { category: "ml_ai" },
      location: "Austin, United States",
      public_slug: "gh-ml-remote-austin",
      title: "Machine Learning Engineer",
      work_mode: "remote",
    }),
  );

  storeJob(
    db,
    record({
      public_slug: "gh-swe-remote-closed",
      work_mode: "remote",
    }),
  );
  createJobStore({ clock: { now: () => NOW }, db }).close("gh-swe-remote-closed", NOW);

  storeJob(
    db,
    record({
      public_slug: "gh-talent-pool",
      title: "Talent Pool - Future Opportunities",
      work_mode: "remote",
    }),
  );
}

function createTestApp() {
  const app = openDatabase(":memory:");

  handles.push(app.sqlite);

  migrateDatabase(app.db, "drizzle");

  seedJobs(app.db);

  const routes = new Hono();

  routes.route(
    "/api",
    createSupplyRoutes({
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
  test("answers an unauthenticated aggregate count of open freehire jobs with a public cache header", async () => {
    const app = createTestApp();
    const response = await request(app, "/api/supply");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(response.headers.get("CDN-Cache-Control")).toContain("public");

    const body = supplyCountsSchema.parse(await response.json());

    expect(body.total).toBe(8);
    expect(body.byAts).toEqual([
      { ats: "greenhouse", count: 5 },
      { ats: "lever", count: 2 },
      { ats: "ashby", count: 1 },
    ]);
  });

  test("counts the freehire jobs table even when the legacy catalog is empty", async () => {
    const app = createTestApp();
    const catalog = openCatalogDatabase(":memory:");

    handles.push(catalog.sqlite);

    migrateCatalogDatabase(catalog.db, "drizzle-catalog");

    expect(catalog.db.select({ total: count() }).from(postings).get()?.total).toBe(0);

    const body = supplyCountsSchema.parse(await (await request(app, "/api/supply")).json());

    expect(body.total).toBe(8);
  });

  test("filters by freehire category, legacy category, granular role, location and remote", async () => {
    const app = createTestApp();

    const byFreehireCategory = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=software_engineering")).json(),
    );

    const byLegacyCategory = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=software-it")).json(),
    );

    const byLegacyCategoryName = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?category=Software%20Engineering")).json(),
    );

    const byGranularRole = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?granularRole=Software%20Engineer")).json(),
    );

    const byCity = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?location=Toronto")).json(),
    );

    const byCountry = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?location=Canada")).json(),
    );

    const remote = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?remote=true")).json(),
    );

    const both = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=operations&location=Toronto&remote=1")).json(),
    );

    const byLegacyDataCategory = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=data-ai")).json(),
    );

    const nothing = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=legal")).json(),
    );

    expect(byFreehireCategory.total).toBe(2);
    expect(byLegacyCategory.total).toBe(2);
    expect(byLegacyCategoryName.total).toBe(2);
    expect(byGranularRole.total).toBe(2);
    expect(byCity.total).toBe(2);
    expect(byCountry.total).toBe(4);
    expect(remote.total).toBe(4);
    expect(both.total).toBe(0);
    expect(byLegacyDataCategory.total).toBe(1);
    expect(nothing.total).toBe(0);
  });

  test("expands a city by radius, counting neighbouring jobs that carry their own city place id", async () => {
    const app = createTestApp();

    const nearby = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?location=Toronto&radius=80")).json(),
    );

    expect(nearby.total).toBe(3);
  });

  test("excludes closed rows and non-jobs from every total", async () => {
    const app = createTestApp();

    const remote = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?remote=true")).json(),
    );

    const byCategory = supplyCountsSchema.parse(
      await (await request(app, "/api/supply?role=software_engineering")).json(),
    );

    expect(remote.total).toBe(4);
    expect(byCategory.total).toBe(2);
  });

  test("keeps landing location suggestions consistent with the place ids the count reads", async () => {
    const app = createTestApp();
    const suggestionsResponse = await request(app, "/api/supply/locations?q=ott");

    expect(suggestionsResponse.status).toBe(200);

    const suggestions = locationSuggestionsResponseSchema.parse(await suggestionsResponse.json());
    const ottawa = suggestions.suggestions.find((item) => item.label === "Ottawa");

    expect(ottawa).toBeDefined();

    const body = supplyCountsSchema.parse(
      await (
        await request(app, `/api/supply?location=${encodeURIComponent(ottawa?.value ?? "")}`)
      ).json(),
    );

    expect(body.total).toBe(1);
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

  test("returns global location suggestions for ott and ney queries", async () => {
    const app = createTestApp();
    const ottResponse = await request(app, "/api/supply/locations?q=ott");
    const neyResponse = await request(app, "/api/supply/locations?q=ney");

    expect(ottResponse.status).toBe(200);
    expect(neyResponse.status).toBe(200);

    const ott = locationSuggestionsResponseSchema.parse(await ottResponse.json());
    const ney = locationSuggestionsResponseSchema.parse(await neyResponse.json());

    expect(ott.suggestions[0]?.label).toBe("Ottawa");
    expect(ney.suggestions.slice(0, 3).map((item) => item.label)).toContain("New York City");
  });
});
