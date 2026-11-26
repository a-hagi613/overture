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

import { CALENDAR_CUSTOM_EVENT_KINDS } from "../../../shared/calendar-events.ts";
import { CHECKIN_ANSWERS } from "../../../shared/checkins.ts";
import { APPLY_SUPPORTED_ATS, ATS_VALUES, PLAN_CACHE_ATS } from "../../../shared/ats.ts";
import { SUPPORT_CATEGORIES, SUPPORT_TICKET_STATUSES } from "../../../shared/support.ts";
import { POSTING_FLAG_REASONS } from "../../../shared/posting-flags.ts";

const timestamp = (name: string) => integer(name, { mode: "timestamp" });

const cascadeUserId = () =>
  text("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull();

const mailbox = sql`case
  when instr(lower(trim(email)), '@') = 0 then lower(trim(email))
  when lower(substr(lower(trim(email)), instr(lower(trim(email)), '@') + 1)) in ('gmail.com', 'googlemail.com')
    and replace(substr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1), 1, instr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1) || '+', '+') - 1), '.', '') <> ''
  then replace(substr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1), 1, instr(substr(lower(trim(email)), 1, instr(lower(trim(email)), '@') - 1) || '+', '+') - 1), '.', '') || '@gmail.com'
  else lower(trim(email))
end`;

export const users = sqliteTable(
  "users",
  {
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
    mailbox: text("mailbox").generatedAlwaysAs(mailbox, { mode: "virtual" }),
  },
  (table) => [uniqueIndex("users_mailbox_unique").on(table.mailbox)],
);

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    reauthAt: timestamp("reauth_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("session_user_id").on(t.userId)],
);

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
    index("bg_jobs_claim_due")
      .on(t.status, t.runAt)
      .where(sql`status IN ('queued', 'running')`),
    index("bg_jobs_status_updated").on(t.status, t.updatedAt),
  ],
);

export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    userId: text("user_id"),
    topic: text("topic").notNull(),
    payload: text("payload").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("events_user_seq").on(t.userId, t.seq), index("events_created_at").on(t.createdAt)],
);

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

export const adminAudit = sqliteTable(
  "admin_audit",
  {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetUserId: text("target_user_id"),
    reason: text("reason").notNull(),
    detail: text("detail").notNull(),
  },
  (t) => [
    index("admin_audit_at").on(t.at),
    index("admin_audit_target_user_at").on(t.targetUserId, t.at),
  ],
);

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

export const llmUsage = sqliteTable(
  "llm_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cachedTokens: integer("cached_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costMicros: integer("cost_micros").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("llm_usage_created_at").on(t.createdAt)],
);

export const llmBatches = sqliteTable(
  "llm_batches",
  {
    id: text("id").primaryKey(),
    inputRevisionHash: text("input_revision_hash").notNull(),
    model: text("model").notNull(),
    batchId: text("batch_id"),
    status: text("status", { enum: ["creating", "in_progress", "applied", "failed"] })
      .notNull()
      .default("creating"),
    results: text("results"),
    resultAppliedAt: integer("result_applied_at"),
    expiresAt: integer("expires_at"),
    lastPolledAt: integer("last_polled_at"),
    lastError: text("last_error"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("llm_batches_input_revision_hash_unique").on(t.inputRevisionHash),
    index("llm_batches_status_updated").on(t.status, t.updatedAt),
  ],
);

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
  /**
   * When true, new applications use the person's sign-in email instead of their assigned apply
   * alias, so verification codes arrive in their own mailbox and are pasted by hand (issue #566).
   */
  usePersonalEmail: integer("use_personal_email", { mode: "boolean" }).notNull().default(false),
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
    companyId: text("company_id"),
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
  /**
   * The full apply address given to employers, e.g. `alex.chen.4k@tryoverture.com` (issue #566). It
   * is stored complete so changing `ALIAS_EMAIL_DOMAIN` never rewrites an assigned alias.
   */
  applyAddress: text("apply_address").unique(),
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

/**
 * The durable plan for one account erasure. It is written in the same transaction that deletes the
 * account, so the vendor profile ids and object prefixes survive the cascade that removes
 * `browser_profiles`, and the confirmation target survives until the notice is queued. It has no
 * foreign key on purpose: it outlives the `users` row it names.
 *
 * `vendor_profiles` shrinks as each remote profile is deleted, `object_prefixes` stays until every
 * prefix lists empty, and both `*_cleaned_at` stamps mean the external cleanup was confirmed. The
 * `notice_name` and `notice_to` columns are wiped as soon as `notice_queued_at` is set.
 */
export const accountErasures = sqliteTable("account_erasures", {
  userId: text("user_id").primaryKey(),
  vendorProfiles: text("vendor_profiles").notNull().default("[]"),
  objectPrefixes: text("object_prefixes").notNull(),
  noticeName: text("notice_name"),
  noticeTo: text("notice_to"),
  userDeletedAt: timestamp("user_deleted_at"),
  vendorCleanedAt: timestamp("vendor_cleaned_at"),
  objectsCleanedAt: timestamp("objects_cleaned_at"),
  noticeQueuedAt: timestamp("notice_queued_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
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
    index("messages_user_created").on(t.userId, t.createdAt),
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

/**
 * The one forwarded copy of an inbound Message, written in the same transaction that stores the
 * Message (issue #693). Its `status` is the delivery record the Inbox surfaces: `sent` after the
 * provider accepts it, `failed` when a send attempt was refused, `bounced` when the provider reports
 * a permanent bounce, and `skipped` when the copy would loop or the account has no verified address.
 * `detail` is a short reason code, never message content.
 */
export const mailDeliveries = sqliteTable(
  "mail_deliveries",
  {
    id: text("id").primaryKey(),
    mailboxId: text("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "sent", "failed", "bounced", "skipped"],
    })
      .notNull()
      .default("pending"),
    detail: text("detail"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("mail_deliveries_message_unique").on(t.messageId),
    index("mail_deliveries_mailbox_status").on(t.mailboxId, t.status),
  ],
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
    /** How many events this row covers; 1 for a single event, >1 for a batched row (#705). */
    batchCount: integer("batch_count").notNull().default(1),
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
  (t) => [
    uniqueIndex("grants_stripe_invoice_id_unique").on(t.stripeInvoiceId),
    index("grants_user_starts").on(t.userId, t.startsAt),
    index("grants_paying_subscribers").on(t.source, t.startsAt, t.expiresAt, t.userId),
  ],
);

/**
 * A user's ranking of one catalog Posting. `posting_id` is a plain logical id, not a foreign key: the catalog can be
 * pruned or rebuilt without touching user data (SPEC §5.4).
 */
export const matches = sqliteTable(
  "matches",
  {
    userId: cascadeUserId(),
    postingId: text("posting_id").notNull(),
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

/**
 * What a user saved or hid in their Home feed. `posting_id` is a plain logical id, not a foreign key, so a catalog
 * prune never touches this row (SPEC §5.4).
 */
export const postingUserState = sqliteTable(
  "posting_user_state",
  {
    userId: cascadeUserId(),
    postingId: text("posting_id").notNull(),
    state: text("state", { enum: ["saved", "hidden"] }).notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postingId] })],
);

/**
 * A Posting that keeps failing on the live form, kept in `app.sqlite` because the catalog is a read-only artifact the
 * app hot-swaps and never writes (issue #576). `posting_id` is a plain logical id into `catalog.sqlite`, exactly like
 * `posting_user_state`, so a swap never leaves a dangling foreign key. A row is created on the first failure so
 * `fail_count` can reach the reason's threshold; only a row at or over the threshold is excluded from matching.
 */
export const catalogPostingFlags = sqliteTable(
  "catalog_posting_flags",
  {
    postingId: text("posting_id").primaryKey(),
    flagReason: text("flag_reason", { enum: POSTING_FLAG_REASONS }).notNull(),
    failCount: integer("fail_count").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("catalog_posting_flags_updated").on(t.updatedAt)],
);

/**
 * One Application the user has queued, prepared or sent. `posting_id` and `company_id` are logical ids only: the row
 * carries its own copy of the display fields taken when it was created (SPEC §5.4), so pruning or rebuilding the
 * catalog can never break the Board, Ready, Home, Inbox, Calendar or the cost report.
 */
export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    postingId: text("posting_id").notNull(),
    companyId: text("company_id").notNull(),
    ats: text("ats", { enum: ATS_VALUES }),
    companyName: text("company_name").notNull(),
    companyNameNorm: text("company_name_norm").notNull(),
    companyDomain: text("company_domain"),
    postingTitle: text("posting_title").notNull(),
    postingUrl: text("posting_url").notNull(),
    applyUrl: text("apply_url"),
    locationRaw: text("location_raw"),
    salaryCurrency: text("salary_currency"),
    salaryMinMinor: integer("salary_min_minor"),
    salaryMaxMinor: integer("salary_max_minor"),
    salaryPeriod: text("salary_period", { enum: ["year", "month", "hour"] }),
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
    browserCostMicros: integer("browser_cost_micros").notNull().default(0),
    retryCostMicros: integer("retry_cost_micros").notNull().default(0),
    llmCostMicros: integer("llm_cost_micros").notNull().default(0),
    costRecordedAt: integer("cost_recorded_at"),
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
    index("applications_user_status").on(t.userId, t.status),
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

export const applicationReceipts = sqliteTable(
  "application_receipts",
  {
    applicationId: text("application_id")
      .primaryKey()
      .references(() => applications.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    confirmedAt: integer("confirmed_at").notNull(),
  },
  (t) => [uniqueIndex("application_receipts_message_unique").on(t.messageId)],
);

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
  (t) => [
    index("application_events_application_at").on(t.applicationId, t.at),
    index("application_events_user_kind_at").on(t.userId, t.kind, t.at),
  ],
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
    index("attempts_started_at").on(t.startedAt),
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
    kind: text("kind", { enum: ["open_text", "cover_letter", "fact"] }).notNull(),
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
    ats: text("ats", { enum: APPLY_SUPPORTED_ATS }),
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
    ats: text("ats", { enum: PLAN_CACHE_ATS }).notNull(),
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

export const billingReconciliations = sqliteTable(
  "billing_reconciliations",
  {
    day: text("day").primaryKey(),
    status: text("status", { enum: ["clean", "mismatch"] }).notNull(),
    checkedAt: integer("checked_at").notNull(),
    windowStart: integer("window_start").notNull(),
    windowEnd: integer("window_end").notNull(),
    stripeInvoices: integer("stripe_invoices").notNull(),
    stripeRefunds: integer("stripe_refunds").notNull(),
    ledgerGrants: integer("ledger_grants").notNull(),
    ledgerRefunds: integer("ledger_refunds").notNull(),
    mismatches: integer("mismatches").notNull(),
    detail: text("detail").notNull().default("{}"),
  },
  (t) => [index("billing_reconciliations_checked").on(t.checkedAt)],
);

/**
 * One read-only calendar feed per user (ADR 0034, M4). Only a SHA-256 hash of the URL token is stored: the token is
 * shown once, when it is issued, and rotating replaces the hash so the old URL stops working at once.
 */
export const calendarFeedTokens = sqliteTable(
  "calendar_feed_tokens",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at").notNull(),
    rotatedAt: integer("rotated_at").notNull(),
  },
  (t) => [
    uniqueIndex("calendar_feed_tokens_user_unique").on(t.userId),
    uniqueIndex("calendar_feed_tokens_hash_unique").on(t.tokenHash),
  ],
);

/**
 * One interview, follow-up or reminder a person adds to their own Calendar (H6). It is scoped to the user, so it
 * never leaks to another account on the same browser, and it reaches every device, the `.ics` feed and the export.
 * `day_key` is a local `YYYY-MM-DD` the grid draws; `time` is a local `HH:MM`, or null for an all-day entry.
 */
export const calendarCustomEvents = sqliteTable(
  "calendar_custom_events",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    dayKey: text("day_key").notNull(),
    kind: text("kind", { enum: CALENDAR_CUSTOM_EVENT_KINDS }).notNull(),
    title: text("title").notNull(),
    company: text("company").notNull().default(""),
    time: text("time"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (t) => [index("calendar_custom_events_user_day").on(t.userId, t.dayKey)],
);

/**
 * One person who asked for an invite while public sign-up is closed (WS-22). The email is stored as typed but
 * normalized to `trim().toLowerCase()`, and it is unique, so a repeat submission updates the row instead of adding
 * another. `status` moves `pending` → `invited` (an admin sent an invite) → `joined` (the invited email signed up).
 */
export const waitlistEntries = sqliteTable(
  "waitlist_entries",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    targetRole: text("target_role"),
    targetLocation: text("target_location"),
    status: text("status", { enum: ["pending", "invited", "joined"] })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    invitedAt: integer("invited_at"),
  },
  (t) => [
    index("waitlist_entries_status_created").on(t.status, t.createdAt),
    index("waitlist_entries_created").on(t.createdAt),
  ],
);

/**
 * One support request, kept for the Admin Portal Support Queue (ADM-2, M5). The message is sealed with the person's
 * key like every other body they write; the subject, category and status are read by admins. `reference_id` is the
 * short id the person sees and quotes.
 */
export const supportTickets = sqliteTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    userId: cascadeUserId(),
    referenceId: text("reference_id").notNull().unique(),
    category: text("category", { enum: SUPPORT_CATEGORIES }).notNull().default("other"),
    subject: text("subject").notNull(),
    messageEnc: text("message_enc").notNull(),
    status: text("status", { enum: SUPPORT_TICKET_STATUSES }).notNull().default("open"),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    index("support_tickets_user_created").on(t.userId, t.createdAt),
    index("support_tickets_status_created").on(t.status, t.createdAt),
  ],
);
