import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { openDatabase } from "./client.ts";
import { migrateDatabase } from "./migrate.ts";

const SNAPSHOT_MIGRATION = "0056_snapshot_decouple";

const journalSchema = z.object({
  entries: z.array(z.looseObject({ idx: z.number(), tag: z.string(), when: z.number() })),
  version: z.string(),
});

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function migrationsBeforeSnapshot() {
  const directory = mkdtempSync(join(tmpdir(), "snapshot-migration-"));
  scratchDirectories.push(directory);

  const journal = journalSchema.parse(
    JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")),
  );

  const before = journal.entries.filter((entry) => entry.tag !== SNAPSHOT_MIGRATION);

  if (before.length === journal.entries.length) {
    throw new Error(`migration ${SNAPSHOT_MIGRATION} is missing from the journal`);
  }

  cpSync("drizzle/meta", join(directory, "meta"), { recursive: true });

  for (const entry of before) {
    cpSync(join("drizzle", `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
  }

  writeFileSync(
    join(directory, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: before }, null, 2),
  );

  return directory;
}

const applicationRowSchema = z.object({
  applyUrl: z.string().nullable(),
  ats: z.string().nullable(),
  companyDomain: z.string().nullable(),
  companyName: z.string(),
  companyNameNorm: z.string(),
  locationRaw: z.string().nullable(),
  postingTitle: z.string(),
  postingUrl: z.string(),
  salaryCurrency: z.string().nullable(),
  salaryMaxMinor: z.number().nullable(),
  salaryMinMinor: z.number().nullable(),
  salaryPeriod: z.string().nullable(),
});

function countOf(sqlite: ReturnType<typeof openDatabase>["sqlite"], table: string) {
  return z
    .object({ total: z.number() })
    .parse(sqlite.query(`select count(*) as total from ${table}`).get()).total;
}

function readApplication(sqlite: ReturnType<typeof openDatabase>["sqlite"], id: string) {
  return applicationRowSchema.parse(
    sqlite
      .query(
        `select ats, company_name as companyName, company_name_norm as companyNameNorm,
           company_domain as companyDomain, posting_title as postingTitle,
           posting_url as postingUrl, apply_url as applyUrl, location_raw as locationRaw,
           salary_currency as salaryCurrency, salary_min_minor as salaryMinMinor,
           salary_max_minor as salaryMaxMinor, salary_period as salaryPeriod
         from applications where id = ?`,
      )
      .get(id),
  );
}

const NOW = 1_800_000_000_000;

function seedCatalog(sqlite: ReturnType<typeof openDatabase>["sqlite"], companyId: string) {
  sqlite.run(
    "insert into companies (id, name, name_norm, domain, created_at) values (?, ?, ?, ?, ?)",
    [companyId, "Ferro Cloud", "ferro cloud", "ferro.example", NOW],
  );
  sqlite.run(
    "insert into company_boards (id, company_id, ats, board_token, region, status, source, created_at) values (?, ?, 'greenhouse', ?, 'us', 'active', 'v1_seed', ?)",
    [`board-${companyId}`, companyId, `token-${companyId}`, NOW],
  );
}

describe("the snapshot migration", () => {
  test("backfills the display snapshot from the catalog onto every existing Application", () => {
    const { db, sqlite } = openDatabase(":memory:");

    migrateDatabase(db, migrationsBeforeSnapshot());

    sqlite.run(
      "insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)",
      ["user-1", "Owner", "owner@example.test", NOW, NOW],
    );
    seedCatalog(sqlite, "company-1");
    sqlite.run(
      "insert into postings (id, board_id, company_id, ats, ats_job_id, url, apply_url, apply_url_norm, title, title_norm, location_raw, salary_min_minor, salary_max_minor, salary_currency, salary_period, first_seen_at, last_seen_at, dedupe_key) values (?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "posting-1",
        "board-company-1",
        "company-1",
        "job-1",
        "https://boards.example/jobs/1",
        "https://boards.example/jobs/1/apply",
        "https://boards.example/jobs/1",
        "Senior Platform Engineer",
        "senior platform engineer",
        "Remote — Canada",
        16_000_000,
        19_000_000,
        "CAD",
        "year",
        NOW,
        NOW,
        "greenhouse:job-1",
      ],
    );
    sqlite.run("PRAGMA foreign_keys = OFF");
    sqlite.run(
      "insert into applications (id, user_id, posting_id, company_id, origin, status, created_at, updated_at) values (?, ?, ?, ?, 'auto', 'sent', ?, ?)",
      ["application-1", "user-1", "posting-1", "company-1", NOW, NOW],
    );
    sqlite.run(
      "insert into applications (id, user_id, posting_id, company_id, origin, status, created_at, updated_at) values (?, ?, ?, ?, 'auto', 'sent', ?, ?)",
      ["application-2", "user-1", "posting-gone", "company-gone", NOW, NOW],
    );
    sqlite.run("PRAGMA foreign_keys = ON");
    sqlite.run(
      "insert into resumes (id, user_id, object_key, sha256, bytes, pages, filename_enc, text_enc, parsed_with, is_current, uploaded_at) values (?, ?, ?, ?, 1, 1, ?, ?, 'unpdf', 1, ?)",
      ["resume-1", "user-1", "resumes/1.pdf", "sha256", "notes.txt", "resume text", NOW],
    );
    sqlite.run(
      "insert into application_snapshots (application_id, user_id, posting_url, posting_title, answers_enc, resume_id, resume_sha256, consent_version, provider, submitted_at, confirmed_by) values (?, ?, ?, ?, '[]', ?, ?, '1', 'local', ?, 'page')",
      [
        "application-1",
        "user-1",
        "https://boards.example/jobs/1",
        "Senior Platform Engineer",
        "resume-1",
        "sha256",
        NOW,
      ],
    );
    sqlite.run(
      "insert into attempts (id, application_id, user_id, n, provider, started_at, lease_until) values (?, ?, ?, 1, 'local', ?, ?)",
      ["attempt-1", "application-1", "user-1", NOW, NOW],
    );
    sqlite.run(
      "insert into application_events (id, application_id, user_id, at, kind, source) values (?, ?, ?, ?, 'note', 'system')",
      ["event-1", "application-1", "user-1", NOW],
    );
    sqlite.run(
      "insert into checkins (id, application_id, user_id, due_at, status, created_at) values (?, ?, ?, ?, 'open', ?)",
      ["checkin-1", "application-1", "user-1", NOW, NOW],
    );

    migrateDatabase(db, "drizzle");

    expect(countOf(sqlite, "application_snapshots")).toBe(1);
    expect(countOf(sqlite, "attempts")).toBe(1);
    expect(countOf(sqlite, "application_events")).toBe(1);
    expect(countOf(sqlite, "checkins")).toBe(1);

    expect(readApplication(sqlite, "application-1")).toEqual({
      applyUrl: "https://boards.example/jobs/1/apply",
      ats: "greenhouse",
      companyDomain: "ferro.example",
      companyName: "Ferro Cloud",
      companyNameNorm: "ferro cloud",
      locationRaw: "Remote — Canada",
      postingTitle: "Senior Platform Engineer",
      postingUrl: "https://boards.example/jobs/1",
      salaryCurrency: "CAD",
      salaryMaxMinor: 19_000_000,
      salaryMinMinor: 16_000_000,
      salaryPeriod: "year",
    });
    expect(readApplication(sqlite, "application-2")).toMatchObject({
      ats: null,
      companyDomain: null,
      companyName: "Unknown company",
      companyNameNorm: "unknown company",
      postingTitle: "Unknown role",
      postingUrl: "",
    });

    sqlite.close();
  });

  test("drops the catalog foreign keys but keeps the logical ids and their indexes", () => {
    const { db, sqlite } = openDatabase(":memory:");

    migrateDatabase(db, "drizzle");

    const tables = ["applications", "matches", "posting_user_state", "skip_companies"];

    for (const table of tables) {
      const foreignKeys = z
        .array(z.object({ table: z.string() }))
        .parse(sqlite.query(`PRAGMA foreign_key_list(${table})`).all());

      expect(foreignKeys.some((key) => key.table === "postings")).toBe(false);
      expect(foreignKeys.some((key) => key.table === "companies")).toBe(false);
    }

    sqlite.run(
      "insert into users (id, name, email, created_at, updated_at) values (?, ?, ?, ?, ?)",
      ["user-1", "Owner", "owner@example.test", NOW, NOW],
    );
    sqlite.run(
      "insert into applications (id, user_id, posting_id, company_id, company_name, company_name_norm, posting_title, posting_url, origin, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 'auto', 'sent', ?, ?)",
      [
        "application-1",
        "user-1",
        "posting-gone",
        "company-gone",
        "Gone Co",
        "gone co",
        "Gone role",
        "",
        NOW,
        NOW,
      ],
    );

    expect(
      sqlite
        .query("select posting_id as postingId from applications where id = ?")
        .get("application-1"),
    ).toEqual({ postingId: "posting-gone" });

    sqlite.close();
  });
});
