import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { DuckDBInstance } from "@duckdb/node-api";

import type { Ats } from "../../shared/ats.ts";

import type { StapplyIngestRow } from "./stapply-daily.ts";

import {
  STAPPLY_PROJECTED_COLUMNS,
  buildCatalogManifest,
  buildStapplyIngestQuery,
  isRowDrop,
  mapStapplyRecord,
  seedFreshnessCutoffMs,
  stapplyBoardSources,
  streamStapplyIngest,
} from "./stapply-daily.ts";

const NOW = Date.parse("2026-11-23T15:30:00.000Z");
const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const COLUMNS: readonly (readonly [string, string])[] = [
  ["global_id", "VARCHAR"],
  ["ats_id", "VARCHAR"],
  ["company", "VARCHAR"],
  ["requisition_id", "VARCHAR"],
  ["url", "VARCHAR"],
  ["apply_url", "VARCHAR"],
  ["title", "VARCHAR"],
  ["department", "VARCHAR"],
  ["team", "VARCHAR"],
  ["location", "VARCHAR"],
  ["country_iso", "VARCHAR"],
  ["language", "VARCHAR"],
  ["is_remote", "BOOLEAN"],
  ["workplace_type", "VARCHAR"],
  ["employment_type", "VARCHAR"],
  ["commitment", "VARCHAR"],
  ["experience", "BIGINT"],
  ["posted_at", "VARCHAR"],
  ["source_updated_at", "VARCHAR"],
  ["application_deadline", "VARCHAR"],
  ["salary_min", "DOUBLE"],
  ["salary_max", "DOUBLE"],
  ["salary_currency", "VARCHAR"],
  ["salary_period", "VARCHAR"],
  ["salary_summary", "VARCHAR"],
  ["region", "VARCHAR"],
  ["locations", "VARCHAR"],
  ["job_category", "VARCHAR"],
  ["skill_requirements", "VARCHAR"],
  ["description", "VARCHAR"],
  ["raw", "VARCHAR"],
];

type FixtureRow = Readonly<Record<string, string | number | boolean | null>>;

function fixtureRow(overrides: FixtureRow = {}) {
  return {
    global_id: crypto.randomUUID(),
    ats_id: crypto.randomUUID(),
    company: "Acme Robotics",
    requisition_id: "R-100",
    url: "https://boards.example/acme/jobs/100",
    apply_url: null,
    title: "Senior Backend Engineer",
    department: "Engineering",
    team: "Platform",
    location: "Toronto, ON, Canada",
    country_iso: "CA",
    language: "en",
    is_remote: true,
    workplace_type: null,
    employment_type: "FULL_TIME",
    commitment: null,
    experience: 6,
    posted_at: "2026-11-20T10:00:00Z",
    source_updated_at: "2026-11-20T10:00:00Z",
    application_deadline: null,
    salary_min: 120_000,
    salary_max: 160_000,
    salary_currency: "CAD",
    salary_period: "YEAR",
    salary_summary: "CAD 120,000 - 160,000",
    description: "a description that must never be read",
    raw: '{"must":"never be read"}',
    ...overrides,
  };
}

function sqlLiteral(value: string | number | boolean | null) {
  if (value === null) {
    return "NULL";
  }

  if (value === true) {
    return "TRUE";
  }

  if (value === false) {
    return "FALSE";
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) && value !== "" && String(numeric) === String(value).trim()
    ? String(numeric)
    : `'${String(value).replaceAll("'", "''")}'`;
}

async function writeBoardParquet(directory: string, ats: string, rows: readonly FixtureRow[]) {
  mkdirSync(join(directory, ats), { recursive: true });

  const file = join(directory, ats, "jobs.parquet");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await connection.run(
      `CREATE TABLE fixture (${COLUMNS.map(([name, type]) => `${name} ${type}`).join(", ")})`,
    );

    if (rows.length > 0) {
      const values = rows
        .map((row) => `(${COLUMNS.map(([name]) => sqlLiteral(row[name] ?? null)).join(", ")})`)
        .join(", ");

      await connection.run(`INSERT INTO fixture VALUES ${values}`);
    }

    await connection.run(`COPY fixture TO '${file}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  } finally {
    instance.closeSync();
  }

  return file;
}

function board(ats: Ats, url: string, applySupported: boolean) {
  return { ats, url, applySupported };
}

async function readFixtureRows(
  boards: readonly { ats: Ats; url: string; applySupported: boolean }[],
  freshnessCutoffMs: number | null = null,
) {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  const rows: StapplyIngestRow[] = [];

  try {
    await connection.run("SET TimeZone = 'UTC'");

    const sql = buildStapplyIngestQuery({ boards, freshnessCutoffMs });

    const streamed = await streamStapplyIngest({
      connection,
      sql,
      onRow: (row) => {
        rows.push(row);
      },
    });

    return { rows, streamed, sql };
  } finally {
    instance.closeSync();
  }
}

function scratchDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "stapply-daily-"));
  scratchDirectories.push(directory);

  return directory;
}

describe("buildStapplyIngestQuery", () => {
  test("projects only the catalog columns and reads each board's own parquet", () => {
    const sql = buildStapplyIngestQuery({
      boards: stapplyBoardSources("https://storage.example/jobs"),
      freshnessCutoffMs: null,
    });

    expect(STAPPLY_PROJECTED_COLUMNS).not.toContain("description");
    expect(STAPPLY_PROJECTED_COLUMNS).not.toContain("raw");
    expect(STAPPLY_PROJECTED_COLUMNS).toContain("job_category");
    expect(STAPPLY_PROJECTED_COLUMNS).toContain("region");
    expect(STAPPLY_PROJECTED_COLUMNS).toContain("locations");
    expect(STAPPLY_PROJECTED_COLUMNS).toContain("skill_requirements");
    expect(sql).not.toMatch(/\bdescription\b/u);
    expect(sql).not.toMatch(/\braw\b/u);
    expect(sql).not.toMatch(/read_parquet\('[^']*all\.parquet/iu);
    expect(sql).toContain("https://storage.example/jobs/greenhouse/jobs.parquet");
    expect(sql).toContain("https://storage.example/jobs/varbi/jobs.parquet");
    expect(sql).toContain("https://storage.example/jobs/jobvite/jobs.parquet");
    expect(sql).toContain("https://storage.example/jobs/herp/jobs.parquet");
    expect(sql.match(/read_parquet\(/gu) ?? []).toHaveLength(30);
  });

  test("adds the seed horizon only when one is given", () => {
    const withoutCutoff = buildStapplyIngestQuery({
      boards: stapplyBoardSources("https://storage.example/jobs"),
      freshnessCutoffMs: null,
    });

    const withCutoff = buildStapplyIngestQuery({
      boards: stapplyBoardSources("https://storage.example/jobs"),
      freshnessCutoffMs: seedFreshnessCutoffMs(NOW),
    });

    expect(withoutCutoff).not.toContain("posted_at_ms >=");
    expect(withCutoff).toContain(`posted_at_ms >= ${String(NOW - 30 * 86_400_000)}`);
  });

  test("quotes a URL that contains a single quote", () => {
    const sql = buildStapplyIngestQuery({
      boards: [board("greenhouse", "https://x.example/it's/jobs.parquet", true)],
      freshnessCutoffMs: null,
    });

    expect(sql).toContain(`read_parquet('https://x.example/it''s/jobs.parquet')`);
  });
});

describe("streamStapplyIngest", () => {
  test("applies the https, title, deadline and freshness filters and maps the row", async () => {
    const directory = scratchDirectory();

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ats_id: "kept", requisition_id: "R-1" }),
      fixtureRow({ ats_id: "http-link", requisition_id: "R-2", url: "http://insecure.example/1" }),
      fixtureRow({ ats_id: "blank-title", requisition_id: "R-3", title: "   " }),
      fixtureRow({
        ats_id: "expired",
        requisition_id: "R-4",
        application_deadline: "2026-11-01T00:00:00Z",
      }),
      fixtureRow({
        ats_id: "future-deadline",
        requisition_id: "R-5",
        application_deadline: "2027-01-01T00:00:00Z",
      }),
      fixtureRow({ ats_id: "old", requisition_id: "R-6", posted_at: "2026-09-01T00:00:00Z" }),
    ]);

    const { rows, streamed } = await readFixtureRows(
      [board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true)],
      seedFreshnessCutoffMs(NOW),
    );

    const ids = rows.map((row) => row.atsJobId);

    expect(ids.toSorted()).toEqual(["future-deadline", "kept"]);
    expect(streamed.rows).toBe(2);
    expect(streamed.skipped).toBe(0);

    const kept = rows.find((row) => row.atsJobId === "kept");

    expect(kept?.companyNorm).toBe("acme robotics");
    expect(kept?.boardToken.startsWith("acme-robotics-")).toBe(true);
    expect(kept?.applyUrl).toBeNull();
    expect(kept?.applyUrlNorm).toBe("https://boards.example/acme/jobs/100");
    expect(kept?.salaryMinMinor).toBe(12_000_000);
    expect(kept?.salaryMaxMinor).toBe(16_000_000);
    expect(kept?.salaryPeriod).toBe("year");
    expect(kept?.workplace).toBe("remote");
    expect(kept?.employmentType).toBe("full_time");
    expect(kept?.roleTag).toBe("Software Engineering");
    expect(kept?.subroleTag).toBe("Backend");
    expect(kept?.postedAt).toBe(Date.parse("2026-11-20T10:00:00Z"));
    expect(kept?.experience).toBe("6");
    expect(kept?.isRemote).toBe(true);
    expect(kept?.contentHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("prefers the apply-supported board for the same company and requisition", async () => {
    const directory = scratchDirectory();

    const shared = {
      company: "Northwind Systems",
      requisition_id: "ENG-7",
      title: "Data Engineer",
    };

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ...shared, ats_id: "gh-1", source_updated_at: "2026-11-18T00:00:00Z" }),
    ]);
    await writeBoardParquet(directory, "smartrecruiters", [
      fixtureRow({ ...shared, ats_id: "sr-1", source_updated_at: "2026-11-22T00:00:00Z" }),
    ]);

    const { rows } = await readFixtureRows([
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
      board("smartrecruiters", join(directory, "smartrecruiters", "jobs.parquet"), false),
    ]);

    expect(rows.map((row) => row.atsJobId)).toEqual(["gh-1"]);
    expect(rows[0]?.applySupported).toBe(true);
  });

  test("keeps the newest source update when both duplicates are apply-supported", async () => {
    const directory = scratchDirectory();

    const shared = {
      company: "Northwind Systems",
      requisition_id: "ENG-8",
      title: "Data Engineer",
    };

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ...shared, ats_id: "older", source_updated_at: "2026-11-18T00:00:00Z" }),
    ]);
    await writeBoardParquet(directory, "lever", [
      fixtureRow({ ...shared, ats_id: "newer", source_updated_at: "2026-11-22T00:00:00Z" }),
    ]);

    const { rows } = await readFixtureRows([
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
      board("lever", join(directory, "lever", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId)).toEqual(["newer"]);
  });

  test("keeps one row per board job id even when the requisition ids differ", async () => {
    const directory = scratchDirectory();

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ats_id: "same-job", requisition_id: "R-1" }),
      fixtureRow({ ats_id: "same-job", requisition_id: "R-2" }),
    ]);

    const { rows } = await readFixtureRows([
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId)).toEqual(["same-job"]);
  });

  test("keeps rows without a requisition id and never collapses distinct postings", async () => {
    const directory = scratchDirectory();

    await writeBoardParquet(directory, "lever", [
      fixtureRow({ ats_id: "a", requisition_id: null }),
      fixtureRow({ ats_id: "b", requisition_id: null }),
      fixtureRow({ ats_id: "c", requisition_id: "" }),
    ]);

    const { rows } = await readFixtureRows([
      board("lever", join(directory, "lever", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId).toSorted()).toEqual(["a", "b", "c"]);
  });

  test("collapses a cross-board mirror without a requisition when the strict title and location match", async () => {
    const directory = scratchDirectory();

    const shared = {
      company: "Northwind Systems",
      requisition_id: null,
      title: "Data Engineer",
      location: "Berlin, DE",
      country_iso: "DE",
    };

    await writeBoardParquet(directory, "varbi", [
      fixtureRow({ ...shared, ats_id: "varbi-1", source_updated_at: "2026-11-22T00:00:00Z" }),
    ]);
    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ...shared, ats_id: "gh-1", source_updated_at: "2026-11-18T00:00:00Z" }),
    ]);

    const { rows } = await readFixtureRows([
      board("varbi", join(directory, "varbi", "jobs.parquet"), true),
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId)).toEqual(["gh-1"]);
  });

  test("keeps distinct levels and seniority apart when the requisition is null", async () => {
    const directory = scratchDirectory();

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ats_id: "level-2", requisition_id: null, title: "Engineer II" }),
      fixtureRow({ ats_id: "level-3", requisition_id: null, title: "Engineer III" }),
      fixtureRow({ ats_id: "senior", requisition_id: null, title: "Senior Data Engineer" }),
      fixtureRow({ ats_id: "plain", requisition_id: null, title: "Data Engineer" }),
    ]);

    const { rows } = await readFixtureRows([
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId).toSorted()).toEqual([
      "level-2",
      "level-3",
      "plain",
      "senior",
    ]);
  });

  test("treats a junk requisition as absent and still keeps different titles apart", async () => {
    const directory = scratchDirectory();

    await writeBoardParquet(directory, "greenhouse", [
      fixtureRow({ ats_id: "data", requisition_id: "n/a", title: "Data Engineer" }),
      fixtureRow({ ats_id: "marketing", requisition_id: "n/a", title: "Marketing Manager" }),
    ]);

    const { rows } = await readFixtureRows([
      board("greenhouse", join(directory, "greenhouse", "jobs.parquet"), true),
    ]);

    expect(rows.map((row) => row.atsJobId).toSorted()).toEqual(["data", "marketing"]);
  });
});

describe("mapStapplyRecord", () => {
  test("rejects a record that does not match the projected schema", () => {
    expect(mapStapplyRecord({ title: "only a title" })).toBeNull();
  });

  test("maps the feed's employment and salary spellings", () => {
    const record = {
      source_key: "onlyfy",
      apply_supported: false,
      global_id: "g1",
      ats_id: "o1",
      company: "A-ROSA Flussschiff GmbH",
      company_norm: "a-rosa flussschiff gmbh",
      requisition_id: null,
      url: "https://example.onlyfy.jobs/job/o1",
      apply_url: "https://example.onlyfy.jobs/job/o1/apply",
      title: "Zookeeper",
      department: null,
      team: null,
      location: "Rostock",
      country_iso: "DE",
      language: "de",
      is_remote: false,
      workplace_type: null,
      employment_type: "parttime",
      commitment: null,
      experience: null,
      posted_at_ms: NOW,
      source_updated_at_ms: NOW,
      application_deadline_ms: null,
      salary_min: 20,
      salary_max: 30,
      salary_currency: "eur",
      salary_period: "hourly",
      salary_summary: null,
    };

    const row = mapStapplyRecord(record);

    expect(row?.employmentType).toBe("part_time");
    expect(row?.salaryMinMinor).toBe(2000);
    expect(row?.salaryMaxMinor).toBe(3000);
    expect(row?.salaryPeriod).toBe("hour");
    expect(row?.roleTag).toBeNull();
    expect(row?.applySupported).toBe(false);
  });

  test("ignores the O*NET similarity fallback so a full snapshot stays affordable", () => {
    const record = {
      source_key: "greenhouse",
      apply_supported: true,
      global_id: "g2",
      ats_id: "h2",
      company: "Acme Robotics",
      company_norm: "acme robotics",
      requisition_id: "R1",
      url: "https://example.com/2",
      apply_url: null,
      title: "Chief Happiness Orchestrator",
      department: null,
      team: null,
      location: "Remote",
      country_iso: null,
      language: "en",
      is_remote: true,
      workplace_type: null,
      employment_type: null,
      commitment: null,
      experience: null,
      posted_at_ms: NOW,
      source_updated_at_ms: NOW,
      application_deadline_ms: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      salary_summary: null,
    };

    expect(mapStapplyRecord(record)?.roleTag).toBeNull();
  });
});

describe("manifest", () => {
  test("hashes the uncompressed SQLite bytes and validates the contract", () => {
    const bytes = new TextEncoder().encode("sqlite-bytes");

    const manifest = buildCatalogManifest({
      version: "2026-11-23",
      builtAt: "2026-11-23T15:30:00.000Z",
      sqliteBytes: bytes,
      rowCount: 12,
      supportedCount: 7,
    });

    expect(manifest).toEqual({
      version: "2026-11-23",
      sha256: "6a70d98b55f71fa10b6d012fbd7aebc45daa182bf722e9b7f07f855dabf2703f",
      builtAt: "2026-11-23T15:30:00.000Z",
      rowCount: 12,
      supportedCount: 7,
    });
  });

  test("refuses a version that is not a date", () => {
    expect(() =>
      buildCatalogManifest({
        version: "latest",
        builtAt: "2026-11-23T15:30:00.000Z",
        sqliteBytes: new Uint8Array([1]),
        rowCount: 1,
        supportedCount: 1,
      }),
    ).toThrow();
  });
});

describe("isRowDrop", () => {
  test("refuses a snapshot more than 20 % smaller than the previous one", () => {
    expect(isRowDrop(1000, 799, false)).toBe(true);
    expect(isRowDrop(1000, 800, false)).toBe(false);
    expect(isRowDrop(1000, 100, true)).toBe(false);
    expect(isRowDrop(null, 1, false)).toBe(false);
  });
});
