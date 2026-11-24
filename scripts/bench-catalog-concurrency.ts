import { Hono } from "hono";
import { z } from "zod";

import type { BackupMonitor } from "../src/server/platform/ports/backup.ts";

import { createClock } from "../src/server/platform/ports/clock.ts";
import { openCatalogDatabase, openDatabase } from "../src/server/platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../src/server/platform/db/migrate.ts";
import { createHealthRoutes } from "../src/server/routes/health.ts";
import { createSupplyRoutes } from "../src/server/routes/supply.ts";
import { rebuildSupplyFacets } from "../src/server/catalog/supply-facets.ts";
import { ATS_VALUES } from "../src/shared/ats.ts";
import { ROLE_GROUPS } from "../src/shared/tag-taxonomy.ts";

const DEFAULT_ROWS = 120_000;
const DEFAULT_ROUNDS = 15;
const CONCURRENCY = 30;
const HEALTH_EVERY = 5;
const SUPPLY_PER_ROUND = CONCURRENCY - Math.ceil(CONCURRENCY / HEALTH_EVERY);
const NOW = 1_800_000_000_000;

const COUNTRIES = ["US", "GB", "DE", "CA", "NL", "FR", "ES", "IN", "AU", "SE"] as const;
const WORKPLACES = ["remote", "hybrid", "onsite", "unknown"] as const;

const FACET_PLACES = [
  "United States",
  "United Kingdom",
  "Germany",
  "Canada",
  "France",
  "Spain",
  "India",
  "Australia",
  "Sweden",
  "Texas, USA",
  "California",
  "England",
  "Bavaria",
] as const;

const CITY_PLACES = ["Austin", "London", "Berlin", "Toronto", "Paris", "Madrid"] as const;

const positiveInteger = z.coerce.number().int().positive();

const rows = positiveInteger.parse(process.argv.at(2) ?? String(DEFAULT_ROWS));
const rounds = positiveInteger.parse(process.argv.at(3) ?? String(DEFAULT_ROUNDS));
const legacy = process.argv.includes("--legacy");
const atsValues = ATS_VALUES.slice(0, 8);

function pick<T>(values: readonly T[], index: number) {
  const value = values[index % values.length];

  if (value === undefined) {
    throw new Error("cannot pick from an empty list");
  }

  return value;
}

function buildCatalog() {
  const { db, sqlite } = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(db, "drizzle-catalog");
  sqlite.run("PRAGMA synchronous = OFF");
  sqlite.run(
    "INSERT INTO companies (id, name, name_norm, created_at) VALUES ('company', 'Co', 'co', 1)",
  );

  const board = sqlite.prepare(
    "INSERT INTO company_boards (id, company_id, ats, board_token, region, status, source, created_at) VALUES (?, 'company', ?, ?, 'us', 'active', 'import', 1)",
  );

  for (const ats of atsValues) {
    board.run(`board-${ats}`, ats, ats);
  }

  const posting = sqlite.prepare(
    `INSERT INTO postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title,
       title_norm, location_raw, country_code, region, city, language, workplace, employment_type,
       first_seen_at, last_seen_at, closed_at, status, apply_supported, dedupe_key)
     VALUES (?, ?, 'company', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, 'full_time', ?, ?, ?, ?, ?, ?)`,
  );

  const tag = sqlite.prepare(
    "INSERT INTO posting_tags (posting_id, dimension, value, source) VALUES (?, ?, ?, 'rules')",
  );

  const started = performance.now();

  sqlite.transaction(() => {
    for (let index = 0; index < rows; index += 1) {
      const id = `posting-${String(index)}`;
      const ats = pick(atsValues, index);
      const country = pick(COUNTRIES, index);
      const city = `City ${String(index % 2000)}`;
      const role = pick(ROLE_GROUPS, index);
      const closed = index % 12 === 0;
      const applySupported = index % 10 !== 0;
      const url = `https://jobs.example/${id}`;

      posting.run(
        id,
        `board-${ats}`,
        ats,
        String(index),
        url,
        url,
        `${role} ${String(index)}`,
        `${role} ${String(index)}`.toLowerCase(),
        `${city}, ${country}`,
        country,
        `Region ${String(index % 40)}`,
        city,
        pick(WORKPLACES, index),
        NOW,
        NOW,
        closed ? NOW : null,
        closed ? "closed" : "open",
        applySupported ? 1 : 0,
        id,
      );

      tag.run(id, "role", role);

      if (index % 2 === 0) {
        tag.run(id, "subrole", `Subrole ${String(index % 40)}`);
      }

      tag.run(id, "seniority", index % 3 === 0 ? "senior" : "mid");
    }
  })();

  sqlite.run("ANALYZE");
  rebuildSupplyFacets(db);

  const facetRows = z
    .object({ total: z.number() })
    .parse(sqlite.query("SELECT count(*) AS total FROM supply_facets").get()).total;

  const openSupported = z
    .object({ total: z.number() })
    .parse(
      sqlite
        .query(
          "SELECT count(*) AS total FROM postings WHERE status = 'open' AND apply_supported = 1 AND closed_at IS NULL",
        )
        .get(),
    ).total;

  return { db, facetRows, openSupported, seedMs: performance.now() - started };
}

function degradeToLegacy(db: ReturnType<typeof buildCatalog>["db"]) {
  const client = db.$client;

  client.run("DROP TABLE IF EXISTS supply_facets");

  for (const index of [
    "postings_supply_ats",
    "postings_supply_country",
    "postings_live_city",
    "postings_live_region",
    "posting_tags_dimension_value_posting",
  ]) {
    client.run(`DROP INDEX IF EXISTS ${index}`);
  }

  client.run(
    "CREATE INDEX IF NOT EXISTS posting_tags_dimension_value ON posting_tags (dimension, value)",
  );
  client.run("ANALYZE");
}

function buildApp(catalogDb: ReturnType<typeof buildCatalog>["db"]) {
  const appDb = openDatabase(":memory:");

  migrateDatabase(appDb.db, "drizzle");

  const backups = {
    run: async () => {
      await Promise.resolve();
    },
    status: () => ({ replication: "unconfigured" }),
  } satisfies BackupMonitor;

  const health = createHealthRoutes(appDb.db, backups);

  const supply = createSupplyRoutes({
    db: appDb.db,
    catalogDb,
    clock: createClock(),
    clientIpConfig: { flyAppName: undefined, nodeEnv: "test" },
  });

  const app = new Hono();

  app.route("/api", health);
  app.route("/api", supply);

  return { fetch: async (request: Request) => app.fetch(request) };
}

interface Sample {
  kind: "health" | "supply-facet" | "supply-live";
  ms: number;
  path: string;
}

interface RequestPlan {
  kind: Sample["kind"];
  path: string;
}

function filterRequest(index: number) {
  if (index % 5 === 0) {
    return {
      kind: "supply-live",
      path: `/api/supply?location=${encodeURIComponent(pick(CITY_PLACES, Math.floor(index / 5)))}&role=${encodeURIComponent(pick(ROLE_GROUPS, index))}${index % 2 === 0 ? "&remote=true" : ""}`,
    } satisfies RequestPlan;
  }

  if (index % 7 === 1) {
    return {
      kind: "supply-facet",
      path: `/api/supply${index % 2 === 0 ? "?remote=true" : ""}`,
    } satisfies RequestPlan;
  }

  const role = pick(ROLE_GROUPS, index);
  const place = pick(FACET_PLACES, Math.floor(index / ROLE_GROUPS.length));

  return {
    kind: "supply-facet",
    path: `/api/supply?role=${encodeURIComponent(role)}&location=${encodeURIComponent(place)}${Math.floor(index / 2) % 2 === 0 ? "&remote=true" : ""}`,
  } satisfies RequestPlan;
}

function planRound(round: number) {
  return Array.from({ length: CONCURRENCY }, (_, position) => {
    if (position % HEALTH_EVERY === 0) {
      return { kind: "health", path: "/api/health" } satisfies RequestPlan;
    }

    const supplyIndex = position - Math.floor(position / HEALTH_EVERY) - 1;

    return filterRequest(round * SUPPLY_PER_ROUND + supplyIndex + 1);
  });
}

function percentile(values: readonly number[], value: number) {
  const sorted = [...values].toSorted((left, right) => left - right);

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((value / 100) * sorted.length) - 1),
  );

  return sorted[index] ?? 0;
}

function summarize(samples: readonly number[]) {
  return {
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    p99: Number(percentile(samples, 99).toFixed(2)),
    max: Number(Math.max(...samples).toFixed(2)),
    n: samples.length,
  };
}

function sampleOf(samples: readonly Sample[], matches: (sample: Sample) => boolean) {
  return samples.flatMap((sample) => (matches(sample) ? [sample.ms] : []));
}

interface RunState {
  failures: number;
  roundDurations: number[];
  samples: Sample[];
}

async function warmBurst(base: string, warm: number) {
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, position) => {
      const response = await fetch(
        position % HEALTH_EVERY === 0 ? `${base}/api/health` : `${base}/api/supply`,
        { headers: { "x-forwarded-for": `10.99.${String(warm)}.${String(position)}` } },
      );

      await response.arrayBuffer();
    }),
  );
}

async function runRound(round: number, base: string, state: RunState) {
  if (round >= rounds) {
    return;
  }

  const requests = planRound(round);
  const started = performance.now();

  await Promise.all(
    requests.map(async (request, position) => {
      const response = await fetch(`${base}${request.path}`, {
        headers: { "x-forwarded-for": `10.${String(round)}.${String(position)}.7` },
      });

      await response.arrayBuffer();

      if (response.status !== 200) {
        state.failures += 1;
      }

      state.samples.push({
        kind: request.kind,
        ms: performance.now() - started,
        path: request.path,
      });
    }),
  );

  state.roundDurations.push(Number((performance.now() - started).toFixed(2)));

  await runRound(round + 1, base, state);
}

async function main() {
  const catalog = buildCatalog();

  if (legacy) {
    degradeToLegacy(catalog.db);
  }

  const app = buildApp(catalog.db);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: app.fetch });
  const base = `http://127.0.0.1:${String(server.port)}`;

  try {
    await warmBurst(base, 0);
    await warmBurst(base, 1);

    const state: RunState = { failures: 0, roundDurations: [], samples: [] };

    await runRound(0, base, state);

    const health = summarize(sampleOf(state.samples, (sample) => sample.kind === "health"));
    const supply = summarize(sampleOf(state.samples, (sample) => sample.kind !== "health"));
    const facet = summarize(sampleOf(state.samples, (sample) => sample.kind === "supply-facet"));
    const live = summarize(sampleOf(state.samples, (sample) => sample.kind === "supply-live"));

    process.stdout.write(
      [
        `mode ${legacy ? "legacy (pre-#631 queries)" : "optimized (supply_facets + covering indexes)"}`,
        `catalog rows ${String(rows)}, open+apply-supported ${String(catalog.openSupported)}, facet rows ${String(catalog.facetRows)}`,
        `seed ${catalog.seedMs.toFixed(0)} ms, ${String(rounds)} rounds x ${String(CONCURRENCY)} concurrent, failures ${String(state.failures)}`,
        `health  p50 ${String(health.p50)} ms  p95 ${String(health.p95)} ms  p99 ${String(health.p99)} ms  max ${String(health.max)} ms  (n ${String(health.n)})`,
        `supply  p50 ${String(supply.p50)} ms  p95 ${String(supply.p95)} ms  p99 ${String(supply.p99)} ms  max ${String(supply.max)} ms  (n ${String(supply.n)})`,
        `facet   p50 ${String(facet.p50)} ms  p95 ${String(facet.p95)} ms  p99 ${String(facet.p99)} ms  max ${String(facet.max)} ms  (n ${String(facet.n)})`,
        `live    p50 ${String(live.p50)} ms  p95 ${String(live.p95)} ms  p99 ${String(live.p99)} ms  max ${String(live.max)} ms  (n ${String(live.n)})`,
        `rounds  ${state.roundDurations.join(", ")}`,
        ...state.samples
          .toSorted((left, right) => right.ms - left.ms)
          .slice(0, 8)
          .map((sample) => `slow    ${sample.ms.toFixed(1)} ms ${sample.kind} ${sample.path}`),
        JSON.stringify({
          concurrency: CONCURRENCY,
          failures: state.failures,
          health,
          live,
          mode: legacy ? "legacy" : "optimized",
          rows,
          rounds,
          roundDurations: state.roundDurations,
          supply,
        }),
      ].join("\n"),
    );
  } finally {
    await server.stop(true);
  }
}

await main();
