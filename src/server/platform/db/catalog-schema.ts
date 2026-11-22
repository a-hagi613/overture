import { sql } from "drizzle-orm";
import {
  blob,
  index,
  integer,
  primaryKey,
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
export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nameNorm: text("name_norm").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  createdAt: integer("created_at").notNull(),
});

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
    url: text("url").notNull(),
    applyUrl: text("apply_url"),
    applyUrlNorm: text("apply_url_norm").notNull(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    department: text("department"),
    locationRaw: text("location_raw"),
    countryCode: text("country_code"),
    region: text("region"),
    city: text("city"),
    language: text("language"),
    workplace: text("workplace", { enum: ["remote", "hybrid", "onsite", "unknown"] })
      .notNull()
      .default("unknown"),
    employmentType: text("employment_type", {
      enum: ["full_time", "part_time", "contract", "internship", "temporary", "unknown"],
    })
      .notNull()
      .default("unknown"),
    postedAt: integer("posted_at"),
    salaryMinMinor: integer("salary_min_minor"),
    salaryMaxMinor: integer("salary_max_minor"),
    salaryCurrency: text("salary_currency"),
    salaryPeriod: text("salary_period", { enum: ["year", "month", "hour"] }),
    sourceUpdatedAt: integer("source_updated_at"),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    missingPolls: integer("missing_polls").notNull().default(0),
    closedAt: integer("closed_at"),
    dedupeKey: text("dedupe_key").notNull(),
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
    index("postings_open_location")
      .on(t.city, t.countryCode, t.locationRaw, t.workplace, t.closedAt)
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
    dimension: text("dimension", { enum: ["role", "subrole", "seniority"] }).notNull(),
    value: text("value").notNull(),
    source: text("source", { enum: ["rules", "model", "llm", "import"] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postingId, t.dimension, t.value] }),
    index("posting_tags_dimension_value").on(t.dimension, t.value),
  ],
);
