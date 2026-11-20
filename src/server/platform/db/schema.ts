import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp" });

const cascadeUserId = () =>
  text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull();

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ["user", "owner"] })
    .notNull()
    .default("user"),
  suspendedAt: timestamp("suspended_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: cascadeUserId(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("account_provider_account_id").on(t.providerId, t.accountId)],
);

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  emailHash: text("email_hash").notNull().unique(),
  invitedBy: text("invited_by"),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull(),
});

export const bgJobs = sqliteTable(
  "bg_jobs",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    runAt: integer("run_at").notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status", {
      enum: ["queued", "running", "done", "failed", "dead"],
    })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    lockedUntil: integer("locked_until"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("bg_jobs_dedupe_key_queued")
      .on(t.dedupeKey)
      .where(sql`status = 'queued'`),
  ],
);

export const events = sqliteTable("events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  topic: text("topic").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

export const passkeys = sqliteTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: cascadeUserId(),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at"),
  aaguid: text("aaguid"),
});

export const passkeyAssertions = sqliteTable("passkey_assertions", {
  userId: cascadeUserId().primaryKey(),
  assertedAt: integer("asserted_at").notNull(),
});

export const adminAudit = sqliteTable("admin_audit", {
  id: text("id").primaryKey(),
  at: integer("at").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetUserId: text("target_user_id"),
  reason: text("reason").notNull(),
  detail: text("detail").notNull(),
});

export const killSwitches = sqliteTable(
  "kill_switches",
  {
    scope: text("scope", { enum: ["global", "ats", "employer", "provider"] }).notNull(),
    key: text("key").notNull(),
    enabled: integer("enabled").notNull().default(1),
    reason: text("reason").notNull().default(""),
    setBy: text("set_by", { enum: ["auto", "owner"] })
      .notNull()
      .default("owner"),
    setAt: integer("set_at").notNull(),
  },
  (t) => [uniqueIndex("kill_switches_scope_key").on(t.scope, t.key)],
);

export const probeForms = sqliteTable("probe_forms", {
  id: text("id").primaryKey(),
  postingUrl: text("posting_url").notNull(),
  company: text("company").notNull(),
  title: text("posting_title").notNull(),
  confirmMode: integer("confirm_mode").notNull(),
  outcome: text("outcome").notNull(),
  submitted: integer("submitted").notNull().default(0),
  confirmationSeen: integer("confirmation_seen").notNull().default(0),
  codeAsked: integer("code_asked").notNull().default(0),
  submitResponseStatus: integer("submit_response_status"),
  proxyMb: real("proxy_mb").notNull().default(0),
  browserMinutes: real("browser_minutes").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  sessionId: text("session_id"),
  createdAt: integer("created_at").notNull(),
});

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
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby"] }).notNull(),
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
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby"] }).notNull(),
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
  ],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    textDisplay: text("text_display").notNull(),
    textNormHash: text("text_norm_hash").notNull(),
    fieldType: text("field_type", {
      enum: [
        "text",
        "textarea",
        "select",
        "multiselect",
        "radio",
        "checkbox",
        "file",
        "date",
        "number",
        "email",
        "phone",
        "url",
      ],
    }).notNull(),
    optionsHash: text("options_hash"),
    factKey: text("fact_key"),
    answerKind: text("answer_kind", {
      enum: ["fact", "open_text", "consent", "skip", "unknown"],
    }).notNull(),
    mappedBy: text("mapped_by", { enum: ["rules", "llm", "owner"] }),
    seenCount: integer("seen_count").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("questions_text_norm_hash_unique").on(t.textNormHash)],
);

export const questionVariants = sqliteTable("question_variants", {
  variantHash: text("variant_hash").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
});

export const postingQuestions = sqliteTable(
  "posting_questions",
  {
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    options: text("options").notNull().default("[]"),
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

export const llmUsage = sqliteTable("llm_usage", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  cachedTokens: integer("cached_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costMicros: integer("cost_micros").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tagImports = sqliteTable("tag_imports", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  fileSha256: text("file_sha256").notNull(),
  rows: integer("rows").notNull(),
  matched: integer("matched").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  appliedAt: integer("applied_at").notNull(),
});

export const userKeys = sqliteTable("user_keys", {
  userId: cascadeUserId().primaryKey(),
  wrappedDek: blob("wrapped_dek", { mode: "buffer" }).notNull(),
  masterKeyVersion: integer("master_key_version").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    key: text("key").notNull(),
    valueEnc: text("value_enc").notNull(),
    source: text("source", { enum: ["resume", "user", "review", "import"] }).notNull(),
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("facts_user_key_unique").on(t.userId, t.key)],
);

export const profiles = sqliteTable("profiles", {
  userId: cascadeUserId().primaryKey(),
  languages: text("languages").notNull().default("[]"),
  timezone: text("timezone"),
  pendingTimezone: text("pending_timezone"),
  pendingTimezoneAt: timestamp("pending_timezone_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const targets = sqliteTable("targets", {
  userId: cascadeUserId().primaryKey(),
  roles: text("roles").notNull(),
  seniorities: text("seniorities").notNull(),
  workplaces: text("workplaces").notNull(),
  locations: text("locations").notNull(),
  employmentTypes: text("employment_types").notNull(),
  salaryFloorMinor: integer("salary_floor_minor"),
  salaryCurrency: text("salary_currency"),
  salaryPeriod: text("salary_period", { enum: ["year", "month", "hour"] })
    .notNull()
    .default("year"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull(),
});

export const skipCompanies = sqliteTable(
  "skip_companies",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    nameNorm: text("name_norm").notNull(),
    domain: text("domain"),
    reason: text("reason", { enum: ["current_employer", "user"] }).notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [uniqueIndex("skip_companies_user_name_unique").on(t.userId, t.nameNorm)],
);

export const resumes = sqliteTable(
  "resumes",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    objectKey: text("object_key").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    pages: integer("pages").notNull(),
    filenameEnc: text("filename_enc").notNull(),
    textEnc: text("text_enc").notNull(),
    parsedWith: text("parsed_with", { enum: ["unpdf", "llm"] }).notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    uploadedAt: timestamp("uploaded_at").notNull(),
  },
  (t) => [
    uniqueIndex("resumes_user_current_unique")
      .on(t.userId)
      .where(sql`is_current = 1`),
  ],
);

export const grants = sqliteTable(
  "grants",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    source: text("source", { enum: ["trial", "period", "admin"] }).notNull(),
    quantity: integer("quantity").notNull(),
    startsAt: integer("starts_at").notNull(),
    expiresAt: integer("expires_at"),
    stripeInvoiceId: text("stripe_invoice_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("grants_stripe_invoice_id_unique").on(t.stripeInvoiceId)],
);

export const matches = sqliteTable(
  "matches",
  {
    userId: cascadeUserId(),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    codeRank: real("code_rank").notNull(),
    score: integer("score"),
    reason: text("reason"),
    resumeId: text("resume_id").references(() => resumes.id, { onDelete: "set null" }),
    targetsVersion: integer("targets_version"),
    scoredAt: integer("scored_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postingId] }),
    index("matches_user_code_rank").on(t.userId, t.codeRank),
  ],
);

export const postingUserState = sqliteTable(
  "posting_user_state",
  {
    userId: cascadeUserId(),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["saved", "hidden"] }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postingId] })],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    postingId: text("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    origin: text("origin", { enum: ["auto", "manual"] }).notNull(),
    status: text("status", {
      enum: [
        "preparing",
        "needs_review",
        "ready",
        "sending",
        "confirming",
        "sent",
        "failed",
        "skipped",
        "withdrawn",
      ],
    }).notNull(),
    statusReason: text("status_reason"),
    stage: text("stage", {
      enum: ["queued", "applied", "screening", "interviewing", "offer", "closed"],
    }),
    stageLocked: integer("stage_locked", { mode: "boolean" }).notNull().default(false),
    boardPosition: real("board_position"),
    scoreAtQueue: integer("score_at_queue"),
    scheduledFor: integer("scheduled_for"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: integer("sent_at"),
    closedReason: text("closed_reason", {
      enum: ["rejected", "no_response", "withdrawn", "offer_declined", "offer_accepted", "other"],
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("applications_user_posting_unique").on(t.userId, t.postingId),
    uniqueIndex("applications_user_sending_unique")
      .on(t.userId)
      .where(sql`status = 'sending'`),
    index("applications_user_company").on(t.userId, t.companyId),
    index("applications_user_sent_at").on(t.userId, t.sentAt),
  ],
);

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    factKey: text("fact_key"),
    prompt: text("prompt").notNull(),
    fieldType: text("field_type", {
      enum: [
        "text",
        "textarea",
        "select",
        "multiselect",
        "radio",
        "checkbox",
        "file",
        "date",
        "number",
        "email",
        "phone",
        "url",
      ],
    }).notNull(),
    options: text("options").notNull().default("[]"),
    status: text("status", { enum: ["open", "answered", "dismissed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    uniqueIndex("reviews_user_question_open_unique")
      .on(t.userId, t.questionId)
      .where(sql`status = 'open'`),
    index("reviews_user_status").on(t.userId, t.status),
  ],
);

export const reviewApplications = sqliteTable(
  "review_applications",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.applicationId] })],
);

export const fxRates = sqliteTable(
  "fx_rates",
  {
    date: text("date").notNull(),
    currency: text("currency").notNull(),
    perUsd: real("per_usd").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.currency] }),
    check("fx_rates_per_usd_positive", sql`${t.perUsd} > 0`),
  ],
);

export const ledger = sqliteTable(
  "ledger",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    kind: text("kind", {
      enum: ["grant", "reserve", "commit", "release", "expire", "refund", "adjust"],
    }).notNull(),
    debitAccount: text("debit_account", {
      enum: ["issued", "available", "reserved", "used", "expired"],
    }).notNull(),
    creditAccount: text("credit_account", {
      enum: ["issued", "available", "reserved", "used", "expired"],
    }).notNull(),
    amount: integer("amount").notNull(),
    grantId: text("grant_id")
      .notNull()
      .references(() => grants.id),
    applicationId: text("application_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check("ledger_amount_positive", sql`${t.amount} > 0`),
    index("ledger_user_created_at").on(t.userId, t.createdAt),
    index("ledger_user_grant_kind").on(t.userId, t.grantId, t.kind),
  ],
);
