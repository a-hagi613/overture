import { z } from "zod";

import type { Ats } from "../../shared/ats.ts";
import type { CatalogDatabase } from "../platform/db/client.ts";
import type { StapplyIngestRow } from "./stapply-daily.ts";

import { writePostingTags } from "./tag-store.ts";

const STAGING = "stapply_staging";

const STAGING_COLUMNS = [
  "posting_id",
  "source_key",
  "board_token",
  "ats_job_id",
  "company_name",
  "company_norm",
  "requisition_id",
  "url",
  "apply_url",
  "apply_url_norm",
  "title",
  "title_norm",
  "department",
  "team",
  "location_raw",
  "country_code",
  "region",
  "city",
  "language",
  "workplace",
  "is_remote",
  "employment_type",
  "commitment",
  "experience",
  "posted_at",
  "source_updated_at",
  "application_deadline",
  "salary_min_minor",
  "salary_max_minor",
  "salary_currency",
  "salary_period",
  "salary_summary",
  "apply_supported",
  "dedupe_suffix",
  "content_hash",
  "role_tag",
  "subrole_tag",
  "seniority_tag",
] as const;

const BOARD_MAP = "stapply_board_map";
const NEW_IDS = "stapply_new_ids";

/**
 * The counters one delta application reports. `unchanged` rows are seen again with the same content hash; their tags
 * and `skills_json` are left alone.
 */
export interface StapplyDeltaReport {
  readonly ingested: number;
  readonly duplicates: number;
  readonly inserted: number;
  readonly updated: number;
  readonly reopened: number;
  readonly unchanged: number;
  readonly closed: number;
  readonly pruned: number;
  readonly tagged: number;
}

/**
 * Creates the temporary staging tables and their lookup indexes. They live only for the run's connection.
 * @param db The catalog database the run builds.
 */
export function createStapplyStaging(db: CatalogDatabase) {
  const client = db.$client;

  client.run(`DROP TABLE IF EXISTS ${STAGING}`);
  client.run(`DROP TABLE IF EXISTS ${BOARD_MAP}`);
  client.run(`DROP TABLE IF EXISTS ${NEW_IDS}`);
  client.run("DROP TABLE IF EXISTS stapply_existing_boards");
  client.run(`CREATE TEMP TABLE ${STAGING} (
    posting_id TEXT PRIMARY KEY NOT NULL,
    source_key TEXT NOT NULL,
    board_token TEXT NOT NULL,
    ats_job_id TEXT NOT NULL,
    company_name TEXT NOT NULL,
    company_norm TEXT NOT NULL,
    requisition_id TEXT,
    url TEXT NOT NULL,
    apply_url TEXT,
    apply_url_norm TEXT NOT NULL,
    title TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    department TEXT,
    team TEXT,
    location_raw TEXT,
    country_code TEXT,
    region TEXT,
    city TEXT,
    language TEXT,
    workplace TEXT NOT NULL,
    is_remote INTEGER,
    employment_type TEXT NOT NULL,
    commitment TEXT,
    experience TEXT,
    posted_at INTEGER,
    source_updated_at INTEGER,
    application_deadline INTEGER,
    salary_min_minor INTEGER,
    salary_max_minor INTEGER,
    salary_currency TEXT,
    salary_period TEXT,
    salary_summary TEXT,
    apply_supported INTEGER NOT NULL,
    dedupe_suffix TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    role_tag TEXT,
    subrole_tag TEXT,
    seniority_tag TEXT
  )`);
  client.run(`CREATE INDEX ${STAGING}_board_job ON ${STAGING} (source_key, ats_job_id)`);
  client.run(`CREATE INDEX ${STAGING}_company ON ${STAGING} (source_key, company_norm)`);
  client.run(`CREATE TEMP TABLE ${BOARD_MAP} (
    source_key TEXT NOT NULL,
    company_norm TEXT NOT NULL,
    board_id TEXT NOT NULL,
    PRIMARY KEY (source_key, company_norm)
  )`);
  client.run(`CREATE INDEX ${BOARD_MAP}_board ON ${BOARD_MAP} (board_id)`);
  client.run("DROP TABLE IF EXISTS stapply_existing_boards");
  client.run(`CREATE TEMP TABLE ${NEW_IDS} (id TEXT PRIMARY KEY NOT NULL)`);
}

function isRemoteColumn(isRemote: boolean | null) {
  if (isRemote === null) {
    return null;
  }

  return isRemote ? 1 : 0;
}

/**
 * Inserts the run's mapped rows into the staging table in one transaction.
 * @param db The catalog database the run builds.
 * @param rows The mapped rows.
 */
export function stageStapplyRows(db: CatalogDatabase, rows: readonly StapplyIngestRow[]) {
  if (rows.length === 0) {
    return;
  }

  const client = db.$client;

  const statement = client.prepare(
    `INSERT OR REPLACE INTO ${STAGING} VALUES (${STAGING_COLUMNS.map(() => "?").join(", ")})`,
  );

  const write = client.transaction(() => {
    for (const row of rows) {
      statement.run(
        row.postingId,
        row.sourceKey,
        row.boardToken,
        row.atsJobId,
        row.companyName,
        row.companyNorm,
        row.requisitionId,
        row.url,
        row.applyUrl,
        row.applyUrlNorm,
        row.title,
        row.titleNorm,
        row.department,
        row.team,
        row.locationRaw,
        row.countryCode,
        row.region,
        row.city,
        row.language,
        row.workplace,
        isRemoteColumn(row.isRemote),
        row.employmentType,
        row.commitment,
        row.experience,
        row.postedAt,
        row.sourceUpdatedAt,
        row.applicationDeadline,
        row.salaryMinMinor,
        row.salaryMaxMinor,
        row.salaryCurrency,
        row.salaryPeriod,
        row.salarySummary,
        row.applySupported ? 1 : 0,
        row.dedupeSuffix,
        row.contentHash,
        row.roleTag,
        row.subroleTag,
        row.seniorityTag,
      );
    }
  });

  write();
}

interface BoardRows {
  readonly ats: Ats;
  readonly rows: number;
}

export interface StapplyDeltaInput {
  readonly now: number;
  readonly boards: readonly BoardRows[];
  readonly pruneClosedBeforeMs: number;
  readonly tagSupportedOnly: boolean;
}

const countSchema = z.object({ n: z.number() });

function countOf(db: CatalogDatabase, sql: string, ...params: readonly number[]) {
  return countSchema.parse(db.$client.query(sql).get(...params)).n;
}

function dedupeStaging(db: CatalogDatabase) {
  const before = countOf(db, `SELECT count(*) AS n FROM ${STAGING}`);

  db.$client.run(`CREATE TEMP TABLE stapply_duplicates AS
    SELECT rowid AS rowid FROM (
      SELECT rowid, row_number() OVER (
        PARTITION BY company_norm, coalesce(nullif(trim(requisition_id), ''), 'global:' || posting_id)
        ORDER BY apply_supported DESC, coalesce(source_updated_at, posted_at) DESC, ats_job_id DESC
      ) AS position
      FROM ${STAGING}
    ) WHERE position > 1`);
  db.$client.run(`CREATE TEMP TABLE stapply_job_duplicates AS
    SELECT rowid AS rowid FROM (
      SELECT rowid, row_number() OVER (PARTITION BY source_key, ats_job_id ORDER BY rowid) AS position
      FROM ${STAGING}
    ) WHERE position > 1`);
  db.$client.run(`DELETE FROM ${STAGING} WHERE rowid IN (SELECT rowid FROM stapply_duplicates)`);
  db.$client.run(
    `DELETE FROM ${STAGING} WHERE rowid IN (SELECT rowid FROM stapply_job_duplicates)`,
  );
  db.$client.run("DROP TABLE stapply_duplicates");
  db.$client.run("DROP TABLE stapply_job_duplicates");

  return before - countOf(db, `SELECT count(*) AS n FROM ${STAGING}`);
}

function placeholders(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

function ensureCompanies(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`INSERT INTO companies (id, name, name_norm, domain, industry, created_at)
      SELECT lower(hex(randomblob(16))), s.company_name, s.company_norm, NULL, NULL, ?
      FROM (SELECT company_norm, min(company_name) AS company_name FROM ${STAGING} GROUP BY company_norm) s
      WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.name_norm = s.company_norm)`)
    .run(now).changes;
}

function buildExistingBoardIndex(db: CatalogDatabase) {
  db.$client.run("DROP TABLE IF EXISTS stapply_existing_boards");
  db.$client.run(`CREATE TEMP TABLE stapply_existing_boards AS
    SELECT c.name_norm AS company_norm, b.ats AS source_key, min(b.id) AS board_id
    FROM company_boards b
    JOIN companies c ON c.id = b.company_id
    GROUP BY c.name_norm, b.ats`);
  db.$client.run(
    "CREATE INDEX stapply_existing_boards_ix ON stapply_existing_boards (source_key, company_norm)",
  );
}

function ensureBoards(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`INSERT INTO company_boards
        (id, company_id, ats, board_token, region, status, source, last_polled_at, next_poll_at,
         backoff_level, consecutive_errors, not_found_polls, created_at)
      SELECT lower(hex(randomblob(16))), c.id, s.source_key, s.board_token, 'us', 'active', 'import',
             ?, NULL, 0, 0, 0, ?
      FROM (SELECT source_key, company_norm, min(board_token) AS board_token
            FROM ${STAGING} GROUP BY source_key, company_norm) s
      JOIN companies c ON c.name_norm = s.company_norm
      WHERE NOT EXISTS (
        SELECT 1 FROM stapply_existing_boards e
        WHERE e.source_key = s.source_key AND e.company_norm = s.company_norm
      )`)
    .run(now, now).changes;
}

function mapBoards(db: CatalogDatabase) {
  db.$client.run(`INSERT OR REPLACE INTO ${BOARD_MAP} (source_key, company_norm, board_id)
    SELECT s.source_key, s.company_norm, e.board_id
    FROM (SELECT DISTINCT source_key, company_norm FROM ${STAGING}) s
    JOIN stapply_existing_boards e
      ON e.source_key = s.source_key AND e.company_norm = s.company_norm`);
}

const BOARD_JOIN = `JOIN ${BOARD_MAP} m
  ON m.source_key = s.source_key AND m.company_norm = s.company_norm`;

function insertNewPostings(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`INSERT INTO postings
        (id, board_id, company_id, ats, ats_job_id, requisition_id, url, apply_url, apply_url_norm,
         title, title_norm, department, team, location_raw, country_code, region, city, language,
         workplace, is_remote, employment_type, commitment, experience, posted_at, application_deadline,
         salary_min_minor, salary_max_minor, salary_currency, salary_period, salary_summary,
         source_updated_at, first_seen_at, last_seen_at, missing_polls, closed_at, status, apply_supported,
         dedupe_key, content_hash, tag_source, tagged_at)
      SELECT s.posting_id, m.board_id, b.company_id, s.source_key, s.ats_job_id, s.requisition_id, s.url,
             s.apply_url, s.apply_url_norm, s.title, s.title_norm, s.department, s.team, s.location_raw,
             s.country_code, s.region, s.city, s.language, s.workplace, s.is_remote, s.employment_type,
             s.commitment, s.experience, s.posted_at, s.application_deadline, s.salary_min_minor,
             s.salary_max_minor, s.salary_currency, s.salary_period, s.salary_summary, s.source_updated_at,
             ?, ?, 0, NULL, 'open', s.apply_supported,
             b.company_id || '|' || s.dedupe_suffix, s.content_hash, NULL, NULL
      FROM ${STAGING} s
      ${BOARD_JOIN}
      JOIN company_boards b ON b.id = m.board_id
      WHERE NOT EXISTS (
        SELECT 1 FROM postings x WHERE x.board_id = m.board_id AND x.ats_job_id = s.ats_job_id
      )`)
    .run(now, now).changes;
}

function updateChangedPostings(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`UPDATE postings SET
        requisition_id = s.requisition_id, url = s.url, apply_url = s.apply_url,
        apply_url_norm = s.apply_url_norm, title = s.title, title_norm = s.title_norm,
        department = s.department, team = s.team, location_raw = s.location_raw,
        country_code = s.country_code, region = s.region, city = s.city, language = s.language,
        workplace = s.workplace, is_remote = s.is_remote, employment_type = s.employment_type,
        commitment = s.commitment, experience = s.experience, posted_at = s.posted_at,
        application_deadline = s.application_deadline, salary_min_minor = s.salary_min_minor,
        salary_max_minor = s.salary_max_minor, salary_currency = s.salary_currency,
        salary_period = s.salary_period, salary_summary = s.salary_summary,
        source_updated_at = s.source_updated_at, last_seen_at = ?, missing_polls = 0,
        closed_at = NULL, status = 'open', apply_supported = s.apply_supported,
        dedupe_key = postings.company_id || '|' || s.dedupe_suffix, content_hash = s.content_hash,
        tag_source = NULL, tagged_at = NULL
      FROM ${STAGING} s
      ${BOARD_JOIN}
      WHERE postings.board_id = m.board_id
        AND postings.ats_job_id = s.ats_job_id
        AND (postings.content_hash IS NULL OR postings.content_hash <> s.content_hash)`)
    .run(now).changes;
}

function reopenReturnedPostings(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`UPDATE postings SET status = 'open', closed_at = NULL, last_seen_at = ?, missing_polls = 0
      FROM ${STAGING} s
      ${BOARD_JOIN}
      WHERE postings.board_id = m.board_id
        AND postings.ats_job_id = s.ats_job_id
        AND postings.status = 'closed'`)
    .run(now).changes;
}

function touchUnchangedPostings(db: CatalogDatabase, now: number) {
  return db.$client
    .query(`UPDATE postings SET last_seen_at = ?, missing_polls = 0
      FROM ${STAGING} s
      ${BOARD_JOIN}
      WHERE postings.board_id = m.board_id
        AND postings.ats_job_id = s.ats_job_id
        AND postings.last_seen_at < ?`)
    .run(now, now).changes;
}

function countMatchedPostings(db: CatalogDatabase) {
  return countOf(
    db,
    `SELECT count(*) AS n FROM postings
      JOIN ${BOARD_MAP} m ON m.board_id = postings.board_id
      JOIN ${STAGING} s ON s.source_key = m.source_key AND s.company_norm = m.company_norm
        AND s.ats_job_id = postings.ats_job_id`,
  );
}

function closeAbsentPostings(db: CatalogDatabase, input: StapplyDeltaInput) {
  if (input.boards.length === 0) {
    return 0;
  }

  const ats = input.boards.map((board) => board.ats);

  return db.$client
    .query(`UPDATE postings SET status = 'closed', closed_at = ?, missing_polls = missing_polls + 1
      WHERE postings.status = 'open'
        AND postings.ats IN (${placeholders(ats)})
        AND NOT EXISTS (
          SELECT 1 FROM ${STAGING} s
          JOIN ${BOARD_MAP} m ON m.source_key = s.source_key AND m.company_norm = s.company_norm
          WHERE m.board_id = postings.board_id AND s.ats_job_id = postings.ats_job_id
        )`)
    .run(input.now, ...ats).changes;
}

function pruneClosedPostings(db: CatalogDatabase, cutoff: number) {
  return db.$client
    .query(
      `DELETE FROM postings WHERE status = 'closed' AND closed_at IS NOT NULL AND closed_at < ?`,
    )
    .run(cutoff).changes;
}

function recordNewPostings(db: CatalogDatabase, now: number) {
  db.$client.run(`INSERT OR REPLACE INTO ${NEW_IDS} (id)
    SELECT postings.id
    FROM ${STAGING} s
    ${BOARD_JOIN}
    JOIN postings ON postings.board_id = m.board_id AND postings.ats_job_id = s.ats_job_id
    WHERE postings.first_seen_at = ${String(Math.trunc(now))}`);
}

const tagTargetSchema = z.object({
  id: z.string(),
  role_tag: z.string().nullable(),
  subrole_tag: z.string().nullable(),
  seniority_tag: z.string().nullable(),
});

function writeStagedTags(db: CatalogDatabase, now: number, tagSupportedOnly: boolean) {
  const targets = z.array(tagTargetSchema).parse(
    db.$client
      .query(`SELECT postings.id AS id, s.role_tag AS role_tag, s.subrole_tag AS subrole_tag,
                     s.seniority_tag AS seniority_tag
        FROM postings
        JOIN ${BOARD_MAP} m ON m.board_id = postings.board_id
        JOIN ${STAGING} s ON s.source_key = m.source_key AND s.company_norm = m.company_norm
          AND s.ats_job_id = postings.ats_job_id
        WHERE postings.tagged_at IS NULL
          AND (? = 0 OR postings.apply_supported = 1)`)
      .all(tagSupportedOnly ? 1 : 0),
  );

  for (let offset = 0; offset < targets.length; offset += 500) {
    const chunk = targets.slice(offset, offset + 500);

    db.transaction(
      (tx) => {
        for (const target of chunk) {
          const writes = [
            ["role", target.role_tag],
            ["subrole", target.subrole_tag],
            ["seniority", target.seniority_tag],
          ] as const;

          writePostingTags(
            tx,
            target.id,
            writes.flatMap(([dimension, value]) =>
              value === null ? [] : [{ dimension, value, source: "rules" as const }],
            ),
            now,
          );
        }
      },
      { behavior: "immediate" },
    );
  }

  return targets.length;
}

/**
 * Applies the staged snapshot to the catalog: creates the companies and boards that are new, inserts new postings,
 * rewrites changed ones, reopens returned ones, closes the ones the boards dropped, prunes closed rows older than the
 * cutoff, then writes the rule tags computed at mapping time for new and changed rows only.
 * @param db The catalog database the run builds.
 * @param input The clock reading, the boards that returned rows and the tag/prune policy.
 * @returns The delta counters.
 */
export function applyStapplyDelta(db: CatalogDatabase, input: StapplyDeltaInput) {
  const client = db.$client;

  client.run("BEGIN IMMEDIATE");

  let duplicates: number;
  let inserted: number;
  let updated: number;
  let reopened: number;
  let unchanged: number;
  let closed: number;
  let pruned: number;

  try {
    duplicates = dedupeStaging(db);
    ensureCompanies(db, input.now);
    buildExistingBoardIndex(db);
    ensureBoards(db, input.now);
    buildExistingBoardIndex(db);
    mapBoards(db);
    inserted = insertNewPostings(db, input.now);
    updated = updateChangedPostings(db, input.now);
    reopened = reopenReturnedPostings(db, input.now);
    unchanged = Math.max(0, countMatchedPostings(db) - inserted - updated - reopened);
    touchUnchangedPostings(db, input.now);
    recordNewPostings(db, input.now);
    closed = closeAbsentPostings(db, input);
    pruned = pruneClosedPostings(db, input.pruneClosedBeforeMs);
    client.run("COMMIT");
  } catch (error) {
    client.run("ROLLBACK");
    throw error;
  }

  const tagged = writeStagedTags(db, input.now, input.tagSupportedOnly);

  return {
    ingested: countOf(db, `SELECT count(*) AS n FROM ${STAGING}`),
    duplicates,
    inserted,
    updated,
    reopened,
    unchanged,
    closed,
    pruned,
    tagged,
  } satisfies StapplyDeltaReport;
}

/**
 * Drops the run's temporary tables; the catalog file keeps no staging residue.
 * @param db The catalog database the run builds.
 */
export function dropStapplyStaging(db: CatalogDatabase) {
  const client = db.$client;

  client.run(`DROP TABLE IF EXISTS ${STAGING}`);
  client.run(`DROP TABLE IF EXISTS ${BOARD_MAP}`);
  client.run(`DROP TABLE IF EXISTS ${NEW_IDS}`);
  client.run("DROP TABLE IF EXISTS stapply_existing_boards");
}

const stapplyLeftoverSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullable(),
  team: z.string().nullable(),
  locationRaw: z.string().nullable(),
  workplace: z.string(),
  employmentType: z.string(),
  experience: z.string().nullable(),
  companyName: z.string(),
});

export type StapplyLeftover = z.infer<typeof stapplyLeftoverSchema>;

/**
 * The newly inserted postings whose rule tags left the role unresolved. Only these go to the LLM.
 * @param db The catalog database the run builds.
 * @param limit The maximum rows to send this run.
 * @returns The leftover postings, newest first.
 */
export function selectStapplyLeftovers(db: CatalogDatabase, limit: number) {
  if (limit <= 0) {
    return [];
  }

  return z.array(stapplyLeftoverSchema).parse(
    db.$client
      .query(`SELECT postings.id AS id, postings.title AS title, postings.department AS department,
                     postings.team AS team, postings.location_raw AS locationRaw,
                     postings.workplace AS workplace, postings.employment_type AS employmentType,
                     postings.experience AS experience, companies.name AS companyName
        FROM postings
        JOIN ${NEW_IDS} n ON n.id = postings.id
        JOIN companies ON companies.id = postings.company_id
        LEFT JOIN posting_tags ON posting_tags.posting_id = postings.id
          AND posting_tags.dimension = 'role'
        WHERE posting_tags.posting_id IS NULL
          AND postings.status = 'open'
          AND postings.apply_supported = 1
        ORDER BY postings.posted_at DESC NULLS LAST, postings.id
        LIMIT ?`)
      .all(limit),
  );
}

const tagSourceSummarySchema = z.object({
  source: z.string().nullable(),
  count: z.number(),
});

export type TagSourceSummary = z.infer<typeof tagSourceSummarySchema>;

/**
 * Counts postings by their stored `tag_source`, for the run summary.
 * @param db The catalog database the run builds.
 * @returns One row per distinct `tag_source`.
 */
export function tagSourceSummary(db: CatalogDatabase) {
  return z
    .array(tagSourceSummarySchema)
    .parse(
      db.$client
        .query(
          "SELECT tag_source AS source, count(*) AS count FROM postings GROUP BY tag_source ORDER BY count DESC",
        )
        .all(),
    );
}

/**
 * Counts the open postings Overture can apply to, the manifest's `supportedCount`.
 * @param db The catalog database the run builds.
 * @returns The count.
 */
export function countSupportedPostings(db: CatalogDatabase) {
  return countOf(
    db,
    "SELECT count(*) AS n FROM postings WHERE apply_supported = 1 AND status = 'open'",
  );
}

/**
 * Counts every posting, the manifest's `rowCount`.
 * @param db The catalog database the run builds.
 * @returns The count.
 */
export function countPostings(db: CatalogDatabase) {
  return countOf(db, "SELECT count(*) AS n FROM postings");
}

/**
 * Reads the open postings that still have no role tag, the LLM pass's leftovers after a run.
 * @param db The catalog database the run builds.
 * @returns The number of unresolved open postings.
 */
export function unresolvedRoleCount(db: CatalogDatabase) {
  return countOf(
    db,
    `SELECT count(*) AS n FROM postings
      WHERE status = 'open' AND apply_supported = 1
        AND NOT EXISTS (SELECT 1 FROM posting_tags WHERE posting_tags.posting_id = postings.id
                        AND posting_tags.dimension = 'role')`,
  );
}
