import { z } from "zod";

import type { Ats } from "../../shared/ats.ts";
import type { CatalogDatabase } from "../platform/db/client.ts";
import type { StapplyIngestRow } from "./stapply-daily.ts";

import { writePostingTags } from "./tag-store.ts";
import { boardPriorityFor } from "./stapply-daily.ts";
import { GENERIC_REQUISITION_IDS, parseSkillRequirements } from "./stapply-fields.ts";
import type { Classification } from "./classifier.ts";

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
  "description_gz",
  "apply_supported",
  "dedupe_suffix",
  "content_hash",
  "role_tag",
  "subrole_tag",
  "seniority_tag",
  "job_category",
  "skill_requirements",
  "exact_title_norm",
  "location_key",
  "board_priority",
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
  client.run("DROP TABLE IF EXISTS stapply_pass2_keys");
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
    description_gz BLOB,
    apply_supported INTEGER NOT NULL,
    dedupe_suffix TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    role_tag TEXT,
    subrole_tag TEXT,
    seniority_tag TEXT,
    job_category TEXT,
    skill_requirements TEXT,
    exact_title_norm TEXT NOT NULL,
    location_key TEXT NOT NULL,
    board_priority INTEGER NOT NULL
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
        row.descriptionGz,
        row.applySupported ? 1 : 0,
        row.dedupeSuffix,
        row.contentHash,
        row.roleTag,
        row.subroleTag,
        row.seniorityTag,
        row.jobCategory,
        JSON.stringify(row.skillRequirements),
        row.exactTitleNorm,
        row.locationKey,
        boardPriorityFor(row.sourceKey),
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

const GENERIC_REQUISITION_SQL = [...GENERIC_REQUISITION_IDS]
  .map((value) => `'${value.replaceAll("'", "''")}'`)
  .join(", ");

function dedupeStaging(db: CatalogDatabase) {
  db.$client.run(`CREATE TEMP TABLE stapply_duplicates AS
    SELECT rowid AS rowid FROM (
      SELECT rowid, row_number() OVER (
        PARTITION BY company_norm, 'req:' || lower(trim(requisition_id))
        ORDER BY board_priority DESC, apply_supported DESC,
          coalesce(source_updated_at, posted_at) DESC, ats_job_id DESC
      ) AS position
      FROM ${STAGING}
      WHERE requisition_id IS NOT NULL AND trim(requisition_id) <> ''
        AND lower(trim(requisition_id)) NOT IN (${GENERIC_REQUISITION_SQL})
    ) WHERE position > 1`);

  const pass1 = db.$client.run(
    `DELETE FROM ${STAGING} WHERE rowid IN (SELECT rowid FROM stapply_duplicates)`,
  ).changes;

  db.$client.run("DROP TABLE stapply_duplicates");

  db.$client.run(`CREATE TEMP TABLE stapply_pass2_keys AS
    SELECT company_norm, exact_title_norm, location_key FROM (
      SELECT company_norm, exact_title_norm, location_key, source_key, count(*) AS per_board
      FROM ${STAGING}
      WHERE requisition_id IS NULL OR trim(requisition_id) = ''
        OR lower(trim(requisition_id)) IN (${GENERIC_REQUISITION_SQL})
      GROUP BY company_norm, exact_title_norm, location_key, source_key
    )
    GROUP BY company_norm, exact_title_norm, location_key
    HAVING count(*) > 1 AND max(per_board) = 1`);
  db.$client.run(`CREATE TEMP TABLE stapply_duplicates AS
    SELECT rowid AS rowid FROM (
      SELECT s.rowid AS rowid, row_number() OVER (
        PARTITION BY s.company_norm, s.exact_title_norm, s.location_key
        ORDER BY s.board_priority DESC, s.apply_supported DESC,
          coalesce(s.source_updated_at, s.posted_at) DESC, s.ats_job_id DESC
      ) AS position
      FROM ${STAGING} s
      JOIN stapply_pass2_keys k
        ON k.company_norm = s.company_norm AND k.exact_title_norm = s.exact_title_norm
          AND k.location_key = s.location_key
      WHERE s.requisition_id IS NULL OR trim(s.requisition_id) = ''
        OR lower(trim(s.requisition_id)) IN (${GENERIC_REQUISITION_SQL})
    ) WHERE position > 1`);

  const pass2 = db.$client.run(
    `DELETE FROM ${STAGING} WHERE rowid IN (SELECT rowid FROM stapply_duplicates)`,
  ).changes;

  db.$client.run("DROP TABLE stapply_duplicates");
  db.$client.run("DROP TABLE stapply_pass2_keys");

  db.$client.run(`CREATE TEMP TABLE stapply_job_duplicates AS
    SELECT rowid AS rowid FROM (
      SELECT rowid, row_number() OVER (PARTITION BY source_key, ats_job_id ORDER BY rowid) AS position
      FROM ${STAGING}
    ) WHERE position > 1`);
  db.$client.run(
    `DELETE FROM ${STAGING} WHERE rowid IN (SELECT rowid FROM stapply_job_duplicates)`,
  );
  db.$client.run("DROP TABLE stapply_job_duplicates");

  return pass1 + pass2;
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
         description_gz, job_category, source_updated_at, first_seen_at, last_seen_at, missing_polls, closed_at, status,
         apply_supported, dedupe_key, content_hash, tag_source, tagged_at)
      SELECT s.posting_id, m.board_id, b.company_id, s.source_key, s.ats_job_id, s.requisition_id, s.url,
             s.apply_url, s.apply_url_norm, s.title, s.title_norm, s.department, s.team, s.location_raw,
             s.country_code, s.region, s.city, s.language, s.workplace, s.is_remote, s.employment_type,
             s.commitment, s.experience, s.posted_at, s.application_deadline, s.salary_min_minor,
             s.salary_max_minor, s.salary_currency, s.salary_period, s.salary_summary, s.description_gz,
             s.job_category,
             s.source_updated_at,
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
        description_gz = s.description_gz, source_updated_at = s.source_updated_at, last_seen_at = ?, missing_polls = 0,
        closed_at = NULL, status = 'open', apply_supported = s.apply_supported,
        job_category = s.job_category,
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
  client.run("DROP TABLE IF EXISTS stapply_pass2_keys");
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

/**
 * Counts every posting, the manifest's `rowCount`.
 * @param db The catalog database the run builds.
 * @returns The count.
 */
export function countPostings(db: CatalogDatabase) {
  return countOf(db, "SELECT count(*) AS n FROM postings");
}

const classificationTargetSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().nullable(),
  jobCategory: z.string().nullable(),
  language: z.string().nullable(),
});

export type ClassificationTarget = z.infer<typeof classificationTargetSchema>;

/**
 * The open postings the classifier still has to resolve. The newest are chosen first so a run with a row ceiling
 * spends its budget where a job seeker looks.
 * @param db The catalog database the run builds.
 * @param limit The maximum postings to return.
 * @returns The target postings.
 */
export function selectClassificationTargets(db: CatalogDatabase, limit: number) {
  if (limit <= 0) {
    return [];
  }

  return z.array(classificationTargetSchema).parse(
    db.$client
      .query(`SELECT postings.id AS id, postings.title AS title, postings.department AS department,
                     postings.job_category AS jobCategory, postings.language AS language
        FROM postings
        WHERE postings.status = 'open' AND postings.primary_category IS NULL
          AND postings.classified_at IS NULL
        ORDER BY postings.posted_at DESC NULLS LAST, postings.id
        LIMIT ?`)
      .all(limit),
  );
}

export interface PostingClassificationWrite {
  readonly postingId: string;
  readonly classification: Classification;
  readonly skillRequirements: readonly string[];
}

const TAG_DIMENSIONS_TO_REPLACE = "'role', 'granular_role', 'esco'";

function tagSourceFor(classification: Classification) {
  if (classification.source === "haiku") {
    return "llm";
  }

  return classification.source === "embeddings" ? "model" : "rules";
}

/**
 * Writes one resolved classification: the three stored columns on `postings`, and the multi-label `posting_tags`
 * rows (Level 1 as `role`, Level 2 as `granular_role`, Level 3 as `esco`) with their weights. Secondary roles keep
 * their scores, so a hybrid role is visible without pretending it is the primary one. `postings.title` is untouched.
 * @param db The catalog database the run builds.
 * @param write The posting, its classification and its extracted skills.
 * @param now The run clock.
 */
export function writePostingClassification(
  db: CatalogDatabase,
  write: PostingClassificationWrite,
  now: number,
) {
  writePostingClassifications(db, [write], now);
}

/**
 * Writes a batch of resolved classifications inside one transaction. The ETL classifies tens of thousands of postings
 * in a run, so a transaction per posting would dominate its wall clock.
 * @param db The catalog database the run builds.
 * @param writes The postings, their classifications and their extracted skills.
 * @param now The run clock.
 */
export function writePostingClassifications(
  db: CatalogDatabase,
  writes: readonly PostingClassificationWrite[],
  now: number,
) {
  if (writes.length === 0) {
    return;
  }

  const client = db.$client;

  const insert = client.prepare(
    "INSERT OR IGNORE INTO posting_tags (posting_id, dimension, value, source, weight) VALUES (?, ?, ?, ?, ?)",
  );

  const update = client.prepare(
    `UPDATE postings SET primary_category = ?, primary_role = ?, esco_code = ?,
       tag_source = ?, tagged_at = ?, classified_at = ? WHERE id = ?`,
  );

  const writeAll = client.transaction(() => {
    for (const write of writes) {
      const source = tagSourceFor(write.classification);

      client
        .prepare(
          `DELETE FROM posting_tags WHERE posting_id = ? AND dimension IN (${TAG_DIMENSIONS_TO_REPLACE})`,
        )
        .run(write.postingId);
      insert.run(write.postingId, "role", write.classification.category, source, 1);
      insert.run(write.postingId, "granular_role", write.classification.role, source, 1);

      if (write.classification.escoCode !== null) {
        insert.run(write.postingId, "esco", write.classification.escoCode, source, 1);
      }

      for (const secondary of write.classification.secondaryRoles) {
        insert.run(write.postingId, "role", secondary.category, source, secondary.score);
        insert.run(write.postingId, "granular_role", secondary.role, source, secondary.score);
      }

      for (const skill of write.skillRequirements) {
        insert.run(write.postingId, "skill", skill, "rules", null);
      }

      update.run(
        write.classification.category,
        write.classification.role,
        write.classification.escoCode,
        source,
        now,
        now,
        write.postingId,
      );
    }
  });

  writeAll();
}

/**
 * Marks postings the classifier looked at but could not resolve, so a row-ceilinged run moves on to the next batch
 * instead of retrying the same hard titles every day.
 * @param db The catalog database the run builds.
 * @param postingIds The unresolved postings.
 * @param now The run clock.
 */
export function markClassificationAttempted(
  db: CatalogDatabase,
  postingIds: readonly string[],
  now: number,
) {
  const update = db.$client.prepare("UPDATE postings SET classified_at = ? WHERE id = ?");

  const write = db.$client.transaction(() => {
    for (const id of postingIds) {
      update.run(now, id);
    }
  });

  write();
}

const skillTargetSchema = z.object({
  id: z.string(),
  skillRequirements: z.string().nullable(),
});

/**
 * Writes the feed's extracted `skill_requirements` as `skill` tags for every posting the delta just staged.
 * @param db The catalog database the run builds.
 * @returns The number of postings that received at least one skill tag.
 */
export function writeStagedSkills(db: CatalogDatabase) {
  const targets = z.array(skillTargetSchema).parse(
    db.$client
      .query(`SELECT postings.id AS id, s.skill_requirements AS skillRequirements
        FROM postings
        JOIN ${BOARD_MAP} m ON m.board_id = postings.board_id
        JOIN ${STAGING} s ON s.source_key = m.source_key AND s.company_norm = m.company_norm
          AND s.ats_job_id = postings.ats_job_id
        WHERE s.skill_requirements IS NOT NULL AND s.skill_requirements <> '[]'`)
      .all(),
  );

  const insert = db.$client.prepare(
    "INSERT OR IGNORE INTO posting_tags (posting_id, dimension, value, source) VALUES (?, 'skill', ?, 'rules')",
  );

  let tagged = 0;

  const write = db.$client.transaction(() => {
    for (const target of targets) {
      const skills = parseSkillRequirements(target.skillRequirements);

      if (skills.length === 0) {
        continue;
      }

      db.$client
        .prepare("DELETE FROM posting_tags WHERE posting_id = ? AND dimension = 'skill'")
        .run(target.id);

      for (const skill of skills) {
        insert.run(target.id, skill);
      }

      tagged += 1;
    }
  });

  write();

  return tagged;
}

/**
 * Counts the open postings that still have no primary category, the coverage number behind `still_untagged` and the
 * 5 % acceptance target.
 * @param db The catalog database the run builds.
 * @returns The count.
 */
export function untaggedPostingCount(db: CatalogDatabase) {
  return countOf(
    db,
    "SELECT count(*) AS n FROM postings WHERE status = 'open' AND primary_category IS NULL",
  );
}
