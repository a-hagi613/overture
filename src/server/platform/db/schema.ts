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

import { CHECKIN_ANSWERS } from "../../../shared/checkins.ts";

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
  role: text("role", { enum: ["user", "owner", "demo"] })
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
  reauthAt: timestamp("reauth_at"),
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
  emailEnc: text("email_enc"),
  invitedBy: text("invited_by"),
  acceptedAt: timestamp("accepted_at"),
  acceptedUserId: text("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at"),
  grantId: text("grant_id").references(() => grants.id, { onDelete: "set null" }),
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

export const consentVersions = sqliteTable("consent_versions", {
  version: text("version").primaryKey(),
  text: text("text").notNull(),
  publishedAt: timestamp("published_at").notNull(),
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
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby", "workable", "personio"] }).notNull(),
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
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby", "workable", "personio"] }).notNull(),
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

export const workableIngests = sqliteTable(
  "workable_ingests",
  {
    id: text("id").primaryKey(),
    snapshotKey: text("snapshot_key").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    sourceLastModified: text("source_last_modified"),
    rows: integer("rows").notNull(),
    contentHash: text("content_hash").notNull(),
    added: integer("added").notNull(),
    updated: integer("updated").notNull(),
    closed: integer("closed").notNull(),
    ingestedAt: integer("ingested_at").notNull(),
  },
  (t) => [
    uniqueIndex("workable_ingests_snapshot_unique").on(t.snapshotKey),
    index("workable_ingests_ingested_at").on(t.ingestedAt),
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
      enum: ["fact", "target", "derived", "open_text", "consent", "skip", "unknown"],
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

export const mailUsage = sqliteTable("mail_usage", {
  month: text("month").primaryKey(),
  authSends: integer("auth_sends").notNull().default(0),
  systemSends: integer("system_sends").notNull().default(0),
  noticeSends: integer("notice_sends").notNull().default(0),
  warnedAt: integer("warned_at"),
  /** When notices first stopped at the sign-in reserve. */
  reserveRefusedAt: integer("reserve_refused_at"),
  /** When every kind of mail first stopped at the monthly cap. */
  refusedAt: integer("refused_at"),
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
    scope: text("scope").notNull().default(""),
    valueEnc: text("value_enc").notNull(),
    source: text("source", { enum: ["resume", "user", "review", "import"] }).notNull(),
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [uniqueIndex("facts_user_key_scope_unique").on(t.userId, t.key, t.scope)],
);

export const profiles = sqliteTable("profiles", {
  userId: cascadeUserId().primaryKey(),
  running: integer("running", { mode: "boolean" }).notNull().default(false),
  pauseReason: text("pause_reason", {
    enum: [
      "user",
      "onboarding",
      "no_resume",
      "plan_ended",
      "payment_failed",
      "suspended",
      "no_mailbox",
    ],
  }).default("onboarding"),
  languages: text("languages").notNull().default("[]"),
  onboardingStep: integer("onboarding_step").notNull().default(1),
  onboardedAt: timestamp("onboarded_at"),
  timezone: text("timezone"),
  pendingTimezone: text("pending_timezone"),
  pendingTimezoneAt: timestamp("pending_timezone_at"),
  consentVersion: text("consent_version").notNull().default("1"),
  consentAt: timestamp("consent_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const browserProfiles = sqliteTable(
  "browser_profiles",
  {
    userId: cascadeUserId(),
    provider: text("provider", { enum: ["browser_use", "kernel", "local"] }).notNull(),
    providerProfileId: text("provider_profile_id").notNull(),
    countryCode: text("country_code").notNull(),
    createdAt: timestamp("created_at").notNull(),
    lastUsedAt: timestamp("last_used_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

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

export const mailboxes = sqliteTable("mailboxes", {
  id: text("id").primaryKey(),
  userId: cascadeUserId().unique(),
  localPart: text("local_part").notNull().unique(),
  status: text("status", { enum: ["active", "receive_only", "closed"] })
    .notNull()
    .default("active"),
  receiveUntil: timestamp("receive_until"),
  firstForwardedAt: timestamp("first_forwarded_at"),
  createdAt: timestamp("created_at").notNull(),
});

export const retiredAddresses = sqliteTable("retired_addresses", {
  localPart: text("local_part").primaryKey(),
  retiredAt: timestamp("retired_at").notNull(),
});

export const mailThreads = sqliteTable(
  "mail_threads",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    applicationId: text("application_id"),
    subjectEnc: text("subject_enc").notNull(),
    employerStarted: integer("employer_started", { mode: "boolean" }).notNull().default(false),
    lastMessageAt: timestamp("last_message_at").notNull(),
  },
  (t) => [index("mail_threads_user_last_message").on(t.userId, t.lastMessageAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => mailThreads.id, { onDelete: "cascade" }),
    userId: cascadeUserId(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["in", "out"] }).notNull(),
    rfcMessageId: text("rfc_message_id").notNull(),
    inReplyTo: text("in_reply_to"),
    senderDomain: text("sender_domain").notNull(),
    auth: text("auth", { enum: ["pass", "fail", "none"] }).notNull(),
    fromEnc: text("from_enc").notNull(),
    toEnc: text("to_enc").notNull(),
    subjectEnc: text("subject_enc").notNull(),
    textEnc: text("text_enc").notNull(),
    htmlObjectKey: text("html_object_key"),
    snippetEnc: text("snippet_enc").notNull(),
    classification: text("classification", {
      enum: ["ack", "code", "rejection", "screening", "interview", "offer", "other"],
    }),
    codeConsumedAt: timestamp("code_consumed_at"),
    readAt: timestamp("read_at"),
    outStatus: text("out_status", { enum: ["queued", "sent", "bounced", "failed"] }),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_mailbox_rfc_message_id_unique").on(t.mailboxId, t.rfcMessageId),
    index("messages_thread_created").on(t.threadId, t.createdAt),
  ],
);

export const messageAttachments = sqliteTable(
  "message_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filenameEnc: text("filename_enc").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    objectKey: text("object_key").notNull(),
  },
  (t) => [index("message_attachments_message_id").on(t.messageId)],
);

export const codeWaits = sqliteTable(
  "code_waits",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id"),
    startedAt: timestamp("started_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: text("resolved_by", { enum: ["mail", "paste"] }),
    resolvedMessageId: text("resolved_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    codeEnc: text("code_enc"),
  },
  (t) => [index("code_waits_mailbox_open").on(t.mailboxId, t.resolvedAt, t.startedAt)],
);

export const liveCheckResults = sqliteTable(
  "live_check_results",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    checkName: text("check_name").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    startedAt: integer("started_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    detail: text("detail").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("live_check_results_run").on(t.runId),
    index("live_check_results_check_started").on(t.checkName, t.startedAt),
  ],
);

export const liveCheckMail = sqliteTable(
  "live_check_mail",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    code: text("code").notNull(),
    toAddress: text("to_address").notNull(),
    sentAt: integer("sent_at").notNull(),
    receivedAt: integer("received_at"),
    auth: text("auth", { enum: ["pass", "fail", "none"] }),
    receivedCode: text("received_code"),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [index("live_check_mail_sent").on(t.sentAt)],
);

export const labRuns = sqliteTable(
  "lab_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    provider: text("provider", { enum: ["browser_use", "kernel", "local"] }).notNull(),
    page: text("page", { enum: ["recaptcha_v3", "hcaptcha", "turnstile", "form"] }).notNull(),
    ats: text("ats"),
    outcome: text("outcome", { enum: ["completed", "challenge_blocked", "error"] }).notNull(),
    challengeSeen: integer("challenge_seen", { mode: "boolean" }).notNull().default(false),
    codeAsked: integer("code_asked", { mode: "boolean" }).notNull().default(false),
    captchaScore: real("captcha_score"),
    durationMs: integer("duration_ms").notNull(),
    proxyBytes: integer("proxy_bytes"),
    costMicros: integer("cost_micros"),
    sessionId: text("session_id"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at").notNull(),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("lab_runs_provider_started").on(t.provider, t.startedAt),
    index("lab_runs_run").on(t.runId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    createdAt: integer("created_at").notNull(),
    readAt: timestamp("read_at"),
    pushedAt: timestamp("pushed_at"),
    emailedAt: timestamp("emailed_at"),
  },
  (t) => [index("notifications_user_created").on(t.userId, t.createdAt)],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at").notNull(),
    lastOkAt: timestamp("last_ok_at"),
  },
  (t) => [index("push_subscriptions_user").on(t.userId)],
);

export const accountExports = sqliteTable(
  "account_exports",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    status: text("status", { enum: ["preparing", "ready", "expired", "failed"] }).notNull(),
    objectKey: text("object_key"),
    keyEnc: text("key_enc").notNull(),
    bytes: integer("bytes"),
    error: text("error"),
    notifiedAt: timestamp("notified_at"),
    requestedAt: timestamp("requested_at").notNull(),
    readyAt: timestamp("ready_at"),
    expiresAt: timestamp("expires_at"),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    index("account_exports_user_requested").on(t.userId, t.requestedAt),
    uniqueIndex("account_exports_one_preparing")
      .on(t.userId)
      .where(sql`status = 'preparing'`),
  ],
);

export const customers = sqliteTable("customers", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * One row per card, keyed by HMAC of the Stripe card fingerprint (ADR 0018).
 * Deliberately has no foreign key to users: the row must survive account
 * deletion so the same card cannot take a second trial.
 */
export const cardFingerprints = sqliteTable("card_fingerprints", {
  hmac: text("hmac").primaryKey(),
  trialUsedAt: integer("trial_used_at"),
  createdAt: integer("created_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    plan: text("plan", { enum: ["week", "month"] }).notNull(),
    status: text("status").notNull(),
    currentPeriodStart: integer("current_period_start").notNull(),
    currentPeriodEnd: integer("current_period_end").notNull(),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("subscriptions_stripe_subscription_id_unique").on(t.stripeSubscriptionId),
    index("subscriptions_user").on(t.userId),
  ],
);

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at").notNull(),
  processedAt: integer("processed_at"),
});

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
        "approved",
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
      enum: ["queued", "ready", "applied", "screening", "interviewing", "offer", "closed"],
    }),
    stageLocked: integer("stage_locked", { mode: "boolean" }).notNull().default(false),
    boardPosition: real("board_position"),
    scoreAtQueue: integer("score_at_queue"),
    scheduledFor: integer("scheduled_for"),
    attempts: integer("attempts").notNull().default(0),
    readyAt: integer("ready_at"),
    approvedAt: integer("approved_at"),
    approvedPlanSha256: text("approved_plan_sha256"),
    approvedPlanEnc: text("approved_plan_enc"),
    changes: text("changes"),
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

export const applicationSnapshots = sqliteTable("application_snapshots", {
  applicationId: text("application_id")
    .primaryKey()
    .references(() => applications.id, { onDelete: "cascade" }),
  userId: cascadeUserId(),
  postingUrl: text("posting_url").notNull(),
  postingTitle: text("posting_title").notNull(),
  descriptionHash: text("description_hash"),
  answersEnc: text("answers_enc").notNull(),
  coverLetterEnc: text("cover_letter_enc"),
  resumeId: text("resume_id")
    .notNull()
    .references(() => resumes.id, { onDelete: "cascade" }),
  resumeSha256: text("resume_sha256").notNull(),
  consentVersion: text("consent_version").notNull(),
  approvedAt: integer("approved_at"),
  approvedPlanSha256: text("approved_plan_sha256"),
  provider: text("provider").notNull(),
  providerSessionId: text("provider_session_id"),
  submittedAt: integer("submitted_at").notNull(),
  confirmedBy: text("confirmed_by", { enum: ["page", "email"] }).notNull(),
  costMicros: integer("cost_micros").notNull().default(0),
});

export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    userId: cascadeUserId(),
    at: integer("at").notNull(),
    kind: text("kind", { enum: ["status", "stage", "email", "checkin", "note"] }).notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    source: text("source", { enum: ["system", "user", "email", "checkin", "admin"] }).notNull(),
    detail: text("detail"),
  },
  (t) => [index("application_events_application_at").on(t.applicationId, t.at)],
);

export const interviewEvents = sqliteTable(
  "interview_events",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    uid: text("uid").notNull(),
    sequence: integer("sequence").notNull().default(0),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at"),
    tz: text("tz"),
    source: text("source", { enum: ["ics"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("interview_events_user_uid_unique").on(t.userId, t.uid),
    index("interview_events_user_starts").on(t.userId, t.startsAt),
    index("interview_events_message").on(t.messageId),
  ],
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    userId: cascadeUserId(),
    n: integer("n").notNull(),
    provider: text("provider", { enum: ["browser_use", "kernel", "local"] }).notNull(),
    providerSessionId: text("provider_session_id"),
    startedAt: integer("started_at").notNull(),
    leaseUntil: integer("lease_until").notNull(),
    endedAt: integer("ended_at"),
    submitClickedAt: integer("submit_clicked_at"),
    submitResponseStatus: integer("submit_response_status"),
    outcome: text("outcome", {
      enum: [
        "sent",
        "unconfirmed",
        "captcha_blocked",
        "code_timeout",
        "posting_closed",
        "form_changed",
        "blocked",
        "upload_failed",
        "duplicate",
        "identity_mismatch",
        "needs_review",
        "provider_error",
        "timeout",
        "crash",
        "interrupted",
      ],
    }),
    browserMs: integer("browser_ms"),
    proxyBytes: integer("proxy_bytes"),
    captchaSeen: integer("captcha_seen", { mode: "boolean" }).notNull().default(false),
    codeUsed: integer("code_used", { mode: "boolean" }).notNull().default(false),
    costMicros: integer("cost_micros"),
    errorCode: text("error_code"),
  },
  (t) => [
    index("attempts_application").on(t.applicationId, t.startedAt),
    index("attempts_user_lease").on(t.userId, t.leaseUntil),
  ],
);

export const applicationAnswers = sqliteTable(
  "application_answers",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: cascadeUserId(),
    kind: text("kind", { enum: ["open_text", "cover_letter"] }).notNull(),
    sentencesEnc: text("sentences_enc").notNull(),
    wordCount: integer("word_count").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("application_answers_application_question_unique").on(
      t.applicationId,
      t.questionId,
    ),
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
    scope: text("scope").notNull().default(""),
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
    reason: text("reason", {
      enum: ["unknown_required", "option_missing"],
    })
      .notNull()
      .default("unknown_required"),
    attemptId: text("attempt_id"),
    status: text("status", { enum: ["open", "answered", "dismissed"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    uniqueIndex("reviews_user_question_scope_open_unique")
      .on(t.userId, t.questionId, t.scope)
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

export const reviewAuditEvents = sqliteTable(
  "review_audit_events",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    at: integer("at").notNull(),
    kind: text("kind", {
      enum: ["review_opened", "review_resolved", "auto_answer", "snapshot_sent"],
    }).notNull(),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    reviewId: text("review_id").references(() => reviews.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }),
    ats: text("ats", { enum: ["greenhouse", "lever", "ashby", "workable", "personio"] }),
    source: text("source", {
      enum: ["fact", "target", "derived", "consent", "file", "open_text"],
    }),
    factKey: text("fact_key"),
    factRevision: integer("fact_revision"),
    scope: text("scope").notNull().default(""),
    detail: text("detail").notNull().default("{}"),
  },
  (t) => [
    index("review_audit_events_user_at").on(t.userId, t.at),
    index("review_audit_events_kind_at").on(t.kind, t.at),
    index("review_audit_events_application").on(t.applicationId),
  ],
);

export const checkins = sqliteTable(
  "checkins",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    userId: cascadeUserId(),
    dueAt: integer("due_at").notNull(),
    status: text("status", { enum: ["open", "answered", "expired"] }).notNull(),
    answer: text("answer", { enum: CHECKIN_ANSWERS }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("checkins_application_unique").on(t.applicationId),
    index("checkins_user_status_due").on(t.userId, t.status, t.dueAt),
  ],
);

export const planCache = sqliteTable(
  "plan_cache",
  {
    id: text("id").primaryKey(),
    ats: text("ats", { enum: ["lever", "ashby", "workable", "personio"] }).notNull(),
    formSignature: text("form_signature").notNull(),
    plan: text("plan").notNull(),
    hits: integer("hits").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("plan_cache_ats_signature_unique").on(t.ats, t.formSignature)],
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
