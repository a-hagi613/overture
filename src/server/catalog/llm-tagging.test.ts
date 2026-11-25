import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { LlmPort, LlmRequest } from "../platform/ports/llm.ts";

import { openCatalogDatabase, openDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "../platform/db/migrate.ts";

Bun.env.BETTER_AUTH_SECRET ??= "llm-tagging-test-secret-0123456789";

Bun.env.OWNER_EMAIL ??= "owner@example.test";

Bun.env.TURNSTILE_SITE_KEY ??= "llm-tagging-test-site-key";

Bun.env.TURNSTILE_SECRET ??= "llm-tagging-test-secret";

Bun.env.MASTER_KEY_V1 ??= Buffer.alloc(32, 7).toString("base64");

const {
  LEFTOVER_SCAN_LIMIT,
  MAX_BATCH_ITEMS,
  TAG_FALLBACK_JOB_KIND,
  YIELD_EVERY,
  runTagFallbackJob,
} = await import("./llm-tagging.ts");

const { nextUtcMidnight } = await import("../platform/llm/caps.ts");

const NOW = 1_800_000_000_000;

const clock = { now: () => NOW };

const tagRowSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  source: z.string(),
});

interface LoggedQuery {
  sql: string;
  params: readonly unknown[];
}

interface SeededPosting {
  id: string;
  title: string;
  companyId?: string;
  department?: string | null;
  description?: string | null;
  tagSource?: "rules" | "model" | "llm" | "import" | null;
  roleTag?: "rules" | "model" | "llm" | null;
  closedAt?: number | null;
}

interface TestDatabases {
  catalog: ReturnType<typeof openCatalogDatabase>;
  app: ReturnType<typeof openDatabase>;
  queries: LoggedQuery[];
}

function openTestDatabases() {
  const queries: LoggedQuery[] = [];

  const catalog = openCatalogDatabase(":memory:", {
    logger: {
      logQuery: (sql, params) => {
        queries.push({ sql, params: [...params] });
      },
    },
  });

  migrateCatalogDatabase(catalog.db, "drizzle-catalog");

  const app = openDatabase(":memory:");

  migrateDatabase(app.db, "drizzle");

  queries.length = 0;

  return { catalog, app, queries } satisfies TestDatabases;
}

function seedCompany(sqlite: TestDatabases["catalog"]["sqlite"], companyId: string) {
  sqlite.run("insert into companies (id, name, name_norm, created_at) values (?, ?, ?, ?)", [
    companyId,
    `Company ${companyId}`,
    `company ${companyId}`,
    NOW,
  ]);
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values (?, ?, 'greenhouse', ?, 'us', 'active', 'v1_seed', ?)",
    [`board-${companyId}`, companyId, `token-${companyId}`, NOW],
  );
}

function descriptionGzFor(description: string | null | undefined) {
  if (description === null || description === undefined) {
    return null;
  }

  return Buffer.from(Bun.gzipSync(description));
}

function seedPosting(sqlite: TestDatabases["catalog"]["sqlite"], posting: SeededPosting) {
  const companyId = posting.companyId ?? "company-1";
  const department = posting.department ?? null;
  const descriptionGz = descriptionGzFor(posting.description);

  sqlite.run(
    `insert into postings (id, board_id, company_id, ats, ats_job_id, url, apply_url_norm, title, title_norm,
       department, description_gz, tag_source, first_seen_at, last_seen_at, dedupe_key, closed_at)
     values (?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      posting.id,
      `board-${companyId}`,
      companyId,
      posting.id,
      `https://boards.example/${posting.id}`,
      `https://boards.example/${posting.id}`,
      posting.title,
      posting.title.toLowerCase(),
      department,
      descriptionGz,
      posting.tagSource ?? null,
      NOW,
      NOW,
      posting.id,
      posting.closedAt ?? null,
    ],
  );

  if (posting.roleTag !== undefined && posting.roleTag !== null) {
    sqlite.run(
      "insert into posting_tags (posting_id, dimension, value, source) values (?, 'role', 'Design', ?)",
      [posting.id, posting.roleTag],
    );
  }
}

function fakeLlm(onBatch?: () => void) {
  const batches: LlmRequest[][] = [];

  return {
    batches,
    port: {
      estimateBatchCostMicros: (requests) => requests.length * 10,
      runBatch: async (requests) => {
        batches.push([...requests]);

        if (onBatch !== undefined) {
          onBatch();
        }

        const calls = requests.map((request) => ({
          customId: request.customId,
          result: { ok: true as const, value: { role: "Design", subrole: null } },
          model: "fake-haiku",
          inputTokens: 1,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          costMicros: 1,
        }));

        await Bun.sleep(0);

        return calls;
      },
      estimateSingleCostMicros: () => 0,
      runSingle: async () => {
        const call = {
          model: "fake-haiku",
          text: null,
          inputTokens: 0,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          costMicros: 0,
        };

        await Bun.sleep(0);

        return call;
      },
    } satisfies LlmPort,
  };
}

function tagRowsFor(sqlite: TestDatabases["catalog"]["sqlite"], postingId: string) {
  return tagRowSchema
    .array()
    .parse(
      sqlite
        .query(
          "select dimension, value, source from posting_tags where posting_id = ? order by dimension",
        )
        .all(postingId),
    );
}

function descriptionQueries(queries: readonly LoggedQuery[]) {
  return queries.filter((query) => query.sql.includes("description_gz"));
}

function leftoverQuery(queries: readonly LoggedQuery[]) {
  return queries.find((query) => query.sql.includes('from "postings" inner join "companies"'));
}

function queuedRuns(app: TestDatabases["app"]) {
  return z
    .array(z.object({ runAt: z.number() }))
    .parse(
      app.sqlite
        .query("select run_at as runAt from bg_jobs where kind = ? and status = 'queued'")
        .all(TAG_FALLBACK_JOB_KIND),
    );
}

describe("runTagFallbackJob", () => {
  test("filters tagged postings in SQL and reads a description only for the batch", async () => {
    const { catalog, app, queries } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");
    seedPosting(catalog.sqlite, {
      id: "posting-tagged",
      title: "Wardrobe Stylist Coordinator",
      description: "TAGGED DESCRIPTION",
      roleTag: "rules",
      tagSource: "rules",
    });
    seedPosting(catalog.sqlite, {
      id: "posting-open",
      title: "Wardrobe Stylist Coordinator",
      description: "OPEN DESCRIPTION",
    });

    const llm = fakeLlm();

    const report = await runTagFallbackJob({
      catalogDb: catalog.db,
      db: app.db,
      clock,
      llm: llm.port,
    });

    expect(report.leftovers).toBe(1);
    expect(llm.batches.length).toBe(1);

    const [batch] = llm.batches;

    expect(batch?.length).toBe(1);
    expect(batch?.[0]?.user).toContain("OPEN DESCRIPTION");
    expect(JSON.stringify(llm.batches)).not.toContain("TAGGED DESCRIPTION");

    const selection = leftoverQuery(queries);

    expect(selection?.sql).not.toContain("description_gz");
    expect(selection?.sql).toContain('"posting_tags"."value" is null');
    expect(selection?.params).toContain(LEFTOVER_SCAN_LIMIT);

    const [descriptionQuery] = descriptionQueries(queries);

    expect(descriptionQueries(queries).length).toBe(1);
    expect(descriptionQuery?.params).toEqual(["posting-open"]);

    expect(tagRowsFor(catalog.sqlite, "posting-tagged")).toEqual([
      { dimension: "role", source: "rules", value: "Design" },
    ]);
    expect(tagRowsFor(catalog.sqlite, "posting-open")).toEqual([
      { dimension: "role", source: "llm", value: "product-design" },
    ]);

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("caps one run at the batch size and queues an early continuation", async () => {
    const { catalog, app, queries } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");

    const leftovers = MAX_BATCH_ITEMS + 100;

    for (let index = 0; index < leftovers; index += 1) {
      seedPosting(catalog.sqlite, {
        id: `posting-${String(index)}`,
        title: `Role ${String(index)}`,
      });
    }

    const llm = fakeLlm();

    const report = await runTagFallbackJob({
      catalogDb: catalog.db,
      db: app.db,
      clock,
      llm: llm.port,
    });

    expect(report.leftovers).toBe(leftovers);
    expect(report.sent).toBe(MAX_BATCH_ITEMS);
    expect(report.tagged).toBe(MAX_BATCH_ITEMS);
    expect(llm.batches.length).toBe(1);
    expect(llm.batches[0]?.length).toBe(MAX_BATCH_ITEMS);
    expect(descriptionQueries(queries).at(-1)?.params.length).toBe(MAX_BATCH_ITEMS);

    const queued = queuedRuns(app);

    expect(queued.length).toBe(1);
    expect(queued[0]?.runAt).toBeGreaterThan(NOW);
    expect(queued[0]?.runAt).toBeLessThan(nextUtcMidnight(NOW));

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("stops the selection at the scan limit", async () => {
    const { catalog, app } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");

    catalog.sqlite.run("BEGIN");

    for (let index = 0; index < LEFTOVER_SCAN_LIMIT + 50; index += 1) {
      seedPosting(catalog.sqlite, {
        id: `posting-${String(index)}`,
        title: `Role ${String(index)}`,
      });
    }

    catalog.sqlite.run("COMMIT");

    const llm = fakeLlm();

    const report = await runTagFallbackJob({
      catalogDb: catalog.db,
      db: app.db,
      clock,
      llm: llm.port,
    });

    expect(report.leftovers).toBe(LEFTOVER_SCAN_LIMIT);
    expect(llm.batches[0]?.length).toBe(MAX_BATCH_ITEMS);
    expect(queuedRuns(app).length).toBe(1);

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("scopes the recorded-tag lookup to the batch's companies", async () => {
    const { catalog, app, queries } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");
    seedCompany(catalog.sqlite, "company-2");
    seedPosting(catalog.sqlite, {
      id: "posting-tagged-elsewhere",
      title: "Wardrobe Stylist Coordinator",
      companyId: "company-1",
      roleTag: "llm",
      tagSource: "llm",
    });
    seedPosting(catalog.sqlite, {
      id: "posting-open",
      title: "Wardrobe Stylist Coordinator",
      companyId: "company-2",
    });

    const llm = fakeLlm();

    await runTagFallbackJob({ catalogDb: catalog.db, db: app.db, clock, llm: llm.port });

    const cacheLookup = queries.find((query) =>
      query.sql.includes('from "posting_tags" inner join "postings"'),
    );

    expect(cacheLookup).toBeDefined();
    expect(cacheLookup?.params).toContain("company-2");
    expect(cacheLookup?.params).not.toContain("company-1");
    expect(llm.batches.length).toBe(1);
    expect(queuedRuns(app).length).toBe(1);

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("does no tag or description read when nothing is left over", async () => {
    const { catalog, app, queries } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");
    seedPosting(catalog.sqlite, {
      id: "posting-tagged",
      title: "Wardrobe Stylist Coordinator",
      tagSource: "rules",
      roleTag: "rules",
    });
    seedPosting(catalog.sqlite, {
      id: "posting-closed",
      title: "Closed Coordinator",
      closedAt: NOW,
    });

    const llm = fakeLlm();

    const report = await runTagFallbackJob({
      catalogDb: catalog.db,
      db: app.db,
      clock,
      llm: llm.port,
    });

    expect(report.leftovers).toBe(0);
    expect(llm.batches).toEqual([]);
    expect(queries.some((query) => query.sql.includes('from "posting_tags" inner join'))).toBe(
      false,
    );
    expect(descriptionQueries(queries)).toEqual([]);
    expect(queuedRuns(app).length).toBe(1);

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("fetches one description for a repeated cache key", async () => {
    const { catalog, app, queries } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");

    for (const [index, description] of ["FIRST", "SECOND", "THIRD"].entries()) {
      seedPosting(catalog.sqlite, {
        id: `posting-${String(index)}`,
        title: "Wardrobe Stylist Coordinator",
        description,
      });
    }

    const llm = fakeLlm();

    const report = await runTagFallbackJob({
      catalogDb: catalog.db,
      db: app.db,
      clock,
      llm: llm.port,
    });

    expect(report.leftovers).toBe(3);
    expect(report.tagged).toBe(3);
    expect(llm.batches.length).toBe(1);
    expect(llm.batches[0]?.length).toBe(1);

    const [descriptionQuery] = descriptionQueries(queries);

    expect(descriptionQuery?.params).toEqual(["posting-0"]);

    catalog.sqlite.close();
    app.sqlite.close();
  });

  test("yields the event loop while it builds a large batch", async () => {
    const { catalog, app } = openTestDatabases();

    seedCompany(catalog.sqlite, "company-1");

    for (let index = 0; index < YIELD_EVERY * 4; index += 1) {
      seedPosting(catalog.sqlite, {
        id: `posting-${String(index)}`,
        title: `Role ${String(index)}`,
        description: `Description ${String(index)}`,
      });
    }

    let timerFired = false;

    setTimeout(() => {
      timerFired = true;
    }, 0);

    let firedBeforeBatch = false;

    const llm = fakeLlm(() => {
      firedBeforeBatch = timerFired;
    });

    await runTagFallbackJob({ catalogDb: catalog.db, db: app.db, clock, llm: llm.port });

    expect(llm.batches[0]?.length).toBe(YIELD_EVERY * 4);
    expect(firedBeforeBatch).toBe(true);

    catalog.sqlite.close();
    app.sqlite.close();
  });
});
