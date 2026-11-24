import { createHash } from "node:crypto";
import { z } from "zod";

import { ATS_REGISTRY, ATS_VALUES } from "../../shared/ats.ts";

import type { Ats } from "../../shared/ats.ts";
import type { Seniority, Workplace } from "../../shared/tag-taxonomy.ts";
import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";

import { contentHash } from "./content-hash.ts";
import { normalizeApplyUrl, normalizeTitle } from "./normalize.ts";
import {
  normalizeExactTitle,
  parseSkillRequirements,
  parseStapplyLocations,
  stapplyLocationKey,
} from "./stapply-fields.ts";
import { salaryPeriodForColumn } from "./tag-store.ts";
import { tagPosting } from "./tag-rules.ts";
import { taggingReportSchema } from "./tagging-report.ts";
import type { TaggingReport } from "./tagging-report.ts";

/**
 * The hard ceiling for the uncompressed `catalog.sqlite` (issue #630). The `overture-web` machine has a
 * 10 GB `/data` volume and keeps the previous snapshot beside the new one for a hot swap; staying under
 * 2.5 GB leaves room for two snapshots, the zstd file and the app database with wide headroom.
 */
export const CATALOG_SIZE_BUDGET_BYTES = 2_500_000_000;

/**
 * Refuses a snapshot that would leave too little room for the next build.
 * @param bytes The uncompressed `catalog.sqlite` size.
 * @returns The same size, when it fits.
 */
export function assertCatalogSizeWithinBudget(bytes: number) {
  if (bytes >= CATALOG_SIZE_BUDGET_BYTES) {
    throw new Error(
      `catalog.sqlite is ${String(bytes)} bytes, over the ${String(CATALOG_SIZE_BUDGET_BYTES)} byte budget; prune the snapshot before publishing`,
    );
  }

  return bytes;
}

/**
 * The Stapply public snapshot base. Each board publishes `jobs.parquet` and a combined `all.parquet`; the daily pass
 * reads only the 28 per-board files, with column projection, and never `all.parquet` (issue #568).
 */
export const STAPPLY_JOBS_BASE_URL = "https://storage.stapply.ai/jobs/v1";

/**
 * The parquet columns the pass projects. `description` and `raw` are deliberately absent: they are the bulk of the
 * snapshot bytes and the catalog does not store Stapply descriptions.
 */
export const STAPPLY_PROJECTED_COLUMNS = [
  "global_id",
  "ats_id",
  "company",
  "requisition_id",
  "url",
  "apply_url",
  "title",
  "department",
  "team",
  "location",
  "country_iso",
  "region",
  "language",
  "locations",
  "job_category",
  "skill_requirements",
  "is_remote",
  "workplace_type",
  "employment_type",
  "commitment",
  "experience",
  "posted_at",
  "source_updated_at",
  "application_deadline",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "salary_summary",
] as const;

/**
 * The ATSes whose own board is the source of truth. When the same opening appears on one of these and on a mirror or
 * aggregator board, the native row wins even if the mirror is newer, so the canonical apply link and id survive.
 */
export const NATIVE_BOARD_PRIORITY: readonly Ats[] = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "personio",
];

const nativeBoards = new Set<string>(NATIVE_BOARD_PRIORITY);

/**
 * @param ats A board's ATS.
 * @returns 1 for a native primary board, 0 for a secondary or aggregator board.
 */
export function boardPriorityFor(ats: Ats) {
  return nativeBoards.has(ats) ? 1 : 0;
}

const DAY_MS = 86_400_000;

/**
 * The catalog snapshot an ETL run publishes, and the only manifest shape the runtime hot-swap accepts
 * (issue #576 `WS-8`).
 */
export const catalogManifestSchema = z.object({
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  builtAt: z.iso.datetime({ offset: true }),
  rowCount: z.number().int().nonnegative(),
  supportedCount: z.number().int().nonnegative(),
  tagging: taggingReportSchema.optional(),
});

export type CatalogManifest = z.infer<typeof catalogManifestSchema>;

export interface StapplyBoardSource {
  readonly ats: Ats;
  readonly applySupported: boolean;
  readonly url: string;
}

/**
 * The 28 verified boards of issue #563, each pointing at its own `jobs.parquet`.
 * @param baseUrl The snapshot base, `https://storage.stapply.ai/jobs/v1` in production.
 * @returns One source per ATS in the registry, in registry order.
 */
export function stapplyBoardSources(baseUrl: string = STAPPLY_JOBS_BASE_URL) {
  const trimmed = baseUrl.replace(/\/+$/u, "");

  return ATS_VALUES.map(
    (ats) =>
      ({
        ats,
        applySupported: ATS_REGISTRY[ats].applySupported,
        url: `${trimmed}/${ats}/jobs.parquet`,
      }) satisfies StapplyBoardSource,
  );
}

export interface StapplyIngestQueryInput {
  readonly boards: readonly StapplyBoardSource[];
  readonly freshnessCutoffMs: number | null;
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function epochMsOf(column: string) {
  return `epoch_ms(try_cast(nullif(trim(${column}), '') AS TIMESTAMPTZ))`;
}

const BOARD_SELECT_COLUMNS = STAPPLY_PROJECTED_COLUMNS.join(", ");

/**
 * Builds the single DuckDB query that reads every board, applies the pre-ingest filters and collapses duplicates.
 *
 * Filters, in order: a non-empty title; an `https://` apply link (the feed's `apply_url`, or the posting `url` when
 * the feed has no apply link, which is normal for Greenhouse and Personio); an `application_deadline` that is absent
 * or not past; and, on a seed run, the `freshnessCutoffMs` horizon. Duplicates are one row per
 * `(company_norm, requisition_id)`, preferring a board Overture can apply to, then the newest source update.
 * @param input The board sources and the optional seed horizon.
 * @returns A SQL statement whose rows match `StapplyIngestRow` after mapping.
 */
export function buildStapplyIngestQuery(input: StapplyIngestQueryInput) {
  const branches = input.boards.map((board) =>
    [
      `SELECT ${quote(board.ats)} AS source_key,`,
      `CAST(${board.applySupported ? 1 : 0} AS BOOLEAN) AS apply_supported,`,
      `CAST(${board.applySupported ? 1 : 0} AS INTEGER) AS apply_supported_rank,`,
      `CAST(${boardPriorityFor(board.ats)} AS INTEGER) AS board_priority,`,
      BOARD_SELECT_COLUMNS,
      `FROM read_parquet(${quote(board.url)})`,
    ].join(" "),
  );

  const freshness =
    input.freshnessCutoffMs === null
      ? null
      : `(posted_at_ms IS NULL OR posted_at_ms >= ${String(Math.trunc(input.freshnessCutoffMs))})`;

  const filters = [
    "nullif(trim(title), '') IS NOT NULL",
    "coalesce(nullif(trim(apply_url), ''), url) LIKE 'https://%'",
    "(application_deadline_ms IS NULL OR application_deadline_ms >= epoch_ms(current_date))",
    freshness,
  ].filter((filter) => filter !== null);

  return [
    "WITH board_rows AS (",
    branches.join("\nUNION ALL\n"),
    "),",
    "normalized AS (",
    "SELECT source_key, apply_supported, apply_supported_rank, board_priority, global_id, ats_id, company,",
    "lower(trim(company)) AS company_norm,",
    "requisition_id, url, apply_url, title, department, team, location, country_iso, language,",
    "region AS feed_region, locations, job_category, skill_requirements,",
    "is_remote, workplace_type, employment_type, commitment, experience,",
    "salary_min, salary_max, salary_currency, salary_period, salary_summary,",
    `${epochMsOf("posted_at")} AS posted_at_ms,`,
    `${epochMsOf("source_updated_at")} AS source_updated_at_ms,`,
    `${epochMsOf("application_deadline")} AS application_deadline_ms,`,
    // Pass-2 keys: the exact title keeps seniority/level/track tokens, and the location keeps country plus the
    // primary feed label, so two distinct openings never collapse.
    "regexp_replace(trim(lower(title)), '[^\\p{L}\\p{N}]+', ' ', 'g') AS exact_title_norm,",
    "coalesce(CASE WHEN json_valid(locations) THEN json_extract_string(locations, '$[0].label') END, location) AS primary_location_label,",
    "lower(coalesce(country_iso, '')) || '|' || regexp_replace(trim(lower(coalesce(CASE WHEN json_valid(locations) THEN json_extract_string(locations, '$[0].label') END, location, ''))), '[^\\p{L}\\p{N}]+', ' ', 'g') AS location_key",
    "FROM board_rows",
    "),",
    "filtered AS (",
    "SELECT * FROM normalized WHERE",
    filters.join("\nAND "),
    "),",
    "windowed AS (",
    "SELECT *, count(*) OVER (PARTITION BY company_norm, exact_title_norm, location_key, source_key) AS board_same_count",
    "FROM filtered",
    "),",
    "grouped AS (",
    "SELECT *, max(board_same_count) OVER (PARTITION BY company_norm, exact_title_norm, location_key) AS group_max_board_count,",
    "sum(board_same_count) OVER (PARTITION BY company_norm, exact_title_norm, location_key) AS group_row_count",
    "FROM windowed",
    "),",
    "deduped AS (",
    "SELECT * FROM grouped QUALIFY row_number() OVER (",
    "PARTITION BY company_norm,",
    "CASE",
    "WHEN requisition_id IS NOT NULL AND length(trim(requisition_id)) > 0",
    "AND lower(trim(requisition_id)) NOT IN ('null','n/a','na','none','tbd','-','0','unknown','not specified')",
    "THEN 'req:' || lower(trim(requisition_id))",
    // Pass 2 only collapses a group where every involved board contributed exactly one row; a board with two
    // identical titles keeps both, because that is two openings, not a mirror.
    "WHEN group_max_board_count = 1 AND group_row_count > 1 THEN 'title:' || exact_title_norm || '|' || location_key",
    "ELSE 'keep:' || coalesce(global_id, '') || ':' || coalesce(ats_id, '')",
    "END",
    "ORDER BY board_priority DESC, apply_supported_rank DESC, coalesce(source_updated_at_ms, posted_at_ms) DESC NULLS LAST, global_id",
    ") = 1",
    "),",
    "unique_jobs AS (",
    "SELECT * FROM deduped QUALIFY row_number() OVER (PARTITION BY source_key, ats_id) = 1",
    ")",
    "SELECT source_key, apply_supported, global_id, ats_id, company, company_norm, requisition_id, url, apply_url,",
    "title, department, team, location, country_iso, language, feed_region, locations, job_category,",
    "skill_requirements, is_remote, workplace_type, employment_type,",
    "commitment, experience, posted_at_ms, source_updated_at_ms, application_deadline_ms,",
    "salary_min, salary_max, salary_currency, salary_period, salary_summary",
    "FROM unique_jobs",
  ].join("\n");
}

const numberValue = z.union([z.number(), z.bigint()]).transform(Number);

const parquetRowSchema = z.object({
  source_key: z.enum(ATS_VALUES),
  apply_supported: z.boolean(),
  global_id: z.string().min(1),
  ats_id: z.string().min(1),
  company: z.string().min(1),
  company_norm: z.string().min(1),
  requisition_id: z.string().nullable(),
  url: z.string(),
  apply_url: z.string().nullable(),
  title: z.string(),
  department: z.string().nullable(),
  team: z.string().nullable(),
  location: z.string().nullable(),
  country_iso: z.string().nullable(),
  language: z.string().nullable(),
  feed_region: z.string().nullable().default(null),
  locations: z.string().nullable().default(null),
  job_category: z.string().nullable().default(null),
  skill_requirements: z.string().nullable().default(null),
  is_remote: z.boolean().nullable(),
  workplace_type: z.string().nullable(),
  employment_type: z.string().nullable(),
  commitment: z.string().nullable(),
  experience: z.union([z.number(), z.bigint()]).nullable(),
  posted_at_ms: numberValue.nullable(),
  source_updated_at_ms: numberValue.nullable(),
  application_deadline_ms: numberValue.nullable(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  salary_period: z.string().nullable(),
  salary_summary: z.string().nullable(),
});

/**
 * One Stapply posting, already mapped to the catalog's fields and tags. The id is assigned here so the staging table
 * can be inserted with one statement and the new-row marker is exact.
 */
export interface StapplyIngestRow {
  readonly postingId: string;
  readonly boardToken: string;
  readonly sourceKey: Ats;
  readonly atsJobId: string;
  readonly companyName: string;
  readonly companyNorm: string;
  readonly requisitionId: string | null;
  readonly url: string;
  readonly applyUrl: string | null;
  readonly applyUrlNorm: string;
  readonly title: string;
  readonly titleNorm: string;
  readonly department: string | null;
  readonly team: string | null;
  readonly locationRaw: string | null;
  readonly countryCode: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly language: string | null;
  readonly jobCategory: string | null;
  readonly skillRequirements: readonly string[];
  readonly exactTitleNorm: string;
  readonly locationKey: string;
  readonly workplace: Workplace;
  readonly isRemote: boolean | null;
  readonly employmentType: string;
  readonly commitment: string | null;
  readonly experience: string | null;
  readonly postedAt: number | null;
  readonly sourceUpdatedAt: number | null;
  readonly applicationDeadline: number | null;
  readonly salaryMinMinor: number | null;
  readonly salaryMaxMinor: number | null;
  readonly salaryCurrency: string | null;
  readonly salaryPeriod: "year" | "month" | "hour" | null;
  readonly salarySummary: string | null;
  readonly applySupported: boolean;
  readonly dedupeSuffix: string;
  readonly contentHash: string;
  readonly roleTag: string | null;
  readonly subroleTag: string | null;
  readonly seniorityTag: Seniority | null;
  readonly tagSource: "rules" | "llm" | null;
}

const salaryPeriodMap = new Map<string, "year" | "month" | "hour">([
  ["year", "year"],
  ["yearly", "year"],
  ["annual", "year"],
  ["annually", "year"],
  ["month", "month"],
  ["monthly", "month"],
  ["hour", "hour"],
  ["hourly", "hour"],
]);

function blankToNull(value: string | null) {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function minorUnits(value: number | null) {
  return value === null ? null : Math.round(value * 100);
}

function boardTokenFor(companyName: string) {
  const slug = companyName
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 80);

  const suffix = createHash("sha256").update(companyName.toLowerCase()).digest("hex").slice(0, 8);

  return slug === "" ? `stapply-${suffix}` : `${slug}-${suffix}`;
}

function experienceText(years: number | bigint | null) {
  if (years === null) {
    return null;
  }

  return String(Math.max(0, Math.trunc(Number(years))));
}

/**
 * Maps one projected parquet record into the catalog row, running the deterministic rule tags first. Title similarity
 * is off: it costs about 18 ms per distinct title, which is hours over a full snapshot, and the LLM pass covers the
 * titles the regex dictionary leaves unresolved.
 * @param record One row of `buildStapplyIngestQuery`'s result.
 * @returns The row to stage, or null when a required value is missing.
 */
export function mapStapplyRecord(record: Readonly<Record<string, DuckDBValue>>) {
  const parsed = parquetRowSchema.safeParse(record);

  if (!parsed.success) {
    return null;
  }

  const row = parsed.data;
  const applyUrl = blankToNull(row.apply_url);
  const experience = experienceText(row.experience);
  const primaryLocation = parseStapplyLocations(row.locations)[0];
  const locationRaw = blankToNull(row.location) ?? primaryLocation?.label ?? null;
  const jobCategory = blankToNull(row.job_category);
  const skillRequirements = parseSkillRequirements(row.skill_requirements);

  const salaryPeriod =
    row.salary_period === null
      ? null
      : (salaryPeriodMap.get(row.salary_period.toLowerCase().trim()) ?? null);

  const tags = tagPosting(
    {
      title: row.title,
      department: blankToNull(row.department),
      locationRaw,
      workplaceType: blankToNull(row.workplace_type),
      isRemote: row.is_remote,
      employmentType: blankToNull(row.employment_type),
      language: blankToNull(row.language),
      salary: {
        currency: blankToNull(row.salary_currency)?.toUpperCase() ?? null,
        minMinor: minorUnits(row.salary_min),
        maxMinor: minorUnits(row.salary_max),
        period: salaryPeriod,
      },
      descriptionText: null,
    },
    { titleSimilarity: false },
  );

  const titleNorm = normalizeTitle(row.title);
  const exactTitleNorm = normalizeExactTitle(row.title);
  const { countryCode, city } = tags;
  const locationKey = stapplyLocationKey({
    countryCode: countryCode ?? blankToNull(row.country_iso),
    location: locationRaw,
    locations: row.locations,
  });
  const region = tags.region ?? blankToNull(row.feed_region);
  const dedupeSuffix = `${titleNorm}|${countryCode ?? ""}|${city ?? ""}`;

  const rowContentHash = contentHashOf({
    applyUrl,
    applySupported: row.apply_supported,
    applicationDeadline: row.application_deadline_ms,
    atsJobId: row.ats_id,
    city,
    commitment: blankToNull(row.commitment),
    companyNorm: row.company_norm,
    countryCode,
    department: blankToNull(row.department),
    employmentType: tags.employmentType,
    experience,
    jobCategory,
    language: tags.language,
    locationRaw,
    postedAt: row.posted_at_ms,
    region,
    requisitionId: blankToNull(row.requisition_id),
    salaryCurrency: tags.salaryCurrency,
    salaryMaxMinor: tags.salaryMaxMinor,
    salaryMinMinor: tags.salaryMinMinor,
    salaryPeriod: tags.salaryPeriod,
    salarySummary: blankToNull(row.salary_summary),
    skillRequirements,
    sourceUpdatedAt: row.source_updated_at_ms,
    team: blankToNull(row.team),
    title: row.title,
    url: row.url,
    workplace: tags.workplace,
  });

  return {
    postingId: crypto.randomUUID(),
    boardToken: boardTokenFor(row.company),
    sourceKey: row.source_key,
    atsJobId: row.ats_id,
    companyName: row.company,
    companyNorm: row.company_norm,
    requisitionId: blankToNull(row.requisition_id),
    url: row.url,
    applyUrl,
    applyUrlNorm: normalizeApplyUrl(applyUrl ?? row.url),
    title: row.title,
    titleNorm,
    department: blankToNull(row.department),
    team: blankToNull(row.team),
    locationRaw,
    countryCode,
    region,
    city,
    language: tags.language,
    jobCategory,
    skillRequirements,
    exactTitleNorm,
    locationKey,
    workplace: tags.workplace,
    isRemote: row.is_remote,
    employmentType: tags.employmentType,
    commitment: blankToNull(row.commitment),
    experience,
    postedAt: row.posted_at_ms,
    sourceUpdatedAt: row.source_updated_at_ms,
    applicationDeadline: row.application_deadline_ms,
    salaryMinMinor: tags.salaryMinMinor,
    salaryMaxMinor: tags.salaryMaxMinor,
    salaryCurrency: tags.salaryCurrency,
    salaryPeriod: salaryPeriodForColumn(tags.salaryPeriod),
    salarySummary: blankToNull(row.salary_summary),
    applySupported: row.apply_supported,
    dedupeSuffix,
    contentHash: rowContentHash,
    roleTag: tags.role,
    subroleTag: tags.subrole,
    seniorityTag: tags.seniority,
    tagSource: "rules" as const,
  } satisfies StapplyIngestRow;
}

interface ContentHashInput {
  readonly applyUrl: string | null;
  readonly applySupported: boolean;
  readonly applicationDeadline: number | null;
  readonly atsJobId: string;
  readonly city: string | null;
  readonly commitment: string | null;
  readonly companyNorm: string;
  readonly countryCode: string | null;
  readonly department: string | null;
  readonly employmentType: string;
  readonly experience: string | null;
  readonly jobCategory: string | null;
  readonly language: string | null;
  readonly locationRaw: string | null;
  readonly postedAt: number | null;
  readonly region: string | null;
  readonly requisitionId: string | null;
  readonly salaryCurrency: string | null;
  readonly salaryMaxMinor: number | null;
  readonly salaryMinMinor: number | null;
  readonly salaryPeriod: string | null;
  readonly salarySummary: string | null;
  readonly skillRequirements: readonly string[];
  readonly sourceUpdatedAt: number | null;
  readonly team: string | null;
  readonly title: string;
  readonly url: string;
  readonly workplace: string;
}

/**
 * The stable fingerprint of a posting's content. A row whose fingerprint is unchanged keeps its existing tags and
 * `skills_json`; any change re-tags it.
 * @param input The content fields, in a fixed order.
 * @returns A 64-character lowercase SHA-256 hex digest.
 */
export function contentHashOf(input: ContentHashInput) {
  return contentHash(
    JSON.stringify([
      input.companyNorm,
      input.atsJobId,
      input.requisitionId,
      input.url,
      input.applyUrl,
      input.applySupported,
      input.title,
      input.department,
      input.team,
      input.locationRaw,
      input.countryCode,
      input.region,
      input.city,
      input.language,
      input.jobCategory,
      input.skillRequirements,
      input.workplace,
      input.employmentType,
      input.commitment,
      input.experience,
      input.postedAt,
      input.sourceUpdatedAt,
      input.applicationDeadline,
      input.salaryMinMinor,
      input.salaryMaxMinor,
      input.salaryCurrency,
      input.salaryPeriod,
      input.salarySummary,
    ]),
  );
}

/**
 * The row-drop guard shared by the publish step and its tests: a snapshot more than 20 % smaller than the previous
 * manifest's row count is refused unless the override is set.
 * @param previousRows The previous manifest's row count, or null on the first run.
 * @param rowCount The candidate snapshot's row count.
 * @param allowRowDrop The deliberate `workflow_dispatch` override.
 * @returns True when the candidate is too small to publish.
 */
export function isRowDrop(previousRows: number | null, rowCount: number, allowRowDrop: boolean) {
  if (allowRowDrop || previousRows === null || previousRows === 0) {
    return false;
  }

  return rowCount < previousRows * 0.8;
}

/**
 * The seed horizon for a first run: postings whose newest source timestamp is within 30 days. Later runs compare the
 * whole snapshot against the previous catalog instead.
 * @param nowMs The run's clock reading.
 * @returns The epoch-millisecond cutoff.
 */
export function seedFreshnessCutoffMs(nowMs: number) {
  return nowMs - 30 * DAY_MS;
}

export interface StapplyStreamInput {
  readonly connection: DuckDBConnection;
  readonly sql: string;
  readonly onRow: (row: StapplyIngestRow) => void;
}

/**
 * Streams the ingest query through DuckDB and maps each record, one DuckDB chunk at a time so the full snapshot never
 * sits in memory.
 * @param input The DuckDB connection, the query and the row sink.
 * @returns The number of staged rows and a per-board count.
 */
export async function streamStapplyIngest(input: StapplyStreamInput) {
  const result = await input.connection.stream(input.sql);
  const perBoard = new Map<Ats, number>();
  let rows = 0;
  let skipped = 0;

  try {
    for await (const records of result.yieldRowObjects()) {
      for (const record of records) {
        const mapped = mapStapplyRecord(record);

        if (mapped === null) {
          skipped += 1;
          continue;
        }

        input.onRow(mapped);
        rows += 1;
        perBoard.set(mapped.sourceKey, (perBoard.get(mapped.sourceKey) ?? 0) + 1);
      }
    }
  } finally {
    result.closeSync();
  }

  return { rows, skipped, perBoard };
}

/**
 * Builds the manifest the runtime verifies: the SHA-256 of the uncompressed `catalog.sqlite`, not of the compressed
 * object, because `WS-8` verifies after decompression.
 * @param input The version, build time, SQLite bytes and counts.
 * @returns A parsed manifest.
 */
export function buildCatalogManifest(input: {
  readonly version: string;
  readonly builtAt: string;
  readonly sqliteBytes: Uint8Array<ArrayBuffer>;
  readonly rowCount: number;
  readonly supportedCount: number;
  readonly tagging?: TaggingReport;
}) {
  return catalogManifestSchema.parse({
    version: input.version,
    sha256: createHash("sha256").update(input.sqliteBytes).digest("hex"),
    builtAt: input.builtAt,
    rowCount: input.rowCount,
    supportedCount: input.supportedCount,
    tagging: input.tagging,
  } satisfies CatalogManifest);
}
