import { validJson, validQuery } from "./validators.ts";
import { Buffer } from "node:buffer";
import { and, asc, eq, isNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { JobHandlers } from "../platform/jobs/run-due.ts";
import type { AdjustableClock } from "../platform/ports/clock.ts";
import type { ObjectStore } from "../platform/ports/object-store.ts";
import type { PreparationService } from "../pipeline/prepare.ts";
import type { CatalogSweepWorker } from "../catalog/sweep-worker-runner.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";

import {
  accountExports,
  accounts,
  applications,
  applicationAnswers,
  applicationEvents,
  applicationSnapshots,
  attempts,
  bgJobs,
  checkins,
  codeWaits,
  companies,
  companyBoards,
  facts,
  fxRates,
  grants,
  ledger,
  liveCheckMail,
  llmBatches,
  mailUsage,
  matches,
  postingQuestions,
  mailboxes,
  mailThreads,
  messageAttachments,
  messages,
  consentVersions,
  customers,
  notifications,
  planCache,
  postingTags,
  postings,
  profiles,
  pushSubscriptions,
  questionVariants,
  questions,
  reviewApplications,
  reviews,
  resumes,
  sessions,
  stripeEvents,
  subscriptions,
  tagImports,
  users,
} from "../platform/db/schema.ts";
import { enqueueJob } from "../platform/jobs/queue.ts";
import { retryWhenBusy } from "../platform/db/busy.ts";
import { stageForStatus } from "../pipeline/stage.ts";
import { postingDisplayFor } from "../matching/applications.ts";
import { attachApplication, ensureOpenReview } from "../pipeline/review-store.ts";
import { ensureApplyFailuresQueued } from "../notify/failure-digest.ts";
import { createNotification } from "../notify/notifications.ts";
import { NOTIFICATION_KINDS } from "../../shared/notifications.ts";
import { runDueJobs } from "../platform/jobs/run-due.ts";
import { setSetting, setKillSwitch } from "../platform/settings/index.ts";
import { createConsentService } from "../profile/consent.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { clearSinkMail, failNextSinkMail, listSinkMail } from "../platform/mail/sink.ts";
import {
  clearCloudflareEmailRequests,
  listCloudflareEmailRequests,
} from "../testing/cloudflare-email-recorder.ts";
import { getTestSpans, resetTestSpans } from "../platform/telemetry/otel.ts";
import { releaseBlockingJobs } from "../testing/blocking-job.ts";
import { clearPushRequests, listPushRequests } from "../testing/push-recorder.ts";
import {
  setTurnstileScenario,
  turnstileRemoteIp,
  turnstileScenarioBody,
} from "../testing/turnstile-scenario.ts";
import {
  setTurnstileBrowserScenario,
  turnstileBrowserScenario,
  turnstileBrowserScenarioBody,
} from "../testing/turnstile-browser-scenario.ts";
import { turnstileBrowserStub } from "../testing/turnstile-browser-stub.ts";
import {
  labHcaptchaStub,
  labRecaptchaStub,
  labTurnstileStub,
} from "../testing/lab-vendor-stubs.ts";
import {
  emailSendingScenarios,
  setEmailSendingScenario,
} from "../testing/email-sending-scenario.ts";
import { readCompaniesParquet } from "../catalog/companies-parquet.ts";
import { contentHash } from "../catalog/content-hash.ts";
import { loadDiscoveredBoards } from "../catalog/discovered-boards.ts";
import { sweepBatchPerAts } from "../catalog/sweep-config.ts";
import { dedupeKeyFor } from "../catalog/dedupe-key.ts";
import { resetFeedContentHashes } from "../catalog/feed-retag.ts";
import { normalizeApplyUrl, normalizeTitle } from "../catalog/normalize.ts";
import { DEFAULT_IMPORT_SOURCE, importTags } from "../catalog/tag-import.ts";
import { readLlmUsage, recordLlmUsage } from "../platform/llm/usage.ts";
import { monthKey, readMailSummary, readMailUsage } from "../platform/mail/budget.ts";
import { ANSWER_KINDS, QUESTION_FIELD_TYPES, REVIEW_REASONS } from "../../shared/questions.ts";
import { normalizeFieldType, questionVariantHash } from "../catalog/question-normalize.ts";
import { mapQuestionByRules } from "../catalog/question-rules.ts";
import { createPersonalCrypto } from "../profile/personal-crypto.ts";
import { parseMasterKey } from "../platform/crypto.ts";
import { CODE_WAIT_TIMEOUT_MS, createCodeWait, wakeCodeWaits } from "../inbox/waits.ts";
import { ensurePrepQueuedForRunningUsers } from "../pipeline/daily-prep.ts";
import { newExportKey } from "../../shared/export-crypto.ts";
import { createMailboxService } from "../inbox/mailboxes.ts";
import { listExportsOf } from "../export/service.ts";
import { readLiveCheckResults } from "../live-checks/store.ts";
import { runAlertDrill } from "../live-checks/alerts.ts";
import { env } from "../config/env.ts";
import {
  applicationsLeft,
  commitForApplication,
  grantApplications,
  releaseForApplication,
  reserveForApplication,
} from "../billing/ledger.ts";

const offsetBody = z.object({ offsetMs: z.number().int() });

const enqueueBody = z.object({
  kind: z.string().min(1),
  payload: z.string(),
  runAt: z.number().int().nullable().optional(),
  priority: z.number().int().optional(),
  maxAttempts: z.number().int().optional(),
  dedupeKey: z.string().optional(),
});

const settingBody = z.object({ value: z.string().min(1) });

const runNowBody = z.object({ kind: z.string().min(1), payload: z.string() });

const killSwitchBody = z.object({
  enabled: z.boolean(),
  reason: z.string().default(""),
  setBy: z.enum(["auto", "owner"]).default("owner"),
});

const publishBody = z.object({
  topic: z.string().min(1),
  payload: z.record(z.string(), z.string().or(z.number()).or(z.boolean()).or(z.null())),
  userId: z.string().optional(),
});

const consentPublishBody = z.object({
  publishedAt: z.number().int().positive().optional(),
  text: z.string().trim().min(1).max(10_000),
});

const consentTamperBody = z.object({ action: z.enum(["update", "delete"]) });

const createCompanyBody = z.object({
  name: z.string().min(1),
  domain: z.string().min(1).nullish(),
});

const createBoardBody = z.object({
  companyId: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby", "workable", "personio"]),
  boardToken: z.string().min(1),
  region: z.enum(["us", "eu"]).default("us"),
  status: z.enum(["active", "empty", "gone", "disabled"]).default("active"),
  source: z.enum(["v1_seed", "discovered", "import"]).default("discovered"),
});

const discoveredScraperRowSchema = z.object({
  ats: z.string().min(1),
  name: z.string().min(1),
  slug: z.string(),
  url: z.string(),
});

const discoveredBoardsBody = z.union([
  z.object({ path: z.string().min(1) }),
  z.object({ rows: z.array(discoveredScraperRowSchema).min(1) }),
]);

const tagImportBody = z.object({
  content: z.string().min(1),
  source: z.string().min(1).default(DEFAULT_IMPORT_SOURCE),
});

const llmUsageQuery = z.object({
  purpose: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

const userNameBody = z.object({ email: z.email(), name: z.string().min(1) });

const lowercased = (value: string) => value.trim().toLowerCase();
const roleBody = z.object({ userId: z.string().min(1), role: z.enum(["user", "owner"]) });

const postingTagBody = z.object({
  dimension: z.enum(["role", "subrole", "seniority"]),
  value: z.string().min(1),
});

const seedPostingQuestionBody = z.object({
  text: z.string().min(1).max(2000),
  fieldType: z.enum(QUESTION_FIELD_TYPES).nullish(),
  fieldName: z.string().min(1).max(200).nullish(),
  atsFieldType: z.string().min(1).nullish(),
  options: z.array(z.string().min(1)).max(200).default([]),
  required: z.boolean().default(false),
  factKey: z.string().min(1).nullish(),
  answerKind: z.enum(ANSWER_KINDS).nullish(),
  mappedBy: z.enum(["rules", "llm", "owner"]).nullish(),
});

const sampleLedgerBody = z.object({ email: z.email() });

const homeSampleBody = z.object({
  email: z.email(),
  variant: z.enum(["running", "paused"]).default("running"),
});

const profileRunningBody = z.object({
  running: z.boolean(),
  userId: z.string().min(1),
});

const homePauseBody = z.object({
  email: z.email(),
  pauseReason: z.enum([
    "user",
    "onboarding",
    "no_resume",
    "plan_ended",
    "payment_failed",
    "suspended",
    "no_mailbox",
  ]),
});

const seedAttachmentBody = z.object({
  filename: z.string().min(1),
  mime: z.string().min(1),
  base64: z.string().optional(),
  text: z.string().optional(),
});

const seedMailBody = z.object({
  userId: z.string().min(1),
  applicationId: z.string().min(1).nullish(),
  from: z.string().min(1),
  senderDomain: z.string().min(1),
  subject: z.string().min(1),
  text: z.string().min(1),
  auth: z.enum(["pass", "fail", "none"]).default("pass"),
  direction: z.enum(["in", "out"]).default("in"),
  outStatus: z.enum(["queued", "sent", "bounced", "failed"]).nullish(),
  classification: z
    .enum(["ack", "code", "rejection", "screening", "interview", "offer", "other"])
    .default("other"),
  localPart: z.string().min(1).max(64).optional(),
  readAt: z.number().int().nullish(),
  attachments: z.array(seedAttachmentBody).default([]),
  at: z.number().int().nullish(),
});

const seedSnapshotBody = z.object({
  applicationId: z.string().min(1),
  answers: z.array(
    z.object({
      label: z.string(),
      answer: z.string().nullable(),
      by_user: z.boolean().optional(),
      fact_key: z.string().nullable().optional(),
      fact_revision: z.number().nullable().optional(),
      kind: z.string().optional(),
      question_id: z.string().nullable().optional(),
      resume_line_ids: z.array(z.string()).optional(),
    }),
  ),
  coverLetter: z
    .array(z.object({ sentence: z.string(), by_user: z.boolean().optional() }))
    .nullable()
    .default(null),
});

const bulkMailBody = z.object({
  userId: z.string().min(1),
  count: z.number().int().min(1).max(2000),
  bodyBytes: z
    .number()
    .int()
    .min(1)
    .max(2 * 1024 * 1024),
  at: z.number().int().nullish(),
  senderDomain: z.string().min(1).default("us.greenhouse-mail.io"),
});

const exportsQuery = z.object({ userId: z.string().min(1) });

const objectsQuery = z.object({ prefix: z.string().min(1) });

const tamperLedgerBody = z.object({ action: z.enum(["delete", "delete-owner", "update"]) });

const tamperSnapshotBody = z.object({
  applicationId: z.string().min(1),
  action: z.enum(["delete", "delete-owner", "update"]),
});

const attemptsQuery = z.object({ applicationId: z.string().min(1) });

const seedAttemptBody = z.object({
  applicationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  provider: z.enum(["browser_use", "kernel", "local"]).default("local"),
  providerSessionId: z.string().min(1).nullish(),
  n: z.number().int().min(1).optional(),
  outcome: z
    .enum([
      "sent",
      "unconfirmed",
      "captcha_blocked",
      "code_timeout",
      "posting_closed",
      "form_changed",
      "blocked",
      "upload_failed",
      "duplicate",
      "needs_review",
      "provider_error",
      "timeout",
      "crash",
      "interrupted",
      "identity_mismatch",
    ])
    .default("sent"),
  at: z.number().int().nullish(),
  startedAt: z.number().int().optional(),
  browserMs: z.number().int().nonnegative().default(0),
  proxyBytes: z.number().int().nonnegative().default(0),
  costMicros: z.number().int().nonnegative().default(0),
  captchaSeen: z.boolean().default(false),
  codeUsed: z.boolean().default(false),
});

const seedAttemptsBody = z.object({ attempts: z.array(seedAttemptBody).min(1).max(200) });

const seedAnswerBody = z.object({
  applicationId: z.string().min(1),
  questionId: z.string().min(1),
  kind: z.enum(["open_text", "cover_letter"]),
  sentences: z
    .array(z.object({ sentence: z.string().min(1), resumeLineIds: z.array(z.string()) }))
    .min(1),
});

const SAMPLE_GRANT_QUANTITY = 70;

function defaultStageFor(status: "approved" | "failed" | "needs_review" | "ready" | "sent") {
  return status === "sent" ? "applied" : stageForStatus(status);
}

const createPostingBody = z.object({
  boardId: z.string().min(1),
  companyId: z.string().min(1),
  ats: z.enum(["greenhouse", "lever", "ashby", "workable", "personio"]),
  atsJobId: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  sourceUpdatedAt: z.number().int().nullish(),
  descriptionText: z.string().nullish(),
  workplace: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown"),
  employmentType: z
    .enum(["full_time", "part_time", "contract", "internship", "temporary", "unknown"])
    .default("unknown"),
  language: z.string().min(2).max(5).nullish(),
  locationRaw: z.string().nullish(),
  countryCode: z.string().length(2).nullish(),
  region: z.string().nullish(),
  city: z.string().nullish(),
  salaryMinMinor: z.number().int().nonnegative().nullish(),
  salaryMaxMinor: z.number().int().nonnegative().nullish(),
  salaryCurrency: z.string().length(3).nullish(),
  salaryPeriod: z.enum(["year", "month", "hour"]).nullish(),
  postedAt: z.number().int().nullish(),
  tags: z.array(postingTagBody).max(20).default([]),
  questions: z.array(seedPostingQuestionBody).max(40).default([]),
});

const bulkPostingsBody = z.object({
  postings: z.array(createPostingBody).min(1).max(2000),
});

const recordLlmUsageBody = z.object({
  email: z.email().optional(),
  purpose: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0),
  cachedTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  costMicros: z.number().int().min(0),
});

const seedApplicationBody = z.object({
  userId: z.string().min(1),
  postingId: z.string().min(1),
  status: z.enum([
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
  ]),
  sentAt: z.number().int().nullable().default(null),
  createdAt: z.number().int().nullable().default(null),
  readyAt: z.number().int().nullable().default(null),
  origin: z.enum(["auto", "manual"]).default("auto"),
  stage: z
    .enum(["queued", "ready", "applied", "screening", "interviewing", "offer", "closed"])
    .nullable()
    .optional(),
  stageLocked: z.boolean().default(false),
  boardPosition: z.number().nullable().default(null),
  closedReason: z
    .enum(["rejected", "no_response", "withdrawn", "offer_declined", "offer_accepted", "other"])
    .nullable()
    .default(null),
  scheduledFor: z.number().int().nullable().default(null),
});

const seedMatchBody = z.object({
  userId: z.string().min(1),
  postingId: z.string().min(1),
  score: z.number().int().min(0).max(100).nullable().default(null),
  reason: z.string().max(140).nullable().default(null),
  codeRank: z.number().default(0),
});

const seedEventBody = z.object({
  applicationId: z.string().min(1),
  events: z
    .array(
      z.object({
        at: z.number().int(),
        kind: z.enum(["status", "stage", "email", "checkin", "note"]),
        fromValue: z.string().nullable().default(null),
        toValue: z.string().nullable().default(null),
        source: z.enum(["system", "user", "email", "checkin", "admin"]),
        detail: z.string().nullable().default(null),
      }),
    )
    .min(1)
    .max(60),
});

const seedGrantBody = z.object({
  email: z.email(),
  quantity: z.number().int().min(1).max(10_000),
  idempotencyKey: z.string().min(1),
  source: z.enum(["admin", "period", "trial"]).default("admin"),
  expiresAt: z.number().int().positive().nullable().optional(),
});

const ledgerApplicationBody = z.object({
  email: z.email(),
  applicationId: z.string().min(1),
  commit: z.boolean().default(false),
});

const ledgerReleaseBody = z.object({
  email: z.email(),
  applicationId: z.string().min(1),
});

const seedFactsBody = z.object({
  userId: z.string().min(1),
  facts: z
    .array(
      z.object({
        confirmed: z.boolean().default(true),
        key: z.string().min(1),
        scope: z.string().max(3).default(""),
        source: z.enum(["resume", "user", "review", "import"]).default("user"),
        value: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(64),
});

const applicationStatusBody = z.object({
  applicationId: z.string().min(1),
  status: z.enum([
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
  ]),
  statusReason: z.string().nullable().default(null),
  scheduledFor: z.number().nullable().optional(),
});

const userSuspendBody = z.object({
  userId: z.string().min(1),
  suspended: z.boolean(),
});

const fxRateBody = z.object({
  date: z.string().min(10).max(10),
  currency: z.string().length(3),
  perUsd: z.number().positive(),
});

const mailUsageBody = z.object({
  auth: z.number().int().min(0),
  system: z.number().int().min(0),
  notice: z.number().int().min(0),
  warnedAt: z.number().int().nullable().optional(),
  reserveRefusedAt: z.number().int().nullable().optional(),
  refusedAt: z.number().int().nullable().optional(),
});

const seedReviewBody = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(1).max(2000),
  fieldType: z.enum(QUESTION_FIELD_TYPES),
  options: z.array(z.string().min(1)).max(200).default([]),
  factKey: z.string().min(1).nullish(),
  scope: z
    .string()
    .regex(/^(?:|[A-Z]{2})$/u)
    .default(""),
  answerKind: z.enum(["fact", "open_text", "consent", "skip", "unknown"]).default("unknown"),
  reason: z.enum(REVIEW_REASONS).default("unknown_required"),
  applicationIds: z.array(z.string().min(1)).min(1).max(50),
});

const userQuery = z.object({ userId: z.string().min(1) });

const closePostingBody = z.object({ id: z.string().min(1) });

const questionsQuery = z.object({
  userId: z.string().min(1),
  postingId: z.string().min(1).optional(),
});

const applicationQuery = z.object({ applicationId: z.string().min(1) });

const planCachePlanSchema = z
  .object({ readPath: z.string().nullish(), questions: z.array(z.unknown()).nullish() })
  .loose();

function planCacheDetail(plan: string) {
  try {
    const parsed = planCachePlanSchema.safeParse(JSON.parse(plan));

    return parsed.success
      ? { questions: parsed.data.questions?.length ?? 0, readPath: parsed.data.readPath ?? null }
      : { questions: 0, readPath: null };
  } catch {
    return { questions: 0, readPath: null };
  }
}

const createUserBody = z.object({ email: z.email(), name: z.string().min(1) });

type PostingWriter = AppDatabase | Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

function seedPosting(writer: PostingWriter, row: z.infer<typeof createPostingBody>, now: number) {
  const id = crypto.randomUUID();
  const titleNorm = normalizeTitle(row.title);
  const descriptionText = row.descriptionText ?? null;

  writer
    .insert(postings)
    .values({
      id,
      boardId: row.boardId,
      companyId: row.companyId,
      ats: row.ats,
      atsJobId: row.atsJobId,
      url: row.url,
      applyUrl: null,
      applyUrlNorm: normalizeApplyUrl(row.url),
      title: row.title,
      titleNorm,
      locationRaw: row.locationRaw ?? null,
      countryCode: row.countryCode ?? null,
      region: row.region ?? null,
      city: row.city ?? null,
      language: row.language ?? null,
      workplace: row.workplace,
      employmentType: row.employmentType,
      salaryMinMinor: row.salaryMinMinor ?? null,
      salaryMaxMinor: row.salaryMaxMinor ?? null,
      salaryCurrency: row.salaryCurrency ?? null,
      salaryPeriod: row.salaryPeriod ?? null,
      postedAt: row.postedAt ?? null,
      dedupeKey: dedupeKeyFor({
        companyId: row.companyId,
        titleNorm,
        countryCode: row.countryCode ?? null,
        city: row.city ?? null,
      }),
      firstSeenAt: now,
      lastSeenAt: now,
      sourceUpdatedAt: row.sourceUpdatedAt ?? null,
      descriptionGz: descriptionText === null ? null : Buffer.from(Bun.gzipSync(descriptionText)),
      descriptionHash: descriptionText === null ? null : contentHash(descriptionText),
      tagSource: null,
      closedAt: null,
      questionsFetchedAt: row.questions.length > 0 ? now : null,
    })
    .run();

  for (const tag of row.tags) {
    writer
      .insert(postingTags)
      .values({ postingId: id, dimension: tag.dimension, value: tag.value, source: "import" })
      .onConflictDoNothing()
      .run();
  }

  for (const [position, question] of row.questions.entries()) {
    const textNormHash = questionVariantHash(question.text);

    const existing = writer
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.textNormHash, textNormHash))
      .get();

    const questionId = existing?.id ?? crypto.randomUUID();

    if (existing === undefined) {
      const mapped =
        question.answerKind === null || question.answerKind === undefined
          ? mapQuestionByRules(question.text)
          : null;

      const answerKind = question.answerKind ?? mapped?.answerKind ?? "unknown";

      const mappedBy =
        question.mappedBy ?? (mapped === null || mapped.answerKind === "unknown" ? null : "rules");

      const fieldType =
        question.fieldType ??
        normalizeFieldType(question.atsFieldType ?? "", question.fieldName ?? "");

      writer
        .insert(questions)
        .values({
          id: questionId,
          textDisplay: question.text,
          textNormHash,
          fieldType,
          optionsHash: null,
          factKey: question.factKey ?? mapped?.factKey ?? null,
          answerKind,
          mappedBy,
          seenCount: 1,
          createdAt: now,
        })
        .run();

      writer
        .insert(questionVariants)
        .values({ variantHash: textNormHash, questionId })
        .onConflictDoNothing()
        .run();
    }

    writer
      .insert(postingQuestions)
      .values({
        postingId: id,
        questionId,
        required: question.required,
        position,
        options: JSON.stringify(question.options),
        fieldName: question.fieldName ?? null,
      })
      .onConflictDoNothing()
      .run();
  }

  return id;
}

export function createTestRoutes(
  db: AppDatabase,
  clock: AdjustableClock,
  handlers: JobHandlers,
  singletonJobKinds: readonly string[],
  preparation: PreparationService | null = null,
  catalogWorker: CatalogSweepWorker | null = null,
  objects: ObjectStore | null = null,
) {
  const routes = new Hono();

  const personal = createPersonalCrypto(
    db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const testMailboxes =
    env.INBOUND_HMAC_SECRET === undefined
      ? null
      : createMailboxService(db, clock, env.INBOUND_HMAC_SECRET, env.MAIL_DOMAIN);

  function insertCodeWaitAt(
    mailbox: { id: string; userId: string },
    attemptId: string | null,
    startedAt: number,
    expiresAt: number,
  ) {
    const id = crypto.randomUUID();

    db.insert(codeWaits)
      .values({
        attemptId,
        expiresAt: new Date(expiresAt),
        id,
        mailboxId: mailbox.id,
        startedAt: new Date(startedAt),
        userId: mailbox.userId,
      })
      .run();

    return db.select().from(codeWaits).where(eq(codeWaits.id, id)).get();
  }

  async function seedSampleLedger(userId: string, prefix: string) {
    await retryWhenBusy(
      () =>
        grantApplications(db, clock, {
          idempotencyKey: `${prefix}-grant:${userId}`,
          quantity: SAMPLE_GRANT_QUANTITY,
          source: "admin",
          userId,
        }),
      `test.${prefix}.grant`,
    );

    await Promise.all(
      Array.from({ length: 7 }, async (_unused, offset) => {
        const applicationId = `${prefix}-${String(offset + 1)}`;

        await retryWhenBusy(
          () =>
            reserveForApplication(db, clock, {
              applicationId,
              idempotencyKey: `${prefix}-reserve:${userId}:${applicationId}`,
              userId,
            }),
          `test.${prefix}.reserve`,
        );

        await retryWhenBusy(
          () =>
            commitForApplication(db, clock, {
              applicationId,
              idempotencyKey: `${prefix}-commit:${userId}:${applicationId}`,
              userId,
            }),
          `test.${prefix}.commit`,
        );
      }),
    );
  }

  function questionForReview(body: z.infer<typeof seedReviewBody>) {
    const now = clock.now();
    const textNormHash = questionVariantHash(body.prompt);

    const existing = db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.textNormHash, textNormHash))
      .get();

    const questionId = existing?.id ?? crypto.randomUUID();

    if (existing === undefined) {
      db.insert(questions)
        .values({
          id: questionId,
          textDisplay: body.prompt,
          textNormHash,
          fieldType: body.fieldType,
          optionsHash: null,
          factKey: body.factKey ?? null,
          answerKind: body.answerKind,
          mappedBy: null,
          seenCount: 1,
          createdAt: now,
        })
        .run();

      db.insert(questionVariants)
        .values({ variantHash: textNormHash, questionId })
        .onConflictDoNothing()
        .run();
    }

    return questionId;
  }

  function seedReviewRow(body: z.infer<typeof seedReviewBody>) {
    const now = clock.now();
    const questionId = questionForReview(body);
    const reviewId = crypto.randomUUID();

    db.insert(reviews)
      .values({
        id: reviewId,
        userId: body.userId,
        questionId,
        factKey: body.factKey ?? null,
        scope: body.scope,
        prompt: body.prompt,
        fieldType: body.fieldType,
        options: JSON.stringify(body.options),
        reason: body.reason,
        status: "open",
        createdAt: now,
        resolvedAt: null,
      })
      .run();

    for (const applicationId of body.applicationIds) {
      db.insert(reviewApplications).values({ reviewId, applicationId }).onConflictDoNothing().run();
    }

    return { questionId, reviewId };
  }

  function openReviewThroughStore(body: z.infer<typeof seedReviewBody>) {
    const questionId = questionForReview(body);

    const reviewId = ensureOpenReview(db, clock, {
      ats: null,
      factKey: body.factKey ?? null,
      fieldType: body.fieldType,
      options: body.options,
      prompt: body.prompt,
      questionId,
      reason: body.reason,
      scope: body.scope,
      userId: body.userId,
    });

    for (const applicationId of body.applicationIds) {
      attachApplication(db, reviewId, applicationId);
    }

    return { questionId, reviewId };
  }

  async function insertMailRow(body: z.infer<typeof seedMailBody>) {
    const at = body.at ?? clock.now();
    const localPart = body.localPart ?? `owner-${body.userId.slice(0, 8)}`;

    const existingMailbox = db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.userId, body.userId))
      .get();

    const mailboxId = existingMailbox?.id ?? crypto.randomUUID();

    if (existingMailbox === undefined) {
      db.insert(mailboxes)
        .values({
          createdAt: new Date(at),
          id: mailboxId,
          localPart,
          status: "active",
          userId: body.userId,
        })
        .run();
    } else if (body.localPart !== undefined) {
      db.update(mailboxes).set({ localPart }).where(eq(mailboxes.id, mailboxId)).run();
    }

    const threadId = crypto.randomUUID();
    const messageId = crypto.randomUUID();

    const subjectEnc = await personal.sealFor(
      body.userId,
      { column: "subject_enc", rowId: threadId, table: "mail_threads" },
      body.subject,
    );

    const scope = (column: string) => ({ column, rowId: messageId, table: "messages" });
    const snippet = body.text.replaceAll(/\s+/gu, " ").trim().slice(0, 200);

    db.insert(mailThreads)
      .values({
        applicationId: body.applicationId ?? null,
        employerStarted: true,
        id: threadId,
        lastMessageAt: new Date(at),
        subjectEnc,
        userId: body.userId,
      })
      .run();

    const attachmentRows = await Promise.all(
      body.attachments.map(async (attachment) => {
        const attachmentId = crypto.randomUUID();
        const objectKey = `mail/${body.userId}/attachments/${attachmentId}`;

        const bytes =
          attachment.base64 === undefined
            ? Buffer.from(attachment.text ?? "", "utf8")
            : Buffer.from(attachment.base64, "base64");

        const sealed = await personal.sealFor(
          body.userId,
          { column: "body", rowId: objectKey, table: "mail_objects" },
          bytes.toString("base64"),
        );

        await objects?.put(objectKey, new TextEncoder().encode(sealed));

        return {
          bytes: bytes.byteLength,
          filenameEnc: await personal.sealFor(
            body.userId,
            { column: "filename_enc", rowId: attachmentId, table: "message_attachments" },
            attachment.filename,
          ),
          id: attachmentId,
          messageId,
          mime: attachment.mime,
          objectKey,
        };
      }),
    );

    db.insert(messages)
      .values({
        auth: body.auth,
        classification: body.direction === "in" ? body.classification : null,
        createdAt: new Date(at),
        direction: body.direction,
        fromEnc: await personal.sealFor(body.userId, scope("from_enc"), body.from),
        id: messageId,
        mailboxId,
        outStatus: body.outStatus ?? null,
        readAt: body.readAt === null || body.readAt === undefined ? null : new Date(body.readAt),
        rfcMessageId: `<${messageId}@${body.senderDomain}>`,
        senderDomain: body.senderDomain,
        snippetEnc: await personal.sealFor(body.userId, scope("snippet_enc"), snippet),
        subjectEnc: await personal.sealFor(body.userId, scope("subject_enc"), body.subject),
        textEnc: await personal.sealFor(body.userId, scope("text_enc"), body.text),
        threadId,
        toEnc: await personal.sealFor(
          body.userId,
          scope("to_enc"),
          `in-${localPart}@tryoverture.com`,
        ),
        userId: body.userId,
      })
      .run();

    if (attachmentRows.length > 0) {
      db.insert(messageAttachments).values(attachmentRows).run();
    }

    return { messageId, threadId };
  }

  routes.get("/clock", (context) => context.json({ now: clock.now(), offsetMs: clock.offset() }));

  routes.post("/consent/publish", validJson(consentPublishBody), (context) => {
    const { publishedAt, text } = context.req.valid("json");

    const published = createConsentService({ clock, db }).publish(
      text,
      publishedAt === undefined ? undefined : new Date(publishedAt),
    );

    return context.json({
      publishedAt: published.publishedAt.toISOString(),
      text: published.text,
      version: published.version,
    });
  });

  routes.post("/consent/tamper", validJson(consentTamperBody), (context) => {
    const { action } = context.req.valid("json");

    try {
      if (action === "update") {
        db.update(consentVersions).set({ text: "tampered" }).run();
      } else {
        db.delete(consentVersions).run();
      }

      return context.json({ refused: false, refusal: null });
    } catch (error) {
      return context.json({
        refused: true,
        refusal: error instanceof Error ? error.message : "refused",
      });
    }
  });

  routes.post("/clock/offset", validJson(offsetBody), (context) => {
    const { offsetMs } = context.req.valid("json");

    clock.setOffset(offsetMs);
    wakeCodeWaits();

    return context.json({ now: clock.now(), offsetMs: clock.offset() });
  });

  routes.get("/notifications", validQuery(z.object({ userId: z.string().min(1) })), (context) => {
    const { userId } = context.req.valid("query");

    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(asc(notifications.createdAt))
      .all();

    return context.json({
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        url: row.url,
        createdAt: row.createdAt,
        readAt: row.readAt?.getTime() ?? null,
        pushedAt: row.pushedAt?.getTime() ?? null,
        emailedAt: row.emailedAt?.getTime() ?? null,
      })),
    });
  });

  const seedNotificationsBody = z.object({
    email: z.string().min(1),
    rows: z
      .array(
        z.object({
          at: z.number().int(),
          body: z.string(),
          kind: z.string(),
          pushed: z.boolean().default(false),
          read: z.boolean().default(false),
          title: z.string(),
          url: z.string(),
        }),
      )
      .min(1),
  });

  routes.post("/notifications/seed", validJson(seedNotificationsBody), (context) => {
    const body = context.req.valid("json");

    const user = db.select().from(users).where(eq(users.email, body.email.toLowerCase())).get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    for (const row of body.rows) {
      db.insert(notifications)
        .values({
          body: row.body,
          createdAt: row.at,
          id: crypto.randomUUID(),
          kind: row.kind,
          pushedAt: row.pushed ? new Date(row.at) : null,
          readAt: row.read ? new Date(row.at) : null,
          title: row.title,
          url: row.url,
          userId: user.id,
        })
        .run();
    }

    return context.json({ ok: true });
  });

  const emitNotificationBody = z.object({
    email: z.string().min(1),
    kind: z.enum(NOTIFICATION_KINDS),
    title: z.string(),
    body: z.string(),
    url: z.string(),
  });

  routes.post("/notifications/emit", validJson(emitNotificationBody), (context) => {
    const body = context.req.valid("json");

    const user = db.select().from(users).where(eq(users.email, body.email.toLowerCase())).get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const id = createNotification(db, clock, {
      body: body.body,
      kind: body.kind,
      title: body.title,
      url: body.url,
      userId: user.id,
    });

    return context.json({ id });
  });

  routes.get("/push/subscriptions", validQuery(userQuery), (context) => {
    const { userId } = context.req.valid("query");

    const rows = db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.createdAt))
      .all();

    return context.json({
      subscriptions: rows.map((row) => ({
        createdAt: row.createdAt,
        endpoint: row.endpoint,
        id: row.id,
        lastOkAt: row.lastOkAt?.getTime() ?? null,
        userId: row.userId,
      })),
    });
  });

  routes.get("/push/requests", (context) => context.json({ requests: listPushRequests() }));

  routes.post("/push/clear", (context) => {
    clearPushRequests();

    return context.json({ ok: true });
  });

  routes.post(
    "/push/subscriptions",
    validJson(
      z.object({
        endpoint: z.string().min(1),
        keys: z.object({ auth: z.string().min(1), p256dh: z.string().min(1) }),
        userId: z.string().min(1),
      }),
    ),
    (context) => {
      const { endpoint, keys, userId } = context.req.valid("json");

      db.insert(pushSubscriptions)
        .values({
          auth: keys.auth,
          createdAt: clock.now(),
          endpoint,
          id: crypto.randomUUID(),
          lastOkAt: null,
          p256dh: keys.p256dh,
          userId,
        })
        .onConflictDoNothing()
        .run();

      return context.json({ ok: true });
    },
  );

  routes.get("/live-checks", (context) => context.json({ results: readLiveCheckResults(db, 200) }));

  routes.get("/live-checks/mail", (context) => {
    const rows = db.select().from(liveCheckMail).all();

    return context.json({ mail: rows });
  });

  routes.post(
    "/live-checks/mail/expire",
    validJson(z.object({ id: z.string().min(1) })),
    (context) => {
      const { id } = context.req.valid("json");

      db.update(liveCheckMail)
        .set({ sentAt: clock.now() - 60 * 60_000 })
        .where(eq(liveCheckMail.id, id))
        .run();

      return context.json({ id, expired: true });
    },
  );

  routes.post("/live-checks/drill", (context) => {
    const report = runAlertDrill(db, clock);

    return context.json(report);
  });

  routes.post("/turnstile", validJson(turnstileScenarioBody), (context) => {
    setTurnstileScenario(context.req.valid("json"));

    return context.json({ ok: true });
  });

  routes.get("/turnstile", (context) => context.json({ remoteIp: turnstileRemoteIp() }));

  routes.get("/turnstile/browser", (context) => context.json(turnstileBrowserScenario()));

  routes.post("/turnstile/browser", validJson(turnstileBrowserScenarioBody), (context) => {
    setTurnstileBrowserScenario(context.req.valid("json"));

    return context.json({ ok: true });
  });

  routes.get("/turnstile-api.js", (context) =>
    context.body(turnstileBrowserStub, 200, {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    }),
  );

  const labScripts = {
    "lab-hcaptcha.js": labHcaptchaStub,
    "lab-recaptcha.js": labRecaptchaStub,
    "lab-turnstile.js": labTurnstileStub,
  } as const;

  for (const [name, source] of Object.entries(labScripts)) {
    routes.get(`/${name}`, (context) =>
      context.body(source, 200, {
        "cache-control": "no-store",
        "content-type": "text/javascript; charset=utf-8",
      }),
    );
  }

  routes.post("/jobs/run-due", async (context) => {
    const ran = await runDueJobs(db, clock, handlers, singletonJobKinds);

    return context.json({ ran });
  });

  routes.post("/jobs/ensure-prep", (context) => {
    ensurePrepQueuedForRunningUsers(db, clock);

    return context.json({ ok: true });
  });

  routes.post("/jobs/run-now", validJson(runNowBody), async (context) => {
    const { kind, payload } = context.req.valid("json");
    const handler = handlers[kind];

    if (handler === undefined) {
      return context.json({ error: "unknown job kind" }, 404);
    }

    await handler(payload);

    return context.json({ ok: true });
  });

  routes.post("/jobs/enqueue", validJson(enqueueBody), async (context) => {
    const { kind, payload, runAt, priority, maxAttempts, dedupeKey } = context.req.valid("json");

    const opts = {
      ...(runAt !== null && runAt !== undefined && { runAt }),
      ...(priority !== undefined && { priority }),
      ...(maxAttempts !== undefined && { maxAttempts }),
      ...(dedupeKey !== undefined && { dedupeKey }),
    };

    const job = await retryWhenBusy(
      () => enqueueJob(db, clock, kind, payload, opts),
      "test.jobs.enqueue",
    );

    return context.json({ id: job.id });
  });

  routes.get("/jobs", (context) => {
    const rows = db.select().from(bgJobs).all();

    return context.json({ jobs: rows });
  });

  routes.get("/jobs/:id", (context) => {
    const { id } = context.req.param();
    const job = db.select().from(bgJobs).where(eq(bgJobs.id, id)).get();

    if (job === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json(job);
  });

  routes.post("/jobs/release", (context) => {
    releaseBlockingJobs();

    return context.json({ ok: true });
  });

  routes.put("/settings/:key", validJson(settingBody), async (context) => {
    const { key } = context.req.param();
    const { value } = context.req.valid("json");

    await retryWhenBusy(() => {
      setSetting(db, clock, key, value, "owner");
    }, "test.settings");

    return context.json({ key, value });
  });

  routes.put("/kill-switches/:scope/:key", validJson(killSwitchBody), (context) => {
    const { scope, key } = context.req.param();
    const { enabled, reason, setBy } = context.req.valid("json");

    const validScope = z.enum(["global", "ats", "employer", "provider"]).safeParse(scope);

    if (!validScope.success) {
      return context.json({ error: "invalid_scope" }, 400);
    }

    setKillSwitch(db, clock, validScope.data, key, enabled, reason, setBy);

    return context.json({ scope, key, enabled, reason, setBy });
  });

  routes.post("/events/publish", validJson(publishBody), (context) => {
    const { topic, payload, userId } = context.req.valid("json");

    publishEvent(db, clock, topic, JSON.stringify(payload), userId);

    return context.json({ ok: true });
  });

  routes.get("/telemetry/spans", (context) => {
    const spans = getTestSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
    }));

    return context.json({ spans });
  });

  routes.post("/telemetry/reset", (context) => {
    resetTestSpans();

    return context.json({ ok: true });
  });

  routes.post("/catalog/companies", validJson(createCompanyBody), (context) => {
    const { name, domain } = context.req.valid("json");
    const id = crypto.randomUUID();

    db.insert(companies)
      .values({
        id,
        name,
        nameNorm: name.toLowerCase(),
        domain: domain ?? null,
        createdAt: clock.now(),
      })
      .run();

    return context.json({ id });
  });

  routes.post("/catalog/boards", validJson(createBoardBody), (context) => {
    const { companyId, ats, boardToken, region, status, source } = context.req.valid("json");
    const id = crypto.randomUUID();

    db.insert(companyBoards)
      .values({
        id,
        companyId,
        ats,
        boardToken,
        region,
        status,
        source,
        notFoundPolls: 0,
        createdAt: clock.now(),
      })
      .onConflictDoNothing()
      .run();

    return context.json({ id });
  });

  routes.get("/catalog/boards", (context) => {
    const rows = db.select().from(companyBoards).all();

    return context.json({ boards: rows });
  });

  routes.post("/catalog/retag-open-postings", async (context) => {
    const report = await resetFeedContentHashes(db);

    return context.json(report);
  });

  routes.get("/catalog/sweep-batches", (context) =>
    context.json({ batches: sweepBatchPerAts(db) }),
  );

  routes.get("/catalog/sweep-worker", (context) =>
    context.json(catalogWorker?.status() ?? { running: false, restarts: 0 }),
  );

  routes.post("/catalog/sweep-worker/crash", (context) =>
    context.json({ crashed: catalogWorker?.crash() ?? false }),
  );

  routes.get("/catalog/postings", (context) => {
    const rows = db.select().from(postings).all();
    const postingRows: ((typeof rows)[number] & { descriptionText: string | null })[] = [];

    for (const row of rows) {
      const descriptionText =
        row.descriptionGz === null
          ? null
          : new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(row.descriptionGz)));

      postingRows.push({ ...row, descriptionText });
    }

    return context.json({ postings: postingRows });
  });

  routes.post("/catalog/postings", validJson(createPostingBody), (context) => {
    const id = seedPosting(db, context.req.valid("json"), clock.now());

    return context.json({ id });
  });

  routes.post("/catalog/postings/bulk", validJson(bulkPostingsBody), (context) => {
    const { postings: rows } = context.req.valid("json");
    const now = clock.now();

    db.transaction((tx) => {
      for (const row of rows) {
        seedPosting(tx, row, now);
      }
    });

    return context.json({ created: rows.length });
  });

  routes.post("/catalog/postings/close", validJson(closePostingBody), (context) => {
    const { id } = context.req.valid("json");

    db.update(postings).set({ closedAt: clock.now() }).where(eq(postings.id, id)).run();

    return context.json({ id, closed: true });
  });

  routes.post("/catalog/postings/close-all", (context) => {
    const closed = db
      .update(postings)
      .set({ closedAt: clock.now() })
      .where(isNull(postings.closedAt))
      .returning({ id: postings.id })
      .all();

    return context.json({ closed: closed.length });
  });

  routes.post("/catalog/prune", (context) => {
    const removed = db
      .delete(companies)
      .returning({ id: companies.id })
      .all()
      .map((row) => row.id);

    return context.json({ companies: removed.length });
  });

  routes.post("/catalog/discovered-boards", validJson(discoveredBoardsBody), async (context) => {
    const body = context.req.valid("json");

    if ("rows" in body) {
      return context.json(await loadDiscoveredBoards(db, clock, body.rows));
    }

    const bytes = readFileSync(body.path);
    const file = new ArrayBuffer(bytes.byteLength);

    new Uint8Array(file).set(bytes);

    const { rows } = await readCompaniesParquet(file);
    const report = await loadDiscoveredBoards(db, clock, rows);

    return context.json(report);
  });

  routes.get("/catalog/posting-tags", (context) => {
    const rows = db.select().from(postingTags).all();

    return context.json({ postingTags: rows });
  });

  routes.post("/tag-imports", validJson(tagImportBody), (context) => {
    const { content, source } = context.req.valid("json");

    const report = importTags(db, clock, { content, source, uploadedBy: "owner" });

    return context.json(report);
  });

  routes.get("/tag-imports", (context) => {
    const rows = db.select().from(tagImports).all();

    return context.json({ tagImports: rows });
  });

  routes.get("/llm/usage", validQuery(llmUsageQuery), (context) => {
    const { purpose, limit } = context.req.valid("query");

    const summary = readLlmUsage(db, {
      purpose: purpose ?? null,
      sinceMs: null,
      limit,
    });

    return context.json(summary);
  });

  routes.get("/llm/batches", (context) => {
    const rows = db.select().from(llmBatches).all();

    return context.json({ batches: rows });
  });

  routes.post("/llm/usage", validJson(recordLlmUsageBody), (context) => {
    const { email, purpose, model, inputTokens, cachedTokens, outputTokens, costMicros } =
      context.req.valid("json");

    const user =
      email === undefined
        ? undefined
        : db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, lowercased(email)))
            .get();

    recordLlmUsage(db, clock, {
      userId: user?.id ?? null,
      purpose,
      model,
      inputTokens,
      cachedTokens,
      outputTokens,
      costMicros,
    });

    return context.json({ ok: true });
  });

  routes.get("/mail/usage", (context) => context.json(readMailSummary(db, clock.now())));

  routes.post("/mail/usage", validJson(mailUsageBody), (context) => {
    const body = context.req.valid("json");
    const month = monthKey(clock.now());
    const current = readMailUsage(db, month);

    const seed = {
      authSends: body.auth,
      month,
      noticeSends: body.notice,
      refusedAt: body.refusedAt === undefined ? current.refusedAt : body.refusedAt,
      reserveRefusedAt:
        body.reserveRefusedAt === undefined ? current.reserveRefusedAt : body.reserveRefusedAt,
      systemSends: body.system,
      warnedAt: body.warnedAt === undefined ? current.warnedAt : body.warnedAt,
    };

    db.insert(mailUsage)
      .values(seed)
      .onConflictDoUpdate({
        set: {
          authSends: seed.authSends,
          noticeSends: seed.noticeSends,
          refusedAt: seed.refusedAt,
          reserveRefusedAt: seed.reserveRefusedAt,
          systemSends: seed.systemSends,
          warnedAt: seed.warnedAt,
        },
        target: mailUsage.month,
      })
      .run();

    return context.json(readMailSummary(db, clock.now()));
  });

  routes.post("/fx-rates", validJson(fxRateBody), (context) => {
    const { date, currency, perUsd } = context.req.valid("json");

    db.insert(fxRates)
      .values({ date, currency: currency.toUpperCase(), perUsd })
      .onConflictDoUpdate({
        target: [fxRates.date, fxRates.currency],
        set: { perUsd },
      })
      .run();

    return context.json({ ok: true });
  });

  routes.post("/users", validJson(createUserBody), async (context) => {
    const { email, name } = context.req.valid("json");
    const id = crypto.randomUUID();
    const now = new Date(clock.now());

    db.insert(users)
      .values({
        id,
        name,
        email: lowercased(email),
        emailVerified: true,
        role: "user",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await testMailboxes?.ensureFor(id);

    return context.json({ id });
  });

  routes.post("/applications/seed", validJson(seedApplicationBody), (context) => {
    const {
      userId,
      postingId,
      status,
      sentAt,
      createdAt,
      readyAt,
      origin,
      stage,
      stageLocked,
      boardPosition,
      closedReason,
      scheduledFor,
    } = context.req.valid("json");

    const posting = postingDisplayFor(db, postingId);

    if (posting === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const id = crypto.randomUUID();
    const now = createdAt ?? clock.now();
    const seededStage = stage === undefined ? stageForStatus(status) : stage;

    db.insert(applications)
      .values({
        ...posting,
        id,
        userId,
        postingId,
        boardPosition,
        closedReason,
        origin,
        scheduledFor,
        status,
        stage: seededStage,
        stageLocked,
        sentAt,
        readyAt,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return context.json({ id });
  });

  routes.post("/matches/seed", validJson(seedMatchBody), (context) => {
    const { userId, postingId, score, reason, codeRank } = context.req.valid("json");

    db.insert(matches)
      .values({
        codeRank,
        postingId,
        reason,
        resumeId: null,
        score,
        scoredAt: clock.now(),
        targetsVersion: 1,
        userId,
      })
      .onConflictDoUpdate({
        target: [matches.userId, matches.postingId],
        set: { codeRank, reason, score, scoredAt: clock.now() },
      })
      .run();

    return context.json({ ok: true });
  });

  routes.post("/applications/events/seed", validJson(seedEventBody), (context) => {
    const { applicationId, events } = context.req.valid("json");

    const application = db
      .select({ userId: applications.userId })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    db.insert(applicationEvents)
      .values(
        events.map((event) => ({
          at: event.at,
          applicationId,
          detail: event.detail,
          fromValue: event.fromValue,
          id: crypto.randomUUID(),
          kind: event.kind,
          source: event.source,
          toValue: event.toValue,
          userId: application.userId,
        })),
      )
      .run();

    return context.json({ ok: true });
  });

  routes.post("/facts/seed", validJson(seedFactsBody), async (context) => {
    const { facts: records, userId } = context.req.valid("json");
    const saved = [];

    const prepared = await Promise.all(
      records.map(async (record) => {
        const existing = db
          .select({ id: facts.id, revision: facts.revision })
          .from(facts)
          .where(
            and(eq(facts.userId, userId), eq(facts.key, record.key), eq(facts.scope, record.scope)),
          )
          .get();

        const rowId = existing?.id ?? crypto.randomUUID();

        const valueEnc = await personal.sealFor(
          userId,
          { column: "value_enc", rowId, table: "facts" },
          record.value,
        );

        return {
          existing,
          record,
          revision: existing === undefined ? 1 : existing.revision + 1,
          rowId,
          valueEnc,
        };
      }),
    );

    for (const row of prepared) {
      const { existing, record, revision, rowId, valueEnc } = row;

      if (existing === undefined) {
        db.insert(facts)
          .values({
            confirmed: record.confirmed,
            id: rowId,
            key: record.key,
            revision,
            scope: record.scope,
            source: record.source,
            updatedAt: new Date(clock.now()),
            userId,
            valueEnc,
          })
          .run();
      } else {
        db.update(facts)
          .set({
            confirmed: record.confirmed,
            revision,
            source: record.source,
            updatedAt: new Date(clock.now()),
            valueEnc,
          })
          .where(eq(facts.id, rowId))
          .run();
      }

      saved.push({ key: record.key, revision, scope: record.scope });
    }

    return context.json({ saved });
  });

  routes.post("/applications/status", validJson(applicationStatusBody), (context) => {
    const { applicationId, scheduledFor, status, statusReason } = context.req.valid("json");

    const stage = stageForStatus(status);

    const updated = db
      .update(applications)
      .set({
        scheduledFor: scheduledFor === undefined ? undefined : scheduledFor,
        status,
        statusReason,
        stage,
        updatedAt: clock.now(),
      })
      .where(eq(applications.id, applicationId))
      .returning({ id: applications.id })
      .all();

    if (updated.length === 0) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json({ id: applicationId, status });
  });

  routes.post("/user/suspend", validJson(userSuspendBody), (context) => {
    const { userId, suspended } = context.req.valid("json");

    const updated = db
      .update(users)
      .set({
        suspendedAt: suspended ? new Date(clock.now()) : null,
        updatedAt: new Date(clock.now()),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id })
      .all();

    if (updated.length === 0) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json({ id: userId, suspended });
  });

  routes.post("/reviews/seed", validJson(seedReviewBody), (context) =>
    context.json(seedReviewRow(context.req.valid("json"))),
  );

  routes.post("/reviews/open", validJson(seedReviewBody), (context) =>
    context.json(openReviewThroughStore(context.req.valid("json"))),
  );

  routes.post("/notify/apply-failures/ensure", (context) =>
    context.json({ queued: ensureApplyFailuresQueued(db, clock) }),
  );

  routes.get("/reviews", validQuery(userQuery), (context) => {
    const { userId } = context.req.valid("query");

    return context.json({
      reviews: db.select().from(reviews).where(eq(reviews.userId, userId)).all(),
      applications: db.select().from(reviewApplications).all(),
    });
  });

  routes.get("/questions", validQuery(questionsQuery), (context) => {
    const { userId, postingId } = context.req.valid("query");

    const application =
      postingId === undefined
        ? db
            .select({ postingId: applications.postingId })
            .from(applications)
            .where(eq(applications.userId, userId))
            .limit(1)
            .get()
        : { postingId };

    if (application === undefined) {
      return context.json({ questions: [] });
    }

    return context.json({
      questions: db
        .select({
          questionId: postingQuestions.questionId,
          required: postingQuestions.required,
          position: postingQuestions.position,
          options: postingQuestions.options,
          text: questions.textDisplay,
          fieldType: questions.fieldType,
          factKey: questions.factKey,
          answerKind: questions.answerKind,
          mappedBy: questions.mappedBy,
        })
        .from(postingQuestions)
        .innerJoin(questions, eq(questions.id, postingQuestions.questionId))
        .where(eq(postingQuestions.postingId, application.postingId))
        .orderBy(postingQuestions.position)
        .all(),
    });
  });

  routes.get("/plan-cache", (context) => {
    const plans = db
      .select()
      .from(planCache)
      .orderBy(asc(planCache.ats), asc(planCache.formSignature))
      .all()
      .map((row) => {
        const detail = planCacheDetail(row.plan);

        return {
          ats: row.ats,
          failures: row.failures,
          formSignature: row.formSignature,
          hits: row.hits,
          questions: detail.questions,
          readPath: detail.readPath,
          updatedAt: row.updatedAt,
        };
      });

    return context.json({ plans });
  });

  routes.get("/prepared-answers", validQuery(applicationQuery), async (context) => {
    const { applicationId } = context.req.valid("query");

    if (preparation === null) {
      return context.json({ answers: [] });
    }

    return context.json({ answers: await preparation.answersFor(applicationId) });
  });

  routes.get("/applications", validQuery(userQuery), (context) => {
    const { userId } = context.req.valid("query");
    const rows = db.select().from(applications).where(eq(applications.userId, userId)).all();

    return context.json({ applications: rows });
  });

  routes.post("/application-answers", validJson(seedAnswerBody), async (context) => {
    const { applicationId, questionId, kind, sentences } = context.req.valid("json");

    const application = db
      .select({ userId: applications.userId })
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (application === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const existing = db
      .select({ id: applicationAnswers.id })
      .from(applicationAnswers)
      .where(
        and(
          eq(applicationAnswers.applicationId, applicationId),
          eq(applicationAnswers.questionId, questionId),
        ),
      )
      .get();

    const id = existing?.id ?? crypto.randomUUID();

    const sealed = await personal.sealFor(
      application.userId,
      { table: "application_answers", column: "sentences_enc", rowId: id },
      JSON.stringify(sentences),
    );

    const at = clock.now();

    const wordCount = sentences.reduce(
      (count, sentence) => count + sentence.sentence.split(/\s+/u).length,
      0,
    );

    if (existing === undefined) {
      db.insert(applicationAnswers)
        .values({
          id,
          applicationId,
          questionId,
          userId: application.userId,
          kind,
          sentencesEnc: sealed,
          wordCount,
          createdAt: at,
          updatedAt: at,
        })
        .run();
    } else {
      db.update(applicationAnswers)
        .set({ sentencesEnc: sealed, wordCount, updatedAt: at })
        .where(eq(applicationAnswers.id, existing.id))
        .run();
    }

    return context.json({ id });
  });

  routes.get("/attempts", validQuery(attemptsQuery), (context) => {
    const { applicationId } = context.req.valid("query");

    return context.json({
      attempts: db
        .select()
        .from(attempts)
        .where(eq(attempts.applicationId, applicationId))
        .orderBy(attempts.startedAt)
        .all(),
    });
  });

  routes.post("/attempts/seed", validJson(seedAttemptBody), (context) => {
    const { applicationId, userId, ...rest } = context.req.valid("json");
    const startedAt = rest.startedAt ?? clock.now();
    const id = crypto.randomUUID();

    const application =
      userId === undefined
        ? db
            .select({ userId: applications.userId })
            .from(applications)
            .where(eq(applications.id, applicationId))
            .get()
        : { userId };

    if (application === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    db.insert(attempts)
      .values({
        applicationId,
        browserMs: rest.browserMs,
        captchaSeen: rest.captchaSeen,
        codeUsed: rest.codeUsed,
        costMicros: rest.costMicros,
        endedAt: startedAt + rest.browserMs,
        id,
        leaseUntil: startedAt + 15 * 60_000,
        n: rest.n ?? 1,
        outcome: rest.outcome,
        provider: rest.provider,
        providerSessionId: rest.providerSessionId ?? null,
        proxyBytes: rest.proxyBytes,
        startedAt,
        submitClickedAt:
          rest.outcome === "sent" || rest.outcome === "unconfirmed" ? startedAt : null,
        submitResponseStatus: rest.outcome === "sent" ? 200 : null,
        userId: application.userId,
      })
      .run();

    return context.json({ id });
  });

  routes.post("/attempts", validJson(seedAttemptsBody), (context) => {
    const { attempts: rows } = context.req.valid("json");
    const now = clock.now();

    for (const [index, row] of rows.entries()) {
      const at = row.startedAt ?? row.at ?? now - index;

      const application = db
        .select({ userId: applications.userId })
        .from(applications)
        .where(eq(applications.id, row.applicationId))
        .get();

      if (application === undefined) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }

      db.insert(attempts)
        .values({
          applicationId: row.applicationId,
          browserMs: row.browserMs,
          captchaSeen: row.captchaSeen || row.outcome === "captcha_blocked",
          codeUsed: row.codeUsed,
          costMicros: row.costMicros,
          endedAt: at + row.browserMs,
          id: crypto.randomUUID(),
          leaseUntil: at + 15 * 60_000,
          n: row.n ?? index + 1,
          outcome: row.outcome,
          provider: row.provider,
          providerSessionId: row.providerSessionId ?? null,
          proxyBytes: row.proxyBytes,
          startedAt: at,
          submitClickedAt: row.outcome === "sent" || row.outcome === "unconfirmed" ? at : null,
          submitResponseStatus: row.outcome === "sent" ? 200 : null,
          userId: application.userId,
        })
        .run();
    }

    return context.json({ seeded: rows.length });
  });

  routes.post("/snapshots/tamper", validJson(tamperSnapshotBody), (context) => {
    const { applicationId, action } = context.req.valid("json");

    const row = db
      .select()
      .from(applicationSnapshots)
      .where(eq(applicationSnapshots.applicationId, applicationId))
      .get();

    if (row === undefined) {
      return context.json({ error: "no snapshot" }, 404);
    }

    try {
      if (action === "update") {
        db.update(applicationSnapshots)
          .set({ consentVersion: "tampered" })
          .where(eq(applicationSnapshots.applicationId, applicationId))
          .run();
      } else if (action === "delete") {
        db.delete(applicationSnapshots)
          .where(eq(applicationSnapshots.applicationId, applicationId))
          .run();
      } else {
        db.delete(users).where(eq(users.id, row.userId)).run();
      }

      return context.json({ refused: false, refusal: null });
    } catch (error) {
      const refusal = error instanceof Error ? error.message : String(error);

      return context.json({ refused: true, refusal });
    }
  });

  routes.get("/matches", validQuery(userQuery), (context) => {
    const { userId } = context.req.valid("query");
    const rows = db.select().from(matches).where(eq(matches.userId, userId)).all();

    return context.json({ matches: rows });
  });

  routes.post("/ledger/grant", validJson(seedGrantBody), async (context) => {
    const { email, quantity, idempotencyKey, source, expiresAt } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    await retryWhenBusy(
      () =>
        grantApplications(db, clock, {
          expiresAt: expiresAt ?? (source === "period" ? clock.now() + 30 * 86_400_000 : null),
          idempotencyKey,
          quantity,
          source,
          startsAt: source === "period" ? clock.now() : null,
          userId: user.id,
        }),
      "test.ledger.grant",
    );

    return context.json({ applicationsLeft: applicationsLeft(db, user.id, clock.now()) });
  });

  routes.post("/ledger/application", validJson(ledgerApplicationBody), async (context) => {
    const { email, applicationId, commit } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const reserved = await retryWhenBusy(
      () =>
        reserveForApplication(db, clock, {
          applicationId,
          idempotencyKey: `test-reserve:${user.id}:${applicationId}`,
          userId: user.id,
        }),
      "test.ledger.reserve",
    );

    if (commit) {
      await retryWhenBusy(
        () =>
          commitForApplication(db, clock, {
            applicationId,
            idempotencyKey: `test-commit:${user.id}:${applicationId}`,
            userId: user.id,
          }),
        "test.ledger.commit",
      );
    }

    return context.json({
      applicationsLeft: applicationsLeft(db, user.id, clock.now()),
      reserved: reserved.reserved,
    });
  });

  routes.post("/ledger/release", validJson(ledgerReleaseBody), async (context) => {
    const { email, applicationId } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const released = await retryWhenBusy(
      () =>
        releaseForApplication(db, clock, {
          applicationId,
          idempotencyKey: `test-release:${user.id}:${applicationId}`,
          userId: user.id,
        }),
      "test.ledger.release",
    );

    return context.json({
      applicationsLeft: applicationsLeft(db, user.id, clock.now()),
      released: released.released,
    });
  });

  routes.get("/billing-state", validQuery(userQuery), (context) => {
    const { userId } = context.req.valid("query");

    return context.json({
      applicationsLeft: applicationsLeft(db, userId, clock.now()),
      grants: db
        .select()
        .from(grants)
        .where(eq(grants.userId, userId))
        .orderBy(asc(grants.createdAt))
        .all(),
      ledger: db
        .select()
        .from(ledger)
        .where(eq(ledger.userId, userId))
        .orderBy(asc(ledger.createdAt), asc(ledger.id))
        .all(),
    });
  });

  routes.get("/mail", (context) => {
    const captured = listSinkMail().map((sent) => ({
      id: sent.id,
      to: sent.to,
      from: sent.from,
      subject: sent.subject,
      body: sent.body,
      sentAt: sent.sentAt,
    }));

    return context.json({ messages: captured });
  });

  routes.post("/mail/clear", (context) => {
    clearSinkMail();

    return context.json({ ok: true });
  });

  routes.post(
    "/mail/fail-next",
    validJson(z.object({ count: z.number().int().min(1).max(100).default(1) })),
    (context) => {
      failNextSinkMail(context.req.valid("json").count);

      return context.json({ ok: true });
    },
  );

  routes.get("/cloudflare-email", (context) =>
    context.json({ requests: listCloudflareEmailRequests() }),
  );

  routes.post("/cloudflare-email/clear", (context) => {
    clearCloudflareEmailRequests();

    return context.json({ ok: true });
  });

  routes.post(
    "/cloudflare-email/sending-scenario",
    validJson(z.object({ scenario: z.enum(emailSendingScenarios) })),
    (context) => {
      const { scenario } = context.req.valid("json");

      setEmailSendingScenario(scenario);

      return context.json({ scenario });
    },
  );

  routes.post("/mail/seed", validJson(seedMailBody), async (context) =>
    context.json(await insertMailRow(context.req.valid("json"))),
  );

  routes.post("/snapshots/seed", validJson(seedSnapshotBody), async (context) => {
    const body = context.req.valid("json");

    const application = db
      .select()
      .from(applications)
      .where(eq(applications.id, body.applicationId))
      .get();

    if (application === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const resume = db
      .select()
      .from(resumes)
      .where(and(eq(resumes.userId, application.userId), eq(resumes.isCurrent, true)))
      .get();

    if (resume === undefined) {
      return context.json({ error: "no resume" }, 409);
    }

    const answersEnc = await personal.sealFor(
      application.userId,
      { column: "answers_enc", rowId: body.applicationId, table: "application_snapshots" },
      JSON.stringify(body.answers),
    );

    const coverLetterEnc =
      body.coverLetter === null
        ? null
        : await personal.sealFor(
            application.userId,
            {
              column: "cover_letter_enc",
              rowId: body.applicationId,
              table: "application_snapshots",
            },
            JSON.stringify(body.coverLetter),
          );

    db.insert(applicationSnapshots)
      .values({
        answersEnc,
        applicationId: body.applicationId,
        approvedAt: clock.now(),
        approvedPlanSha256: null,
        confirmedBy: "page",
        consentVersion: "m1",
        costMicros: 0,
        coverLetterEnc,
        descriptionHash: null,
        postingTitle: "Senior Backend Engineer",
        postingUrl: "https://export.example/jobs/1",
        provider: "local",
        providerSessionId: null,
        resumeId: resume.id,
        resumeSha256: resume.sha256,
        submittedAt: clock.now(),
        userId: application.userId,
      })
      .onConflictDoUpdate({
        target: applicationSnapshots.applicationId,
        set: { answersEnc, coverLetterEnc, submittedAt: clock.now() },
      })
      .run();

    return context.json({ applicationId: body.applicationId });
  });

  routes.post("/mail/bulk", validJson(bulkMailBody), async (context) => {
    const body = context.req.valid("json");
    const at = body.at ?? clock.now();
    const localPart = `owner-${body.userId.slice(0, 8)}`;

    const existingMailbox = db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.userId, body.userId))
      .get();

    const mailboxId = existingMailbox?.id ?? crypto.randomUUID();

    if (existingMailbox === undefined) {
      db.insert(mailboxes)
        .values({
          createdAt: new Date(at),
          id: mailboxId,
          localPart,
          status: "active",
          userId: body.userId,
        })
        .run();
    }

    const filler = "x".repeat(body.bodyBytes);

    const rows = await Promise.all(
      Array.from({ length: body.count }, async (_unused, index) => {
        const messageId = crypto.randomUUID();
        const threadId = crypto.randomUUID();
        const scope = (column: string) => ({ column, rowId: messageId, table: "messages" });
        const text = `Message ${String(index)} from an employer.\n${filler}`;

        db.insert(mailThreads)
          .values({
            applicationId: null,
            employerStarted: true,
            id: threadId,
            lastMessageAt: new Date(at + index),
            subjectEnc: await personal.sealFor(
              body.userId,
              { column: "subject_enc", rowId: threadId, table: "mail_threads" },
              `Bulk thread ${String(index)}`,
            ),
            userId: body.userId,
          })
          .run();

        return {
          auth: "pass" as const,
          classification: "ack" as const,
          createdAt: new Date(at + index),
          direction: "in" as const,
          fromEnc: await personal.sealFor(
            body.userId,
            scope("from_enc"),
            "Greenhouse <no-reply@us.greenhouse-mail.io>",
          ),
          id: messageId,
          mailboxId,
          rfcMessageId: `<${messageId}@${body.senderDomain}>`,
          senderDomain: body.senderDomain,
          snippetEnc: await personal.sealFor(body.userId, scope("snippet_enc"), text.slice(0, 200)),
          subjectEnc: await personal.sealFor(
            body.userId,
            scope("subject_enc"),
            `Bulk message ${String(index)}`,
          ),
          textEnc: await personal.sealFor(body.userId, scope("text_enc"), text),
          threadId,
          toEnc: await personal.sealFor(
            body.userId,
            scope("to_enc"),
            `in-${localPart}@tryoverture.com`,
          ),
          userId: body.userId,
        };
      }),
    );

    db.transaction((tx) => {
      for (const row of rows) {
        tx.insert(messages).values(row).run();
      }
    });

    return context.json({ count: body.count, threads: body.count });
  });

  routes.post(
    "/account-exports/seed",
    validJson(exportsQuery.pick({ userId: true })),
    async (context) => {
      if (objects === null) {
        return context.json({ error: "no object store" }, 503);
      }

      const { userId } = context.req.valid("json");
      const id = crypto.randomUUID();
      const now = clock.now();

      const keyEnc = await personal.sealFor(
        userId,
        { column: "key_enc", rowId: id, table: "account_exports" },
        newExportKey(),
      );

      const objectKey = `files/${userId}/exports/${id}.ovex`;
      const bytes = new TextEncoder().encode("seeded export");

      await objects.put(objectKey, bytes);

      db.insert(accountExports)
        .values({
          bytes: bytes.length,
          error: null,
          expiresAt: new Date(now + 24 * 60 * 60_000),
          id,
          keyEnc,
          notifiedAt: null,
          objectKey,
          readyAt: new Date(now),
          requestedAt: new Date(now),
          status: "ready",
          updatedAt: new Date(now),
          userId,
        })
        .run();

      return context.json({ id });
    },
  );

  routes.get("/account/exports", validQuery(exportsQuery), (context) => {
    const { userId } = context.req.valid("query");

    return context.json({
      exports: listExportsOf(db, userId).map((row) => ({
        bytes: row.bytes,
        error: row.error,
        expiresAt: row.expiresAt?.getTime() ?? null,
        id: row.id,
        notifiedAt: row.notifiedAt?.getTime() ?? null,
        objectKey: row.objectKey,
        readyAt: row.readyAt?.getTime() ?? null,
        requestedAt: row.requestedAt.getTime(),
        status: row.status,
      })),
    });
  });

  routes.get("/objects", validQuery(objectsQuery), async (context) => {
    if (objects === null) {
      return context.json({ error: "no object store" }, 503);
    }

    const { prefix } = context.req.valid("query");
    const keys: string[] = [];

    for await (const key of objects.list(prefix)) {
      keys.push(key);
    }

    return context.json({ keys });
  });

  routes.post("/user/name", validJson(userNameBody), (context) => {
    const { email, name } = context.req.valid("json");

    db.update(users)
      .set({ name })
      .where(eq(users.email, lowercased(email)))
      .run();

    return context.json({ ok: true });
  });

  routes.post("/ledger/sample", validJson(sampleLedgerBody), async (context) => {
    const { email } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    await seedSampleLedger(user.id, "sample");

    return context.json({ applicationsLeft: applicationsLeft(db, user.id, clock.now()) });
  });

  routes.post("/home/sample", validJson(homeSampleBody), async (context) => {
    const { email, variant } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const userId = user.id;
    const now = clock.now();
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const at = new Date(now);
    const todayStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
    const dayStart = (offset: number) => todayStart + offset * day;

    await seedSampleLedger(userId, "home-sample");

    const paused = variant === "paused";

    db.insert(profiles)
      .values({
        createdAt: new Date(now),
        languages: "[]",
        pauseReason: paused ? "user" : null,
        running: !paused,
        timezone: "UTC",
        updatedAt: new Date(now),
        userId,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          pauseReason: paused ? "user" : null,
          running: !paused,
          timezone: "UTC",
          updatedAt: new Date(now),
        },
      })
      .run();

    function addCompany(name: string, domain: string, token: string) {
      const companyId = crypto.randomUUID();
      const boardId = crypto.randomUUID();

      db.insert(companies)
        .values({ createdAt: now, domain, id: companyId, name, nameNorm: name.toLowerCase() })
        .run();

      db.insert(companyBoards)
        .values({
          ats: "greenhouse",
          backoffLevel: 0,
          boardToken: token,
          companyId,
          consecutiveErrors: 0,
          createdAt: now,
          id: boardId,
          notFoundPolls: 0,
          region: "us",
          source: "discovered",
          status: "active",
        })
        .run();

      return { boardId, companyId };
    }

    let sequence = 0;

    function addPosting(
      owner: { boardId: string; companyId: string },
      title: string,
      atsJobId: string,
    ) {
      sequence += 1;

      return seedPosting(
        db,
        {
          ats: "greenhouse",
          atsJobId,
          boardId: owner.boardId,
          companyId: owner.companyId,
          employmentType: "full_time",
          questions: [],
          tags: [],
          title,
          url: `https://boards.example/jobs/${atsJobId}`,
          workplace: "remote",
        },
        now,
      );
    }

    function addApplication(input: {
      postingId: string;
      status: "approved" | "ready" | "needs_review" | "sent" | "failed";
      createdAt?: number;
      scheduledFor?: number;
      sentAt?: number;
      stage?: "applied" | "screening" | "interviewing" | "closed" | "queued" | "ready" | null;
      statusReason?: string | null;
      updatedAt?: number;
    }) {
      const id = crypto.randomUUID();
      const display = postingDisplayFor(db, input.postingId);

      if (display === undefined) {
        throw new Error(`the seeded posting ${input.postingId} is missing`);
      }

      db.insert(applications)
        .values({
          ...display,
          attempts: 0,
          closedReason: input.stage === "closed" ? "rejected" : null,
          createdAt: input.createdAt ?? now,
          id,
          origin: "auto",
          postingId: input.postingId,
          scheduledFor: input.scheduledFor ?? null,
          scoreAtQueue: null,
          sentAt: input.sentAt ?? null,
          stage: input.stage === undefined ? defaultStageFor(input.status) : input.stage,
          stageLocked: false,
          status: input.status,
          statusReason: input.statusReason ?? null,
          updatedAt: input.updatedAt ?? now,
          userId,
        })
        .run();

      return id;
    }

    function addStageEvent(
      applicationId: string,
      eventAt: number,
      from: string | null,
      to: string | null,
    ) {
      db.insert(applicationEvents)
        .values({
          applicationId,
          at: eventAt,
          detail: null,
          fromValue: from,
          id: crypto.randomUUID(),
          kind: "stage",
          source: "email",
          toValue: to,
          userId,
        })
        .run();
    }

    const sample = addCompany("Sample Works", "sample.example", "home-sample");

    const feed = [
      {
        applicationId: "",
        at: dayStart(0) + 9 * hour + 12 * minute,
        classification: "other" as const,
        company: "Halden Systems",
        domain: "halden.example",
        eventAt: dayStart(0) + 9 * hour + 12 * minute,
        from: "screening",
        sentAt: dayStart(0) + 7 * hour + 58 * minute,
        stage: "interviewing" as const,
        subject: "can you do Thursday at 2 pm?",
        text: "Thursday at 2 pm works for us. Can you make it?",
        title: "Platform Engineer",
        token: "home-halden",
        to: "interviewing",
      },
      {
        applicationId: "",
        at: dayStart(0) + 8 * hour + 47 * minute,
        classification: "ack" as const,
        company: "Northwind Labs",
        domain: "northwind.example",
        eventAt: null,
        from: null,
        sentAt: dayStart(0) + 8 * hour + 47 * minute,
        stage: "applied" as const,
        subject: "Your application to Northwind Labs",
        text: "Thank you for applying to Northwind Labs. We received your application.",
        title: "Site Reliability Engineer",
        token: "home-northwind",
        to: null,
      },
      {
        applicationId: "",
        at: dayStart(-1) + 16 * hour + 30 * minute,
        classification: "screening" as const,
        company: "Larkspur Health",
        domain: "larkspur.example",
        eventAt: dayStart(-1) + 16 * hour + 30 * minute,
        from: "applied",
        sentAt: dayStart(-1) + 16 * hour + 30 * minute,
        stage: "screening" as const,
        subject: "Phone screen invitation",
        text: "We would like to invite you to a phone screen with our team.",
        title: "Backend Engineer",
        token: "home-larkspur",
        to: "screening",
      },
      {
        applicationId: "",
        at: dayStart(-1) + 11 * hour + 5 * minute,
        classification: "rejection" as const,
        company: "Ferro Cloud",
        domain: "ferro.example",
        eventAt: dayStart(-1) + 11 * hour + 5 * minute,
        from: "interviewing",
        sentAt: dayStart(-3) + 10 * hour,
        stage: "closed" as const,
        subject: "Not moving forward",
        text: "Unfortunately we are not moving forward with your application.",
        title: "DevOps Engineer",
        token: "home-ferro",
        to: "closed",
      },
    ];

    for (const entry of feed) {
      const owner = addCompany(entry.company, entry.domain, entry.token);
      const postingId = addPosting(owner, entry.title, `${entry.token}-1`);

      const applicationId = addApplication({
        postingId,
        sentAt: entry.sentAt,
        stage: entry.stage,
        status: "sent",
      });

      if (entry.eventAt !== null) {
        addStageEvent(applicationId, entry.eventAt, entry.from, entry.to);
      }

      entry.applicationId = applicationId;
    }

    const dailyCounts = [3, 5, 4, 6, 7, 5, 7];
    const feedPerDay = [0, 0, 0, 1, 0, 1, 2];

    for (const [index, count] of dailyCounts.entries()) {
      const offset = index - 6;
      const interviewDay = offset === -2 || offset === -4 ? 1 : 0;
      const extras = count - (feedPerDay[index] ?? 0) - interviewDay;

      for (let extra = 0; extra < extras; extra += 1) {
        const postingId = addPosting(sample, "Backend Engineer", `home-sent-${String(sequence)}`);

        addApplication({
          postingId,
          sentAt: dayStart(offset) + 6 * hour + extra * 6 * minute,
          status: "sent",
        });
      }
    }

    const previousCounts = [4, 4, 5, 4, 4, 5, 5];

    for (const [index, count] of previousCounts.entries()) {
      const offset = index - 13;

      for (let extra = 0; extra < count; extra += 1) {
        const postingId = addPosting(sample, "Backend Engineer", `home-prior-${String(sequence)}`);

        addApplication({
          postingId,
          sentAt: dayStart(offset) + 10 * hour + extra * 5 * minute,
          status: "sent",
        });
      }
    }

    for (let index = 0; index < 11; index += 1) {
      const postingId = addPosting(sample, "Backend Engineer", `home-ready-${String(index)}`);

      let scheduledFor: number;

      if (!paused) {
        scheduledFor = dayStart(0) + (11 * 60 + 40 + index * 20) * minute;
      } else if (index < 2) {
        scheduledFor = dayStart(0) + (10 * 60 + 40 + index * 15) * minute;
      } else {
        scheduledFor = dayStart(0) + (14 * 60 + 20 + (index - 2) * 20) * minute;
      }

      addApplication({
        postingId,
        scheduledFor,
        stage: "queued",
        status: "approved",
      });
    }

    const readySeeds = [
      {
        company: "Northwind Labs",
        domain: "ready-northwind.example",
        title: "Platform Engineer",
        token: "home-ready-northwind",
      },
      {
        company: "Halden Systems",
        domain: "ready-halden.example",
        title: "Site Reliability Engineer",
        token: "home-ready-halden",
      },
    ];

    for (const entry of readySeeds) {
      const owner = addCompany(entry.company, entry.domain, entry.token);
      const postingId = addPosting(owner, entry.title, `${entry.token}-1`);

      addApplication({
        postingId,
        stage: "ready",
        status: "ready",
        updatedAt: dayStart(0) + 7 * hour,
      });
    }

    const approvedOwner = addCompany(
      "Larkspur Health",
      "ready-larkspur.example",
      "home-ready-larkspur",
    );

    const approvedPosting = addPosting(
      approvedOwner,
      "Senior Backend Engineer",
      "home-ready-larkspur-1",
    );

    addApplication({
      postingId: approvedPosting,
      scheduledFor: dayStart(0) + 14 * hour + 20 * minute,
      stage: "ready",
      status: "approved",
      updatedAt: dayStart(0) + 7 * hour + minute,
    });

    const failedOwner = addCompany("Ferro Cloud", "ferro-failed.example", "home-ferro-failed");
    const failedPosting = addPosting(failedOwner, "DevOps Engineer", "home-ferro-failed-1");

    addApplication({
      postingId: failedPosting,
      stage: null,
      status: "failed",
      statusReason: "form_changed",
      updatedAt: dayStart(-1) + 11 * hour + 5 * minute,
    });

    const checkInPosting = addPosting(sample, "Backend Engineer", "home-checkin-1");

    const checkInSentAt = dayStart(-25) + 10 * hour;

    const checkInApplication = addApplication({
      postingId: checkInPosting,
      sentAt: checkInSentAt,
      stage: "applied",
      status: "sent",
    });

    if (paused) {
      db.insert(checkins)
        .values({
          answer: null,
          applicationId: checkInApplication,
          createdAt: checkInSentAt + 21 * day,
          dueAt: checkInSentAt + 21 * day,
          id: crypto.randomUUID(),
          status: "open",
          userId,
        })
        .run();
    }

    const seedFacts: { key: string; value: string }[] = [
      { key: "legal_name", value: "Maya Okafor" },
      { key: "email", value: "maya.okafor@example.com" },
      { key: "phone", value: "+1 416 555 0100" },
      { key: "current_city", value: "Toronto" },
      { key: "current_country", value: "CA" },
      { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
    ];

    await Promise.all(
      seedFacts.map(async (fact) => {
        const rowId = crypto.randomUUID();

        db.insert(facts)
          .values({
            confirmed: true,
            id: rowId,
            key: fact.key,
            revision: 1,
            scope: "",
            source: "user",
            updatedAt: new Date(now),
            userId,
            valueEnc: await personal.sealFor(
              userId,
              { column: "value_enc", rowId, table: "facts" },
              fact.value,
            ),
          })
          .run();
      }),
    );

    const interviewExtras = [
      { offset: -2, at: dayStart(-2) + 15 * hour },
      { offset: -4, at: dayStart(-4) + 14 * hour },
    ];

    for (const extra of interviewExtras) {
      const postingId = addPosting(sample, "Backend Engineer", `home-event-${String(sequence)}`);

      const applicationId = addApplication({
        postingId,
        sentAt: dayStart(extra.offset) + 10 * hour,
        stage: "interviewing",
        status: "sent",
      });

      addStageEvent(applicationId, extra.at, "screening", "interviewing");
    }

    const reviewFixtures: {
      company: string;
      domain: string;
      title: string;
      token: string;
    }[] = [
      {
        company: "Northwind Labs",
        domain: "review-northwind.example",
        title: "Platform Engineer",
        token: "review-northwind",
      },
      {
        company: "Ferro Cloud",
        domain: "review-ferro.example",
        title: "Senior DevOps Engineer",
        token: "review-ferro",
      },
      {
        company: "Halden Systems",
        domain: "review-halden.example",
        title: "Site Reliability Engineer",
        token: "review-halden",
      },
      {
        company: "Larkspur Health",
        domain: "review-larkspur.example",
        title: "Platform Engineer",
        token: "review-larkspur",
      },
      {
        company: "Halden Systems",
        domain: "review-halden-staff.example",
        title: "Staff Platform Engineer",
        token: "review-halden-staff",
      },
      {
        company: "Tideline Software",
        domain: "review-tideline.example",
        title: "Backend Engineer",
        token: "review-tideline",
      },
      {
        company: "Brightwave Analytics",
        domain: "review-brightwave.example",
        title: "Infrastructure Engineer",
        token: "review-brightwave",
      },
      {
        company: "Larkspur Health",
        domain: "review-larkspur-senior.example",
        title: "Senior Platform Engineer",
        token: "review-larkspur-senior",
      },
      {
        company: "Ferro Cloud",
        domain: "review-ferro-cloud.example",
        title: "Cloud Engineer",
        token: "review-ferro-cloud",
      },
      {
        company: "Ferro Cloud",
        domain: "review-ferro-platform.example",
        title: "Platform Engineer",
        token: "review-ferro-platform",
      },
    ];

    const reviewApplicationIds: string[] = [];

    for (const [index, entry] of reviewFixtures.entries()) {
      const owner = addCompany(entry.company, entry.domain, entry.token);
      const postingId = addPosting(owner, entry.title, `${entry.token}-1`);

      reviewApplicationIds.push(
        addApplication({
          createdAt: index + 1,
          postingId,
          stage: "queued",
          status: "needs_review",
        }),
      );
    }

    const reviewSeeds = [
      {
        applicationIds: reviewApplicationIds.slice(0, 4),
        fieldType: "select" as const,
        options: ["Yes", "No"],
        prompt: "Are you comfortable with a weekly on-call rotation?",
      },
      {
        applicationIds: reviewApplicationIds.slice(4, 7),
        fieldType: "text" as const,
        options: [],
        prompt: "How many years have you run Kubernetes in production?",
      },
      {
        applicationIds: reviewApplicationIds.slice(7, 9),
        fieldType: "text" as const,
        options: [],
        prompt: "Security clearance status",
      },
      {
        applicationIds: reviewApplicationIds.slice(9),
        fieldType: "url" as const,
        options: [],
        prompt: "Link to your portfolio",
      },
    ];

    for (const review of reviewSeeds) {
      seedReviewRow({
        answerKind: "unknown",
        applicationIds: review.applicationIds,
        fieldType: review.fieldType,
        options: review.options,
        prompt: review.prompt,
        reason: "unknown_required",
        scope: "",
        userId,
      });
    }

    await Promise.all(
      feed.map(async (entry) =>
        insertMailRow({
          applicationId: entry.applicationId,
          attachments: [],
          at: entry.at,
          auth: "pass",
          classification: entry.classification,
          direction: "in",
          from: `${entry.company} <no-reply@${entry.domain}>`,
          senderDomain: entry.domain,
          subject: entry.subject,
          text: entry.text,
          userId,
        }),
      ),
    );

    const olderMessages = [-5, -5, -4, -3, -2].map((offset, index) => ({
      at: dayStart(offset) + (index % 2 === 0 ? 10 : 15) * hour,
    }));

    await Promise.all(
      olderMessages.map(async (message, index) =>
        insertMailRow({
          applicationId: null,
          attachments: [],
          at: message.at,
          auth: "pass",
          classification: "other",
          direction: "in",
          from: "Tideline Software <no-reply@tideline.example>",
          senderDomain: "tideline.example",
          subject: `Update on your application ${String(index + 1)}`,
          text: "We will be in touch soon.",
          userId,
        }),
      ),
    );

    for (const [index, row] of [
      {
        body: "Overture prepared your applications this morning. Nothing is sent until you approve.",
        kind: "ready",
        title: "Recap: 10 ready to approve, 2 need an answer",
        url: "/ready",
      },
      {
        body: "Answering it lets 4 applications go ahead.",
        kind: "review",
        title: "A question for you",
        url: "/review",
      },
      {
        body: "About Site Reliability Engineer. Read it in Inbox.",
        kind: "reply",
        title: "Halden Systems replied",
        url: "/inbox",
      },
    ].entries()) {
      db.insert(notifications)
        .values({
          body: row.body,
          createdAt: dayStart(0) + (7 + index) * hour,
          id: crypto.randomUUID(),
          kind: row.kind,
          title: row.title,
          url: row.url,
          userId,
        })
        .run();
    }

    return context.json({ ok: true });
  });

  routes.post("/profile/running", validJson(profileRunningBody), (context) => {
    const { running, userId } = context.req.valid("json");
    const now = clock.now();

    db.insert(profiles)
      .values({
        createdAt: new Date(now),
        languages: "[]",
        pauseReason: running ? null : "user",
        running,
        timezone: "UTC",
        updatedAt: new Date(now),
        userId,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: { pauseReason: running ? null : "user", running, updatedAt: new Date(now) },
      })
      .run();

    return context.json({ running });
  });

  routes.post("/home/pause", validJson(homePauseBody), (context) => {
    const { email, pauseReason } = context.req.valid("json");

    const user = db
      .select()
      .from(users)
      .where(eq(users.email, lowercased(email)))
      .get();

    if (user === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    db.update(profiles)
      .set({ pauseReason, running: false, updatedAt: new Date(clock.now()) })
      .where(eq(profiles.userId, user.id))
      .run();

    return context.json({ pauseReason });
  });

  routes.post("/ledger/tamper", validJson(tamperLedgerBody), (context) => {
    const { action } = context.req.valid("json");
    const row = db.select().from(ledger).limit(1).get();

    if (row === undefined) {
      return context.json({ error: "no ledger rows" }, 404);
    }

    try {
      if (action === "update") {
        db.update(ledger)
          .set({ amount: row.amount + 1 })
          .where(eq(ledger.id, row.id))
          .run();
      } else if (action === "delete") {
        db.delete(ledger).where(eq(ledger.id, row.id)).run();
      } else {
        db.delete(users).where(eq(users.id, row.userId)).run();
      }

      return context.json({ refused: false, refusal: null });
    } catch (error) {
      const refusal = error instanceof Error ? error.message : String(error);

      return context.json({ refused: true, refusal });
    }
  });

  routes.get("/ledger/rows", (context) =>
    context.json({ rows: db.select().from(ledger).all().length }),
  );

  routes.get("/stripe-state", (context) =>
    context.json({
      customers: db.select().from(customers).all(),
      events: db.select().from(stripeEvents).all(),
      subscriptions: db.select().from(subscriptions).all(),
    }),
  );

  routes.get("/auth/state", (context) => {
    const allUsers = db.select().from(users).all();
    const allAccounts = db.select().from(accounts).all();
    const allSessions = db.select().from(sessions).all();

    return context.json({
      users: allUsers,
      accounts: allAccounts.map((account) => ({
        id: account.id,
        userId: account.userId,
        providerId: account.providerId,
        accountId: account.accountId,
      })),
      sessions: allSessions.map((session) => ({
        id: session.id,
        userId: session.userId,
        token: session.token,
        expiresAt: session.expiresAt,
      })),
    });
  });

  routes.post("/auth/role", validJson(roleBody), (context) => {
    const { userId, role } = context.req.valid("json");

    const updated = db
      .update(users)
      .set({ role, updatedAt: new Date(clock.now()) })
      .where(eq(users.id, userId))
      .returning()
      .all();

    if (updated.length === 0) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return context.json({ userId, role });
  });

  routes.post(
    "/mail/code-waits",
    validJson(
      z.object({
        mailboxId: z.string().min(1).optional(),
        attemptId: z.string().min(1).optional(),
        email: z.string().optional(),
        expiresAt: z.number().int().optional(),
        startedAt: z.number().int().optional(),
      }),
    ),
    async (context) => {
      const body = context.req.valid("json");

      let mailboxId: string | undefined;
      let ownerId: string | undefined;

      if (body.mailboxId !== undefined) {
        const mailbox = db.select().from(mailboxes).where(eq(mailboxes.id, body.mailboxId)).get();

        mailboxId = mailbox?.id;
        ownerId = mailbox?.userId;
      }

      if (mailboxId === undefined && body.email !== undefined) {
        const user = db.select().from(users).where(eq(users.email, body.email.toLowerCase())).get();

        if (user === undefined || testMailboxes === null) {
          return context.json({ error: API_ERRORS.notFound }, 404);
        }

        const ensured = await testMailboxes.ensureFor(user.id);

        mailboxId = ensured.id;
        ownerId = user.id;
      }

      if (mailboxId === undefined || ownerId === undefined) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }

      const wait =
        body.startedAt === undefined
          ? createCodeWait(db, clock, {
              attemptId: body.attemptId ?? null,
              mailboxId,
              userId: ownerId,
            })
          : insertCodeWaitAt(
              { id: mailboxId, userId: ownerId },
              body.attemptId ?? null,
              body.startedAt,
              body.expiresAt ?? body.startedAt + CODE_WAIT_TIMEOUT_MS,
            );

      if (wait === undefined) {
        return context.json({ error: "not created" }, 500);
      }

      return context.json({
        ...wait,
        startedAt: wait.startedAt.getTime(),
        expiresAt: wait.expiresAt.getTime(),
        resolvedAt: wait.resolvedAt?.getTime() ?? null,
        code: null,
      });
    },
  );

  routes.get("/mail/code-waits/:id", async (context) => {
    const wait = db
      .select()
      .from(codeWaits)
      .where(eq(codeWaits.id, context.req.param("id")))
      .get();

    if (wait === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const code =
      wait.codeEnc === null
        ? null
        : await personal.openFor(
            wait.userId,
            { table: "code_waits", column: "code_enc", rowId: wait.id },
            wait.codeEnc,
          );

    return context.json({
      ...wait,
      startedAt: wait.startedAt.getTime(),
      expiresAt: wait.expiresAt.getTime(),
      resolvedAt: wait.resolvedAt?.getTime() ?? null,
      code,
    });
  });

  routes.get(
    "/mail/messages",
    validQuery(z.object({ mailboxId: z.string().min(1) })),
    async (context) => {
      const { mailboxId } = context.req.valid("query");

      const rows = db
        .select()
        .from(messages)
        .where(eq(messages.mailboxId, mailboxId))
        .orderBy(asc(messages.createdAt))
        .all();

      const result = await Promise.all(
        rows.map(async (row) => {
          const scope = (column: string) => ({ table: "messages", column, rowId: row.id });

          const attachments = db
            .select({ id: messageAttachments.id, mime: messageAttachments.mime })
            .from(messageAttachments)
            .where(eq(messageAttachments.messageId, row.id))
            .all();

          return {
            id: row.id,
            threadId: row.threadId,
            direction: row.direction,
            rfcMessageId: row.rfcMessageId,
            inReplyTo: row.inReplyTo,
            senderDomain: row.senderDomain,
            auth: row.auth,
            classification: row.classification,
            subject: await personal.openFor(row.userId, scope("subject_enc"), row.subjectEnc),
            from: await personal.openFor(row.userId, scope("from_enc"), row.fromEnc),
            to: await personal.openFor(row.userId, scope("to_enc"), row.toEnc),
            text: await personal.openFor(row.userId, scope("text_enc"), row.textEnc),
            snippet: await personal.openFor(row.userId, scope("snippet_enc"), row.snippetEnc),
            htmlObjectKey: row.htmlObjectKey,
            attachments,
            codeConsumedAt: row.codeConsumedAt?.getTime() ?? null,
            createdAt: row.createdAt.getTime(),
          };
        }),
      );

      return context.json({ messages: result });
    },
  );

  routes.get("/mail/threads", async (context) => {
    const mailboxId = context.req.query("mailboxId");

    const mailbox =
      mailboxId === undefined
        ? undefined
        : db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).get();

    if (mailbox === undefined) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    const rows = db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.userId, mailbox.userId))
      .orderBy(asc(mailThreads.lastMessageAt))
      .all();

    const threads = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        applicationId: row.applicationId,
        subject: await personal.openFor(
          row.userId,
          { table: "mail_threads", column: "subject_enc", rowId: row.id },
          row.subjectEnc,
        ),
        employerStarted: row.employerStarted,
        lastMessageAt: row.lastMessageAt.getTime(),
      })),
    );

    return context.json({ threads });
  });

  routes.get("/mailboxes", validQuery(z.object({ userId: z.string().min(1) })), (context) => {
    const rows = db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.userId, context.req.valid("query").userId))
      .all();

    return context.json({
      mailboxes: rows.map((row) => ({
        id: row.id,
        localPart: row.localPart,
        status: row.status,
        receiveUntil: row.receiveUntil?.getTime() ?? null,
        firstForwardedAt: row.firstForwardedAt?.getTime() ?? null,
      })),
    });
  });

  routes.post(
    "/mailboxes/first-forwarded",
    validJson(z.object({ userId: z.string().min(1) })),
    async (context) => {
      if (testMailboxes === null) {
        return context.json({ error: "inbound_not_configured" }, 503);
      }

      const mailbox = await testMailboxes.ensureFor(context.req.valid("json").userId);

      testMailboxes.markFirstForwarded(mailbox.id, clock.now());

      return context.json({ ok: true });
    },
  );

  routes.post(
    "/mailboxes/:id/status",
    validJson(z.object({ status: z.enum(["active", "receive_only", "closed"]) })),
    (context) => {
      const { status } = context.req.valid("json");

      const updated = db
        .update(mailboxes)
        .set({ status })
        .where(eq(mailboxes.id, context.req.param("id")))
        .returning({ id: mailboxes.id })
        .all();

      const id = updated[0]?.id;

      if (id === undefined) {
        return context.json({ error: API_ERRORS.notFound }, 404);
      }

      return context.json({ id, status });
    },
  );

  return routes;
}
