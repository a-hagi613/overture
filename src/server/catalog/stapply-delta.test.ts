import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import type { DuckDBValue } from "@duckdb/node-api";

import type { CatalogDatabase } from "../platform/db/client.ts";

import { openCatalogDatabase } from "../platform/db/client.ts";
import { migrateCatalogDatabase } from "../platform/db/migrate.ts";
import type { Ats } from "../../shared/ats.ts";

import {
  applyStapplyDelta,
  countPostings,
  countSupportedPostings,
  createStapplyStaging,
  dropStapplyStaging,
  selectStapplyLeftovers,
  stageStapplyRows,
  tagSourceSummary,
  unresolvedRoleCount,
} from "./stapply-delta.ts";
import { mapStapplyRecord } from "./stapply-daily.ts";
import { runStapplyLlmTagging } from "./stapply-tagging.ts";
import { writePostingTags } from "./tag-store.ts";

const NOW = Date.parse("2026-11-23T15:30:00.000Z");
const DAY_MS = 86_400_000;
const handles: { db: CatalogDatabase; sqlite: { close: () => void } }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) {
    handle.sqlite.close();
  }
});

function catalogDatabase() {
  const handle = openCatalogDatabase(":memory:");

  migrateCatalogDatabase(handle.db, "drizzle-catalog");
  handles.push(handle);

  return handle.db;
}

type Fixture = Readonly<Record<string, DuckDBValue>>;

function fixture(overrides: Fixture = {}) {
  return {
    source_key: "greenhouse",
    apply_supported: true,
    global_id: crypto.randomUUID(),
    ats_id: "job-1",
    company: "Acme Robotics",
    company_norm: "acme robotics",
    requisition_id: "R-1",
    url: "https://boards.example/acme/jobs/1",
    apply_url: null,
    title: "Senior Backend Engineer",
    department: "Engineering",
    team: "Platform",
    location: "Toronto, ON, Canada",
    country_iso: "CA",
    language: "en",
    is_remote: false,
    workplace_type: null,
    employment_type: "FULL_TIME",
    commitment: null,
    experience: 5,
    posted_at_ms: NOW - DAY_MS,
    source_updated_at_ms: NOW - DAY_MS,
    application_deadline_ms: null,
    salary_min: 120_000,
    salary_max: 160_000,
    salary_currency: "CAD",
    salary_period: "YEAR",
    salary_summary: null,
    ...overrides,
  };
}

function ingestRow(overrides: Fixture = {}) {
  const row = mapStapplyRecord(fixture(overrides));

  if (row === null) {
    throw new Error("the fixture row did not map");
  }

  return row;
}

function stage(db: CatalogDatabase, rows: readonly ReturnType<typeof ingestRow>[]) {
  createStapplyStaging(db);
  stageStapplyRows(db, rows);
}

function runDelta(db: CatalogDatabase, staged: readonly ReturnType<typeof ingestRow>[]) {
  const boards = [...new Set(staged.map((row) => row.sourceKey))].flatMap((sourceKey) => {
    const rows = staged.filter((row) => row.sourceKey === sourceKey).length;

    return [{ ats: sourceKey satisfies Ats, rows }];
  });

  return applyStapplyDelta(db, {
    now: NOW,
    boards,
    pruneClosedBeforeMs: NOW - 30 * DAY_MS,
    tagSupportedOnly: true,
  });
}

const storedPostingSchema = z.object({
  id: z.string(),
  status: z.string(),
  content_hash: z.string(),
  tag_source: z.string().nullable(),
  first_seen_at: z.number(),
});

const storedTagSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  source: z.string(),
});

function postingFor(db: CatalogDatabase, atsJobId: string) {
  const parsed = storedPostingSchema.safeParse(
    db.$client
      .query(
        "SELECT id, status, content_hash, tag_source, first_seen_at FROM postings WHERE ats_job_id = ?",
      )
      .get(atsJobId),
  );

  return parsed.success ? parsed.data : null;
}

function tagsFor(db: CatalogDatabase, postingId: string) {
  return z
    .array(storedTagSchema)
    .parse(
      db.$client
        .query(
          "SELECT dimension, value, source FROM posting_tags WHERE posting_id = ? ORDER BY dimension",
        )
        .all(postingId),
    );
}

describe("applyStapplyDelta", () => {
  test("creates the company, board and postings and writes the rule tags", () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({ ats_id: "job-2", requisition_id: "R-2" }),
    ];

    stage(db, rows);
    const report = runDelta(db, rows);

    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.unchanged).toBe(0);
    expect(report.tagged).toBe(2);
    expect(countPostings(db)).toBe(2);
    expect(countSupportedPostings(db)).toBe(2);
    expect(tagSourceSummary(db)).toEqual([{ source: "rules", count: 2 }]);

    const company = db.$client.query("SELECT name, name_norm FROM companies").get();

    expect(company).toEqual({ name: "Acme Robotics", name_norm: "acme robotics" });

    const board = z
      .object({
        ats: z.string(),
        board_token: z.string(),
        region: z.string(),
        status: z.string(),
        source: z.string(),
      })
      .parse(
        db.$client
          .query("SELECT ats, board_token, region, status, source FROM company_boards")
          .get(),
      );

    expect(board).toMatchObject({
      ats: "greenhouse",
      region: "us",
      status: "active",
      source: "import",
    });
    expect(board.board_token.startsWith("acme-robotics-")).toBe(true);

    const posting = postingFor(db, "job-1");

    expect(posting?.status).toBe("open");
    expect(posting?.tag_source).toBe("rules");
    expect(posting?.content_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(tagsFor(db, posting?.id ?? "")).toEqual([
      { dimension: "role", value: "Software Engineering", source: "rules" },
      { dimension: "seniority", value: "senior", source: "rules" },
      { dimension: "subrole", value: "Backend", source: "rules" },
    ]);
  });

  test("a rerun with the same content inserts nothing, keeps the posting id and preserves an LLM tag", () => {
    const db = catalogDatabase();

    const first = [ingestRow({ ats_id: "job-1" })];

    stage(db, first);
    runDelta(db, first);
    dropStapplyStaging(db);

    const posting = postingFor(db, "job-1");

    writePostingTags(
      db,
      posting?.id ?? "",
      [{ dimension: "role", value: "Legal", source: "import" }],
      NOW,
    );

    const second = [ingestRow({ ats_id: "job-1" })];

    stage(db, second);
    const report = runDelta(db, second);

    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.unchanged).toBe(1);
    expect(report.tagged).toBe(0);
    expect(postingFor(db, "job-1")?.id).toBe(posting?.id);
    expect(tagsFor(db, posting?.id ?? "")).toContainEqual({
      dimension: "role",
      value: "Legal",
      source: "import",
    });
    expect(postingFor(db, "job-1")?.tag_source).toBe("import");
  });

  test("a changed content hash rewrites the row and re-tags it", () => {
    const db = catalogDatabase();

    const first = [ingestRow({ ats_id: "job-1" })];

    stage(db, first);
    runDelta(db, first);
    dropStapplyStaging(db);

    const before = postingFor(db, "job-1");

    writePostingTags(
      db,
      before?.id ?? "",
      [{ dimension: "role", value: "Legal", source: "llm" }],
      NOW,
    );

    const second = [ingestRow({ ats_id: "job-1", title: "Staff Backend Engineer" })];

    stage(db, second);
    const report = runDelta(db, second);

    expect(report.updated).toBe(1);
    expect(postingFor(db, "job-1")?.content_hash).not.toBe(before?.content_hash);

    const tags = tagsFor(db, before?.id ?? "");

    expect(tags).toContainEqual({
      dimension: "role",
      value: "Software Engineering",
      source: "rules",
    });
    expect(tags).not.toContainEqual({ dimension: "role", value: "Legal", source: "llm" });
  });

  test("closes a posting the board no longer lists and prunes one closed for more than 30 days", () => {
    const db = catalogDatabase();

    const first = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({ ats_id: "job-2", requisition_id: "R-2" }),
    ];

    stage(db, first);
    runDelta(db, first);
    dropStapplyStaging(db);

    const second = [ingestRow({ ats_id: "job-1" })];

    stage(db, second);
    const report = runDelta(db, second);

    expect(report.closed).toBe(1);

    const closed = postingFor(db, "job-2");

    expect(closed?.status).toBe("closed");

    db.$client
      .query("UPDATE postings SET closed_at = ? WHERE ats_job_id = ?")
      .run(NOW - 40 * DAY_MS, "job-2");

    dropStapplyStaging(db);

    const third = [ingestRow({ ats_id: "job-1" })];

    stage(db, third);
    const pruned = runDelta(db, third);

    expect(pruned.pruned).toBe(1);
    expect(postingFor(db, "job-2")).toBeNull();
  });

  test("reopens a posting that returns with the same content", () => {
    const db = catalogDatabase();

    const first = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({ ats_id: "job-2", requisition_id: "R-2" }),
    ];

    stage(db, first);
    runDelta(db, first);
    dropStapplyStaging(db);

    const withoutOne = [ingestRow({ ats_id: "job-1" })];

    stage(db, withoutOne);
    runDelta(db, withoutOne);
    dropStapplyStaging(db);

    expect(postingFor(db, "job-2")?.status).toBe("closed");

    const firstSeenAt = postingFor(db, "job-2")?.first_seen_at;

    const returning = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({ ats_id: "job-2", requisition_id: "R-2" }),
    ];

    stage(db, returning);
    const report = runDelta(db, returning);

    expect(report.reopened).toBe(1);
    expect(postingFor(db, "job-2")?.status).toBe("open");
    expect(postingFor(db, "job-2")?.first_seen_at).toBe(firstSeenAt);
  });

  test("collapses the same requisition across boards, preferring the apply-supported one", () => {
    const db = catalogDatabase();

    const shared = {
      company: "Northwind Systems",
      company_norm: "northwind systems",
      requisition_id: "ENG-7",
    };

    const rows = [
      ingestRow({
        ...shared,
        ats_id: "sr-1",
        source_key: "smartrecruiters",
        apply_supported: false,
        source_updated_at_ms: NOW,
      }),
      ingestRow({
        ...shared,
        ats_id: "gh-1",
        source_key: "greenhouse",
        apply_supported: true,
        source_updated_at_ms: NOW - DAY_MS,
      }),
    ];

    stage(db, rows);
    const report = runDelta(db, rows);

    expect(report.duplicates).toBe(1);
    expect(report.inserted).toBe(1);
    expect(
      z
        .object({ ats: z.string(), job: z.string() })
        .parse(db.$client.query("SELECT ats, ats_job_id AS job FROM postings").get()),
    ).toEqual({ ats: "greenhouse", job: "gh-1" });
  });

  test("gives companies whose names slugify alike their own board", () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1", company: "Acme Inc.", company_norm: "acme inc." }),
      ingestRow({
        ats_id: "job-2",
        company: "Acme Inc",
        company_norm: "acme inc",
        requisition_id: "R-2",
      }),
    ];

    stage(db, rows);
    const report = runDelta(db, rows);

    expect(report.inserted).toBe(2);
    expect(
      z
        .object({ n: z.number() })
        .parse(db.$client.query("SELECT count(*) AS n FROM company_boards").get()),
    ).toEqual({ n: 2 });
  });

  test("does not tag an ingest-only board when the supported-only policy is on", () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({
        ats_id: "job-9",
        source_key: "smartrecruiters",
        apply_supported: false,
        company: "Northwind Systems",
        company_norm: "northwind systems",
        requisition_id: "SR-1",
      }),
    ];

    stage(db, rows);
    const report = runDelta(db, rows);

    expect(report.inserted).toBe(2);
    expect(report.tagged).toBe(1);
    expect(postingFor(db, "job-9")?.tag_source).toBeNull();
    expect(tagsFor(db, postingFor(db, "job-9")?.id ?? "")).toEqual([]);
  });

  test("a board that returned no rows closes nothing", () => {
    const db = catalogDatabase();

    const first = [ingestRow({ ats_id: "job-1" })];

    stage(db, first);
    runDelta(db, first);
    dropStapplyStaging(db);

    stage(db, []);

    const report = applyStapplyDelta(db, {
      now: NOW + DAY_MS,
      boards: [],
      pruneClosedBeforeMs: NOW,
      tagSupportedOnly: true,
    });

    expect(report.closed).toBe(0);
    expect(postingFor(db, "job-1")?.status).toBe("open");
  });
});

describe("runStapplyLlmTagging", () => {
  test("tags only new postings whose role the rules left unresolved", async () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1" }),
      ingestRow({ ats_id: "job-2", requisition_id: "R-2", title: "Zookeeper", department: null }),
    ];

    stage(db, rows);
    runDelta(db, rows);

    const leftovers = selectStapplyLeftovers(db, 10);

    expect(leftovers.map((row) => row.title)).toEqual(["Zookeeper"]);
    expect(unresolvedRoleCount(db)).toBe(1);

    const report = await runStapplyLlmTagging({
      db,
      classifier: async (items) => {
        await Promise.resolve();

        return items.map((item) => ({ id: item.id, role: "Operations", subrole: null }));
      },
      now: NOW,
      limit: 10,
      batchSize: 25,
    });

    expect(report).toEqual({
      considered: 1,
      sent: 1,
      tagged: 1,
      skipped: 0,
      available: true,
    });

    const tagged = postingFor(db, "job-2");

    expect(tagged?.tag_source).toBe("llm");
    expect(tagsFor(db, tagged?.id ?? "")).toContainEqual({
      dimension: "role",
      value: "Operations",
      source: "llm",
    });
  });

  test("degrades cleanly without a classifier and on a failed batch", async () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1", title: "Zookeeper", department: null, requisition_id: "R-9" }),
    ];

    stage(db, rows);
    runDelta(db, rows);

    const unavailable = await runStapplyLlmTagging({
      db,
      classifier: null,
      now: NOW,
      limit: 10,
      batchSize: 25,
    });

    expect(unavailable).toEqual({
      considered: 1,
      sent: 0,
      tagged: 0,
      skipped: 1,
      available: false,
    });

    const failed = await runStapplyLlmTagging({
      db,
      classifier: async () => {
        await Promise.resolve();

        throw new Error("HTTP 500");
      },
      now: NOW,
      limit: 10,
      batchSize: 25,
    });

    expect(failed).toEqual({
      considered: 1,
      sent: 0,
      tagged: 0,
      skipped: 1,
      available: true,
    });
  });

  test("the leftover query needs the staging tables, so tagging runs before they are dropped", () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1", title: "Zookeeper", department: null, requisition_id: "R-1" }),
    ];

    stage(db, rows);
    runDelta(db, rows);

    expect(selectStapplyLeftovers(db, 10)).toHaveLength(1);

    dropStapplyStaging(db);

    expect(() => selectStapplyLeftovers(db, 10)).toThrow(/no such table/u);
  });

  test("honours the run's row ceiling", async () => {
    const db = catalogDatabase();

    const rows = [
      ingestRow({ ats_id: "job-1", title: "Zookeeper", department: null, requisition_id: "R-1" }),
      ingestRow({ ats_id: "job-2", title: "Beekeeper", department: null, requisition_id: "R-2" }),
    ];

    stage(db, rows);
    runDelta(db, rows);

    const report = await runStapplyLlmTagging({
      db,
      classifier: async (items) => {
        await Promise.resolve();

        return items.map((item) => ({ id: item.id, role: "Operations", subrole: null }));
      },
      now: NOW,
      limit: 1,
      batchSize: 25,
    });

    expect(report.considered).toBe(1);
    expect(report.tagged).toBe(1);
  });
});
