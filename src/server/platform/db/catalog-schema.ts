import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { ATS_VALUES } from "../../../shared/ats.ts";

/**
 * The public job catalog lives in its own SQLite file (`catalog.sqlite`, ADR 0036), so the sweep's heavy writes never
 * take the write lock the user-facing database needs, and Litestream never streams this easily rebuilt data.
 *
 * Cross-file references are plain logical ids: a catalog table never has a foreign key to `app.sqlite`, and an
 * application table never has a foreign key back into this file. `posting_questions.question_id` names a `questions`
 * row in `app.sqlite` for the same reason: the join happens in code, never in SQL.
 */
export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("companies_name_norm").on(t.nameNorm)],
);

export const companyBoards = sqliteTable(
  "company_boards",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ats: text("ats", { enum: ATS_VALUES }).notNull(),
    boardToken: text("board_token").notNull(),
    region: text("region", { enum: ["us", "eu"] })
      .notNull()
      .default("us"),
    status: text("status", { enum: ["active", "empty", "gone", "disabled"] })
      .notNull()
      .default("active"),
    source: text("source", { enum: ["v1_seed", "discovered", "import"] }).notNull(),
    etag: text("etag"),
    lastModified: text("last_modified"),
    contentHash: text("content_hash"),
    lastPolledAt: integer("last_polled_at"),
    nextPollAt: integer("next_poll_at"),
    backoffLevel: integer("backoff_level").notNull().default(0),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    notFoundPolls: integer("not_found_polls").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("company_boards_ats_region_board_token_unique").on(t.ats, t.region, t.boardToken),
    index("company_boards_ats_status_next_poll").on(t.ats, t.status, t.nextPollAt),
  ],
);

export const postings = sqliteTable(
  "postings",
  {
    id: text("id").primaryKey(),
    boardId: text("board_id")
      .notNull()
      .references(() => companyBoards.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ats: text("ats", { enum: ATS_VALUES }).notNull(),
    atsJobId: text("ats_job_id").notNull(),
    requisitionId: text("requisition_id"),
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    applyUrlNorm: text("apply_url_norm").notNull(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    department: text("department"),
    team: text("team"),
    locationRaw: text("location_raw"),
    countryCode: text("country_code"),
    region: text("region"),
    city: text("city"),
    language: text("language"),
    workplace: text("workplace", { enum: ["remote", "hybrid", "onsite", "unknown"] })
      .notNull()
      .default("unknown"),
    /**
     * The feed's own remote flag, kept beside `workplace` for the Stapply ingest. `true` means remote; `NULL`
     * means unknown. An `is_remote=false` row is not treated as on-site, because a missing flag is common and
     * `workplace` stays the normalized answer every read uses.
     */
    isRemote: integer("is_remote", { mode: "boolean" }),
    employmentType: text("employment_type", {
      enum: ["full_time", "part_time", "contract", "internship", "temporary", "unknown"],
    })
      .notNull()
      .default("unknown"),
    commitment: text("commitment"),
    experience: text("experience"),
    postedAt: integer("posted_at"),
    applicationDeadline: integer("application_deadline"),
    salaryMinMinor: integer("salary_min_minor"),
    salaryMaxMinor: integer("salary_max_minor"),
    /** The same range annualized to USD (issue #630), so a salary filter is one integer comparison. */
    salaryMinUsd: integer("salary_min_usd"),
    salaryMaxUsd: integer("salary_max_usd"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period", { enum: ["year", "month", "hour"] }),
    salarySummary: text("salary_summary"),
    sourceUpdatedAt: integer("source_updated_at"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    missingPolls: integer("missing_polls").notNull().default(0),
    closedAt: integer("closed_at"),
    /** `open` while the board lists the Posting; `closed` once it is gone. Both move together with `closed_at`. */
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    /** Whether Overture has a deterministic apply adapter for this Posting's ATS (issue #563). */
    applySupported: integer("apply_supported", { mode: "boolean" }).notNull().default(false),
    dedupeKey: text("dedupe_key").notNull(),
    contentHash: text("content_hash"),
    /** The feed's own category string (`job_category` for Stapply), kept for the classifier and never shown raw. */
    jobCategory: text("job_category"),
    /** The Level-1 broad category the classifier resolved, from `ROLE_GROUPS`. */
    primaryCategory: text("primary_category"),
    /** The Level-2 granular role the classifier resolved. */
    primaryRole: text("primary_role"),
    /** The Level-3 ESCO v1.2.1 occupation code, when an alias or the embedding tier resolved one. */
    escoCode: text("esco_code"),
    /** When the three-tier classifier last attempted this posting, so a bounded run still progresses each day. */
    classifiedAt: integer("classified_at"),
    skillsJson: text("skills_json"),
    descriptionGz: blob("description_gz", { mode: "buffer" }),
    descriptionHash: text("description_hash"),
    feedContentHash: text("feed_content_hash"),
    tagSource: text("tag_source", { enum: ["rules", "model", "llm", "import"] }),
    taggedAt: integer("tagged_at"),
    questionsFetchedAt: integer("questions_fetched_at"),
  },
  (t) => [
    uniqueIndex("postings_board_ats_job_unique").on(t.boardId, t.atsJobId),
    index("postings_dedupe_key").on(t.dedupeKey),
    index("postings_apply_url_norm").on(t.applyUrlNorm),
    index("postings_closed_at").on(t.closedAt),
    index("postings_ats_closed_last_seen").on(t.ats, t.closedAt, t.lastSeenAt),
    index("postings_apply_supported_status").on(t.applySupported, t.status),
    index("postings_company_requisition").on(t.companyId, t.requisitionId),
    index("postings_primary_category").on(t.primaryCategory),
    index("postings_esco_code").on(t.escoCode),
    index("postings_open_location")
      .on(t.city, t.countryCode, t.locationRaw, t.workplace, t.closedAt)
      .where(sql`closed_at is null`),
    index("postings_supply_ats")
      .on(t.applySupported, t.status, t.ats)
      .where(sql`closed_at is null`),
    index("postings_supply_country")
      .on(t.applySupported, t.status, t.countryCode, t.workplace, t.ats)
      .where(sql`closed_at is null`),
    index("postings_live_city")
      .on(t.countryCode, sql`lower(${t.city})`)
      .where(sql`closed_at is null`),
    index("postings_live_region")
      .on(t.countryCode, sql`lower(${t.region})`)
      .where(sql`closed_at is null`),
  ],
);

export const postingQuestions = sqliteTable(
  "posting_questions",
  {
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    options: text("options").notNull().default("[]"),
    fieldName: text("field_name"),
  },
  (t) => [primaryKey({ columns: [t.postingId, t.questionId] })],
);

export const postingTags = sqliteTable(
  "posting_tags",
  {
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    dimension: text("dimension", {
      enum: ["role", "subrole", "seniority", "granular_role", "skill", "esco"],
    }).notNull(),
    value: text("value").notNull(),
    source: text("source", { enum: ["rules", "model", "llm", "import"] }).notNull(),
    /** The classifier's confidence for a weighted tag (a cosine similarity or a model score); null when unweighted. */
    weight: real("weight"),
  },
  (t) => [
    primaryKey({ columns: [t.postingId, t.dimension, t.value] }),
    index("posting_tags_dimension_value_posting").on(t.dimension, t.value, t.postingId),
  ],
);

/**
 * The retired `/api/supply` rollup (issues #631, #742). One row per `(role, country, region, workplace, ats)`
 * over open apply-supported catalog Postings. `/api/supply` now counts the freehire `jobs` rows in `app.sqlite` and
 * no longer reads this table; the fixed columns stay in the legacy catalog schema so an older `catalog.sqlite` still
 * opens and verifies unchanged while the file remains on disk.
 *
 * `role` is the role or subrole tag value, or the `*` sentinel for the any-role total. A Posting with two
 * role tags therefore appears under each tag and exactly once under `*`, so the unfiltered total never
 * double counts it. `country_code` and `region` use `''` for SQL NULL because a SQLite primary key treats
 * NULLs as distinct; `region` is lowercased to match `location-filter`'s `lower(region)` comparison.
 */
export const supplyFacets = sqliteTable(
  "supply_facets",
  {
    role: text("role").notNull(),
    countryCode: text("country_code").notNull(),
    region: text("region").notNull(),
    workplace: text("workplace").notNull(),
    ats: text("ats", { enum: ATS_VALUES }).notNull(),
    postings: integer("postings").notNull(),
  },
  (t) => [primaryKey({ columns: [t.role, t.countryCode, t.region, t.workplace, t.ats] })],
);

/**
 * The compact open-data place table the ETL builds inside `catalog.sqlite` (issue #630). One row per
 * continent, country, ISO-3166-2 region, colloquial metro and GeoNames city; the `kind` column says which.
 * The R-Tree (`geo_places_rtree`) is created by the migration, not by Drizzle, and indexes only cities.
 */
export const GEO_PLACE_KINDS = ["continent", "country", "region", "metro", "city"] as const;

export type GeoPlaceKind = (typeof GEO_PLACE_KINDS)[number];

export const geoPlaces = sqliteTable(
  "geo_places",
  {
    geonameId: integer("geoname_id").primaryKey(),
    name: text("name").notNull(),
    normName: text("norm_name").notNull(),
    altNames: text("alt_names"),
    kind: text("kind", { enum: GEO_PLACE_KINDS }).notNull(),
    continentCode: text("continent_code"),
    countryCode: text("country_code"),
    isoRegionCode: text("iso_region_code"),
    lat: real("lat"),
    lon: real("lon"),
    minLat: real("min_lat"),
    maxLat: real("max_lat"),
    minLon: real("min_lon"),
    maxLon: real("max_lon"),
    population: integer("population").notNull().default(0),
  },
  (t) => [
    index("geo_places_norm_name").on(t.normName),
    index("geo_places_kind_country").on(t.kind, t.countryCode),
    index("geo_places_country_region").on(t.countryCode, t.isoRegionCode),
  ],
);

/** The workplace scopes a Posting resolves to (issue #630), one row per place a location string names. */
export const POSTING_SCOPE_KINDS = [
  "onsite",
  "hybrid",
  "remote_city",
  "remote_region",
  "remote_country",
  "remote_continent",
  "remote_global",
] as const;

export type PostingScopeKind = (typeof POSTING_SCOPE_KINDS)[number];

export const postingLocations = sqliteTable(
  "posting_locations",
  {
    id: integer("id").primaryKey(),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    continentCode: text("continent_code"),
    countryCode: text("country_code"),
    /** The ISO-3166-2 code (`CA-ON`), never the legacy GeoNames `CA.08` spelling. */
    regionCode: text("region_code"),
    cityGeonameId: integer("city_geoname_id"),
    scopeKind: text("scope_kind", { enum: POSTING_SCOPE_KINDS }).notNull(),
  },
  (t) => [
    index("posting_locations_continent_posting").on(t.continentCode, t.postingId),
    index("posting_locations_country_posting").on(t.countryCode, t.postingId),
    index("posting_locations_country_region_posting").on(t.countryCode, t.regionCode, t.postingId),
    index("posting_locations_city_posting").on(t.cityGeonameId, t.postingId),
    index("posting_locations_scope_country_posting").on(t.scopeKind, t.countryCode, t.postingId),
  ],
);
