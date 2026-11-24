import { sql } from "drizzle-orm";
import { z } from "zod";

import { createApp } from "./app.ts";
import {
  assertMasterKeyCoverage,
  enqueueMasterKeyRotation,
  MASTER_KEY_ROTATION_JOB_BATCHES,
  MASTER_KEY_ROTATION_JOB_KIND,
  masterKeyRetirementWarning,
  masterKeyRotationPayloadSchema,
  runMasterKeyRotation,
} from "./admin/key-rotation.ts";
import { createAuth } from "./auth/index.ts";
import type { AuthOptions } from "./auth/index.ts";
import { catalogDatabasePath, databasePath, env, labBaseUrl, masterKeyring } from "./config/env.ts";
import { createMailSender, emailSendingConfigFromEnv } from "./platform/mail/index.ts";
import { MailCapExceededError } from "./platform/mail/errors.ts";
import { createPayments } from "./billing/index.ts";
import {
  ensureGrantExpiryQueued,
  GRANT_EXPIRY_JOB_KIND,
  runGrantExpirySweep,
} from "./billing/expiry.ts";
import { createSpendGate } from "./billing/spend.ts";
import {
  BILLING_RECONCILE_JOB_KIND,
  billingReconcileJobHandler,
  ensureReconcileQueued,
} from "./billing/reconcile.ts";
import { seedDemoAccount } from "./demo/seed.ts";
import { createDemoSafeMailSender } from "./demo/mail-guard.ts";
import { isDemoUser } from "./demo/role.ts";
import { demoStartupNotice } from "./demo/startup.ts";
import { logError, logInfo } from "./platform/log.ts";
import { openCatalogDatabase, openDatabase } from "./platform/db/client.ts";
import { migrateCatalogDatabase, migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { createRandom } from "./platform/ports/random.ts";
import { createEventLoopLagMonitor } from "./platform/event-loop-lag.ts";
import { setSetting } from "./platform/settings/index.ts";
import { createBackupMonitor } from "./platform/ports/backup.ts";
import { installProcessGuards } from "./platform/process-guard.ts";
import {
  recoverBootRunningJobs,
  recoverStaleLocks,
  registerEnqueueNotify,
} from "./platform/jobs/queue.ts";
import { RetryLaterError } from "./platform/jobs/retry.ts";
import {
  ensureRetentionQueued,
  RETENTION_JOB_KIND,
  retentionJobHandler,
} from "./platform/jobs/retention.ts";
import { startJobWorker } from "./platform/jobs/scheduler.ts";
import { startTelemetry, trace } from "./platform/telemetry/otel.ts";
import { createDiskObjectStore } from "./platform/ports/object-store.ts";
import { createR2ObjectStore } from "./platform/ports/r2-object-store.ts";
import {
  BACKFILL_JOB_KIND,
  SINGLETON_JOB_KINDS,
  SWEEP_JOB_KIND,
  ensureSweepQueued,
  runBackfillJob,
  runSweepJob,
} from "./catalog/discovery.ts";
import {
  WORKABLE_INGEST_JOB_KIND,
  ensureWorkableIngestQueued,
  runWorkableIngestJob,
} from "./catalog/workable-job.ts";
import { createCatalogSweepWorker } from "./catalog/sweep-worker-runner.ts";
import { companyBoards } from "./platform/db/catalog-schema.ts";
import {
  TAG_FALLBACK_JOB_KIND,
  ensureTagFallbackQueued,
  runTagFallbackJob,
} from "./catalog/llm-tagging.ts";
import {
  createAnthropicLlmPort,
  createAnthropicBatchProvider,
} from "./platform/llm/anthropic-batches.ts";
import {
  LLM_BATCH_POLL_JOB_KIND,
  createDurableBatches,
  parseLlmBatchPollPayload,
} from "./platform/llm/durable-batches.ts";
import { createDegradedFlag } from "./platform/degraded.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { createGreenhouseQuestionSource } from "./catalog/greenhouse-questions.ts";
import { createPreparationService } from "./pipeline/prepare.ts";
import {
  PREP_DAILY_JOB_KIND,
  ensurePrepNextQueued,
  ensurePrepQueuedForRunningUsers,
  parsePrepDailyPayload,
  runPrepDailyJob,
} from "./pipeline/daily-prep.ts";
import { createPlainFormReader } from "./pipeline/form-read.ts";
import {
  READY_NOTIFY_JOB_KIND,
  parseReadyNotifyPayload,
  runReadyNotifyJob,
} from "./notify/ready-recap.ts";
import {
  PUSH_NOTIFY_JOB_KIND,
  parsePushNotifyPayload,
  runNotificationPushJob,
} from "./notify/push.ts";
import {
  APPLY_FAILURES_JOB_KIND,
  ensureApplyFailuresQueued,
  runApplyFailures,
} from "./notify/failure-digest.ts";
import {
  BILLING_NOTICE_JOB_KIND,
  parseBillingNoticePayload,
  runBillingNoticeJob,
} from "./notify/billing-notice.ts";
import { createPushSender } from "./platform/push/index.ts";
import { createReviewService } from "./pipeline/reviews.ts";
import { createResumeService } from "./profile/resume.ts";
import { createBrowserProvider } from "./dispatch/browser/index.ts";
import { captureFixtures } from "./fixtures/capture.ts";
import {
  APPLICATION_SEND_JOB_KIND,
  DISPATCH_RECOVER_JOB_KIND,
  createDispatcher,
} from "./dispatch/executor.ts";
import {
  PLANNER_DAY_JOB_KIND,
  createPlanner,
  ensurePlannerQueuedForRunningUsers,
  enqueuePlannerDay,
  parsePlannerDayPayload,
} from "./dispatch/planner.ts";
import {
  DISPATCH_TICK_JOB_KIND,
  TICK_INTERVAL_MS,
  createDispatcherTick,
} from "./dispatch/dispatch.ts";
import { createPostingLiveness } from "./dispatch/liveness.ts";
import {
  DISPATCH_WATCH_JOB_KIND,
  ensureWatchQueued,
  runKillSwitchWatch,
} from "./dispatch/kill-switches.ts";
import { createOutcomes } from "./dispatch/outcomes.ts";
import {
  APPLICATION_PREPARE_JOB_KIND,
  parseApplicationPreparePayload,
} from "./pipeline/prepare-jobs.ts";
import { createMailDnsResolver } from "./inbox/dns.ts";
import { liveCheckAddress } from "../shared/inbound-mail.ts";
import {
  LIVE_CHECK_JOB_KIND,
  LIVE_CHECK_MAIL_JOB_KIND,
  ensureLiveCheckQueued,
  runLiveCheckMailJob,
  runLiveChecks,
  scheduleDailyLiveCheck,
} from "./live-checks/job.ts";
import {
  CHECKIN_SWEEP_JOB_KIND,
  ensureCheckinSweepQueued,
  runCheckinSweep,
} from "./pipeline/checkins.ts";
import { createMailIngest, MAIL_INGEST_JOB_KIND } from "./inbox/ingest.ts";
import { createInterviewCalendar } from "./inbox/interviews.ts";
import { createMailMoves, MAIL_CLASSIFY_JOB_KIND } from "./inbox/moves.ts";
import { createMailboxService } from "./inbox/mailboxes.ts";
import { FIXTURE_CAPTURE_JOB_KIND, runFixtureCaptureJob } from "./fixtures/job.ts";
import { LAB_JOB_KIND, runLabJob } from "./lab/job.ts";
import {
  PERSONIO_PROBE_JOB_KIND,
  runPersonioProbe,
  personioProbePayloadSchema,
} from "./probe/personio.ts";
import { ACCOUNT_ERASE_JOB_KIND, createAccountEraser } from "./account/erase.ts";
import { ACCOUNT_DELETED_NOTICE_JOB_KIND, createDeletionNoticeCrypto } from "./account/notice.ts";
import {
  EXPORT_BUILD_JOB_KIND,
  EXPORT_EXPIRE_JOB_KIND,
  EXPORT_NOTIFY_JOB_KIND,
  createExportService,
  parseExportPayload,
} from "./export/service.ts";

import type { JobHandlers } from "./platform/jobs/run-due.ts";

if (env.LITESTREAM_RESTORE_ONLY) {
  throw new Error(
    "LITESTREAM_RESTORE_ONLY restores a database for a restore drill; the app server must never run in that mode (issue #412). Run scripts/check-restored-db.ts against the restored file instead.",
  );
}

const sdk = startTelemetry({
  serviceName: "overture",
  ...(env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined && {
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  ...(env.OTEL_EXPORTER_OTLP_HEADERS !== undefined && {
    otlpHeaders: env.OTEL_EXPORTER_OTLP_HEADERS,
  }),
  debug: env.OTEL_DEBUG,
  simpleExport: env.OTEL_SIMPLE_EXPORT,
});

const { db, sqlite: appSqlite } = openDatabase(databasePath);
const { db: catalogDb, sqlite: catalogSqlite } = openCatalogDatabase(catalogDatabasePath);

createEventLoopLagMonitor({
  onLag: (lagMs) => {
    logError(
      "event-loop-lag",
      new Error(`the event loop was blocked for ${String(Math.round(lagMs))} ms`),
    );
  },
}).start();

migrateDatabase(db, "drizzle");

migrateCatalogDatabase(catalogDb, "drizzle-catalog");

assertMasterKeyCoverage(db, masterKeyring);

const retirementWarning = masterKeyRetirementWarning(db, masterKeyring);

if (retirementWarning !== undefined) {
  logInfo("master_key.retirement", retirementWarning);
}

const catalogBoards = catalogDb
  .select({ one: sql`1` })
  .from(companyBoards)
  .limit(1)
  .get();

logInfo(
  "db",
  catalogBoards === undefined
    ? `application database ${databasePath}; catalog database ${catalogDatabasePath} is empty and rebuilds from the seed and feeds`
    : `application database ${databasePath}; catalog database ${catalogDatabasePath}`,
);

if (env.NODE_ENV !== "production") {
  const { installOutboundGuard } = await import("./platform/outbound-guard.ts");

  installOutboundGuard(env.NODE_ENV);
}

if (env.ENABLE_TEST_ROUTES) {
  const { startInterception } = await import("./testing/interception.ts");

  startInterception();
}

const clock = createClock();
const random = createRandom();

installProcessGuards(db, clock);

const shutdownController = new AbortController();
const backups = createBackupMonitor(db, clock);

void backups.run(shutdownController.signal);

const mailSender = createDemoSafeMailSender(db, createMailSender(db, clock));
const payments = createPayments(clock);

const spendGate = createSpendGate({
  db,
  clock,
  gated: payments !== null || env.PUBLIC_SIGNUP_ENABLED,
});

if (env.PUBLIC_SIGNUP_ENABLED) {
  logInfo(
    "auth",
    payments === null
      ? "public sign-up is on without billing: no account can prepare Applications until it has a grant"
      : "public sign-up is on; paid work needs a trial card or a plan",
  );
} else {
  logInfo(
    "auth",
    "public sign-up is off: only the owner, invited or previously verified users may sign in, plus the demo account when demo login is on",
  );
}

const pushSender = createPushSender(env, clock);
const mailboxes = createMailboxService(db, clock, env.INBOUND_HMAC_SECRET ?? "", env.MAIL_DOMAIN);

const objects =
  env.R2_ACCOUNT_ID !== undefined &&
  env.R2_ACCESS_KEY_ID !== undefined &&
  env.R2_SECRET_ACCESS_KEY !== undefined &&
  env.R2_BUCKET_FILES !== undefined
    ? createR2ObjectStore({
        endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        bucket: env.R2_BUCKET_FILES,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      })
    : createDiskObjectStore(env.OBJECT_STORE_ROOT);

const degradedFlag = createDegradedFlag({ clock, objects });

const authOptions: AuthOptions = {};

if (env.INBOUND_HMAC_SECRET !== undefined) {
  authOptions.onUserCreated = async (user) => {
    await mailboxes.ensureFor(user.id);
  };
}

if (env.DEMO_LOGIN_ENABLED) {
  authOptions.ensureDemoUser = async () => {
    const seeded = await seedDemoAccount({
      catalogDb,
      clock,
      db,
      objects,
      personal,
    });

    return seeded.userId;
  };
}

const auth = createAuth(db, clock, mailSender, authOptions);

const appOrigin = env.APP_ORIGIN ?? "http://localhost:3000";

const jobSingletons = [
  ...SINGLETON_JOB_KINDS,
  CHECKIN_SWEEP_JOB_KIND,
  DISPATCH_TICK_JOB_KIND,
  GRANT_EXPIRY_JOB_KIND,
  BILLING_RECONCILE_JOB_KIND,
  LIVE_CHECK_JOB_KIND,
  WORKABLE_INGEST_JOB_KIND,
  RETENTION_JOB_KIND,
  EXPORT_BUILD_JOB_KIND,
  APPLY_FAILURES_JOB_KIND,
  MASTER_KEY_ROTATION_JOB_KIND,
];

recoverStaleLocks(db, clock, jobSingletons);

if (env.ENABLE_TEST_ROUTES) {
  setSetting(
    db,
    clock,
    "limits.send_window",
    JSON.stringify({ end: "24:00", start: "00:00" }),
    "system:test",
  );
}

recoverBootRunningJobs(db, clock);

ensureCheckinSweepQueued(db, clock);

ensureGrantExpiryQueued(db, clock);

if (payments !== null) {
  ensureReconcileQueued(db, clock);
}

ensureRetentionQueued(db, clock);

ensureApplyFailuresQueued(db, clock);

const tracer = trace.getTracer("overture");

const otelPayloadSchema = z.record(z.string(), z.string());

const catalogDeps = { db, catalogDb, clock };

const catalogWorker = createCatalogSweepWorker({ db, clock });

const catalogJobHandlers: JobHandlers = {
  [BACKFILL_JOB_KIND]: async () => {
    await runBackfillJob(catalogWorker, catalogDeps);
  },
  [SWEEP_JOB_KIND]: async () => {
    await runSweepJob(catalogWorker, catalogDeps);
  },
  [WORKABLE_INGEST_JOB_KIND]: async () => {
    await runWorkableIngestJob(catalogWorker, catalogDeps);
  },
};

const anthropicBatches = createDurableBatches({
  db,
  clock,
  model: env.ANTHROPIC_MODEL,
  provider: createAnthropicBatchProvider({
    baseUrl: env.ANTHROPIC_BASE_URL,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
  }),
  pollIntervalMs: env.ANTHROPIC_BATCH_POLL_INTERVAL_MS,
  maxWaitMs: env.ANTHROPIC_BATCH_WAIT_MS,
});

const anthropicLlmPort = createAnthropicLlmPort(
  {
    baseUrl: env.ANTHROPIC_BASE_URL,
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
  },
  anthropicBatches,
);

const tagDeps = {
  db,
  catalogDb,
  clock,
  llm: anthropicLlmPort,
};

const personal = createPersonalCrypto(db, masterKeyring);

if (env.DEMO_LOGIN_ENABLED) {
  const demo = await seedDemoAccount({ catalogDb, clock, db, objects, personal });

  logInfo("demo", demoStartupNotice(db, env.NODE_ENV));
  logInfo("demo", `account ready: ${demo.userId}`);
}

const planner = createPlanner({ clock, db, random });

const preparation = createPreparationService({
  db,
  catalogDb,
  clock,
  llm: anthropicLlmPort,
  personal,
  spendGate,
  source: createGreenhouseQuestionSource(env.GREENHOUSE_FEED_BASE_URL),
  greenhouseBoardOrigin: env.GREENHOUSE_BOARD_BASE_URL,
  plainFormReader: createPlainFormReader({
    ashbyBaseUrl: env.ASHBY_JOBS_BASE_URL,
    environment: env.NODE_ENV,
    leverBaseUrl: env.LEVER_JOBS_BASE_URL,
    leverEuBaseUrl: env.LEVER_EU_JOBS_BASE_URL,
    workableBaseUrl: env.WORKABLE_FORM_BASE_URL,
  }),
  captureForm: async (input) => {
    if (browserProviders === null) {
      return null;
    }

    try {
      const [captured] = await captureFixtures(
        {
          clock,
          gotoTimeoutMs: env.BROWSER_NAVIGATION_TIMEOUT_MS,
          objects,
          providers: browserProviders,
        },
        { applyUrls: [input.applyUrl ?? input.url], ats: input.ats },
      );

      return captured ?? null;
    } catch {
      return null;
    }
  },
  onReady: (_applicationId, userId) => {
    enqueuePlannerDay(db, clock, userId);
  },
});

const reviews = createReviewService({ db, catalogDb, clock, personal, preparation });

const preparationJobHandlers: JobHandlers = {
  [APPLICATION_PREPARE_JOB_KIND]: async (payload) => {
    await preparation.prepare(parseApplicationPreparePayload(payload).applicationId);
  },
};

const llmJobHandlers: JobHandlers =
  env.ANTHROPIC_API_KEY === undefined
    ? {}
    : {
        [TAG_FALLBACK_JOB_KIND]: async () => {
          await runTagFallbackJob(tagDeps);
        },
        [LLM_BATCH_POLL_JOB_KIND]: async (payload) => {
          const { batchRecordId } = parseLlmBatchPollPayload(payload);
          const outcome = await anthropicBatches.pollOnce(batchRecordId);

          if (outcome.kind === "wait") {
            throw new RetryLaterError("the Anthropic batch is still processing", outcome.delayMs);
          }
        },
      };

const prepDailyJobHandlers: JobHandlers = {
  [PREP_DAILY_JOB_KIND]: async (payload) => {
    const { since, userId } = parsePrepDailyPayload(payload);

    if (isDemoUser(db, userId)) {
      return;
    }

    try {
      if (env.ANTHROPIC_API_KEY === undefined) {
        return;
      }

      await runPrepDailyJob(
        {
          catalogDb,
          clock,
          db,
          llm: anthropicLlmPort,
          personal,
          preparation,
          spendGate,
        },
        userId,
        since ?? clock.now(),
      );
    } finally {
      ensurePrepNextQueued(db, clock, userId);
    }
  },
};

const readyNotifyJobHandlers: JobHandlers = {
  [READY_NOTIFY_JOB_KIND]: async (payload) => {
    const { since, userId } = parseReadyNotifyPayload(payload);

    await runReadyNotifyJob({ appOrigin, clock, db, mail: mailSender }, userId, since);
  },
};

const pushNotifyJobHandlers: JobHandlers = {
  [PUSH_NOTIFY_JOB_KIND]: async (payload) => {
    const { notificationId } = parsePushNotifyPayload(payload);

    await runNotificationPushJob({ clock, db, push: pushSender }, notificationId);
  },
  [APPLY_FAILURES_JOB_KIND]: async () => {
    try {
      await runApplyFailures({ clock, db });
    } finally {
      ensureApplyFailuresQueued(db, clock);
    }
  },
};

const billingNoticeJobHandlers: JobHandlers = {
  [BILLING_NOTICE_JOB_KIND]: async (payload) => {
    await runBillingNoticeJob(
      { appOrigin, clock, db, mail: mailSender },
      parseBillingNoticePayload(payload),
    );
  },
};

const retriedTestJobs = new Set<string>();

const testJobHandlers: JobHandlers = env.ENABLE_TEST_ROUTES
  ? {
      "test.ping": async (payload) => {
        await Promise.resolve(payload);
      },
      "test.retryable": async (payload) => {
        if (!retriedTestJobs.has(payload)) {
          retriedTestJobs.add(payload);

          throw new Error("the test job failed once");
        }

        await Promise.resolve(payload);
      },
      "test.otel": async (payload) => {
        const span = tracer.startSpan("test.otel.run");

        try {
          const attrs = otelPayloadSchema.parse(JSON.parse(payload));

          for (const [k, v] of Object.entries(attrs)) {
            span.setAttribute(k, v);
          }

          await Promise.resolve();
        } finally {
          span.end();
        }
      },
      "test.blocking": async (payload) => {
        const { waitForBlockingRelease } = await import("./testing/blocking-job.ts");

        await waitForBlockingRelease(payload);
      },
    }
  : {};

const resumes = createResumeService({
  db,
  clock,
  llm: anthropicLlmPort,
  objects,
  personal,
  spendGate,
});

const exports = createExportService({
  appOrigin,
  clock,
  db,
  mail: mailSender,
  mailDomain: env.MAIL_DOMAIN,
  objects,
  personal,
});

const exportJobHandlers: JobHandlers = {
  [EXPORT_BUILD_JOB_KIND]: async (payload) => {
    await exports.build(parseExportPayload(payload).exportId);
  },
  [EXPORT_EXPIRE_JOB_KIND]: async (payload) => {
    const parsed = parseExportPayload(payload);

    await exports.expire(parsed.exportId, parsed.objectKey);
  },
  [EXPORT_NOTIFY_JOB_KIND]: async (payload) => {
    await exports.notify(parseExportPayload(payload).exportId);
  },
};

const outcomes = createOutcomes({ db, clock, personal });

const mailMoves = createMailMoves({
  clock,
  db,
  degraded: degradedFlag,
  llm: anthropicLlmPort,
  personal,
  spendGate,
});

const resolver = createMailDnsResolver(env.INBOUND_DNS_SERVER);

const interviewCalendar = createInterviewCalendar({
  clock,
  db,
  objects,
  personal,
});

const mailIngest = createMailIngest({
  db,
  clock,
  objects,
  personal,
  resolver,
  mailboxes,
  onAuthenticatedMessage: async (input) => {
    await outcomes.confirmMessage(input);
    await mailMoves.handleAuthenticatedMessage(input);

    try {
      await interviewCalendar.recordForMessage(input);
    } catch (error) {
      logError("interview_calendar", error);
    }
  },
  onStoredMessage: async (input) => {
    await mailMoves.linkMessage(input);
  },
});

const mailJobHandlers: JobHandlers = {
  [MAIL_CLASSIFY_JOB_KIND]: async (payload) => {
    await mailMoves.runClassification(payload);
  },
  [MAIL_INGEST_JOB_KIND]: async (payload) => {
    await mailIngest.run(payload);
  },
};

const browserProviders = createBrowserProvider(env, clock, db);

const noticeCrypto = createDeletionNoticeCrypto(masterKeyring);

const eraser = createAccountEraser({
  clock,
  db,
  mailboxes,
  objects,
  personal,
  providers: browserProviders,
  sealNotice: async (notice) => {
    const payload = await noticeCrypto.seal(notice);

    return payload;
  },
});

const accountJobHandlers: JobHandlers = {
  [ACCOUNT_ERASE_JOB_KIND]: async (payload) => {
    await eraser.run(payload);
  },
  [ACCOUNT_DELETED_NOTICE_JOB_KIND]: async (payload) => {
    const notice = await noticeCrypto.open(payload);

    try {
      await mailSender.sendAccountDeleted(notice);
    } catch (error) {
      if (!(error instanceof MailCapExceededError)) {
        throw error;
      }

      logInfo("account.notice", `deleted-account notice refused: ${error.message}`);
    }
  },
};

const activeDispatcher =
  browserProviders === null
    ? null
    : createDispatcher({
        db,
        clock,
        hardTimeoutMs: env.SEND_HARD_TIMEOUT_MS,
        mailboxes,
        outcomes,
        personal,
        preparation,
        providers: browserProviders,
        proxyCountry: env.BROWSER_PROXY_COUNTRY,
        resumes,
        signal: shutdownController.signal,
      });

const dispatchTick =
  activeDispatcher === null
    ? null
    : createDispatcherTick({
        catalogDb,
        clock,
        db,
        enqueueSend: (applicationId) => activeDispatcher.enqueueSend(applicationId),
        liveness: createPostingLiveness(env),
        personal,
        providerId: browserProviders === null ? "local" : browserProviders.pick().id,
      });

const dispatchJobHandlers: JobHandlers =
  activeDispatcher === null || dispatchTick === null
    ? {}
    : {
        [APPLICATION_SEND_JOB_KIND]: async (payload) => {
          const { applicationId } = z
            .object({ applicationId: z.string().min(1) })
            .parse(JSON.parse(payload));

          await activeDispatcher.sendNow(applicationId);
        },
        [DISPATCH_RECOVER_JOB_KIND]: async () => {
          await activeDispatcher.recover();
          activeDispatcher.ensureRecoveryQueued();
        },
        [DISPATCH_TICK_JOB_KIND]: async () => {
          try {
            await dispatchTick.run();
          } finally {
            dispatchTick.ensureQueued(clock.now() + TICK_INTERVAL_MS);
          }
        },
      };

const planningJobHandlers: JobHandlers = {
  [PLANNER_DAY_JOB_KIND]: async (payload) => {
    const { userId } = parsePlannerDayPayload(payload);

    if (isDemoUser(db, userId)) {
      return;
    }

    try {
      planner.plan(userId);
    } finally {
      planner.ensureMidnightQueued(userId);
    }

    await Promise.resolve();
  },
};

const labBase = labBaseUrl;

const labJobHandlers: JobHandlers =
  browserProviders === null || labBase === null
    ? {}
    : {
        [LAB_JOB_KIND]: async (payload) => {
          await runLabJob({ baseUrl: labBase, clock, db, providers: browserProviders }, payload);
        },
      };

const fixtureJobHandlers: JobHandlers =
  browserProviders === null
    ? {}
    : {
        [FIXTURE_CAPTURE_JOB_KIND]: async (payload) => {
          await runFixtureCaptureJob(
            {
              clock,
              gotoTimeoutMs: env.BROWSER_NAVIGATION_TIMEOUT_MS,
              objects,
              providers: browserProviders,
            },
            payload,
          );
        },
      };

const watchJobHandlers: JobHandlers = {
  [DISPATCH_WATCH_JOB_KIND]: async () => {
    await Promise.resolve(runKillSwitchWatch({ db, clock }));
  },
};

const probeJobHandlers: JobHandlers = {
  [PERSONIO_PROBE_JOB_KIND]: async (payload) => {
    const { urls } = personioProbePayloadSchema.parse(JSON.parse(payload));

    await runPersonioProbe({ catalogDb, clock, db, urls });
  },
};

const checkinJobHandlers: JobHandlers = {
  [CHECKIN_SWEEP_JOB_KIND]: async () => {
    try {
      await Promise.resolve(runCheckinSweep({ clock, db }));
    } finally {
      ensureCheckinSweepQueued(db, clock);
    }
  },
};

const liveCheckAddressValue = liveCheckAddress(env.MAIL_DOMAIN);

const liveCheckDeps = {
  backups,
  catalogDb,
  clock,
  databasePath,
  db,
  degraded: degradedFlag,
  llm: anthropicLlmPort,
  mail: mailSender,
  mailAddress: liveCheckAddressValue,
  emailSending: { required: env.REQUIRE_EMAIL_SENDING, config: emailSendingConfigFromEnv() },
  objects,
  providers: browserProviders,
};

const liveCheckJobHandlers: JobHandlers = {
  [LIVE_CHECK_JOB_KIND]: async (payload) => {
    try {
      await runLiveChecks(liveCheckDeps, payload);
    } finally {
      scheduleDailyLiveCheck(db, clock);
    }
  },
  [LIVE_CHECK_MAIL_JOB_KIND]: async (payload) => {
    await runLiveCheckMailJob(liveCheckDeps, payload);
  },
};

const retentionJobHandlers: JobHandlers = {
  [RETENTION_JOB_KIND]: async () => {
    await retentionJobHandler(db, catalogDb, clock);
  },
};

const masterKeyRotationJobHandlers: JobHandlers = {
  [MASTER_KEY_ROTATION_JOB_KIND]: async (payload: string) => {
    const { dryRun } = masterKeyRotationPayloadSchema.parse(JSON.parse(payload));

    const summary = await runMasterKeyRotation({
      db,
      clock,
      dryRun,
      keyring: masterKeyring,
      maxBatches: MASTER_KEY_ROTATION_JOB_BATCHES,
      onRotated: (userId) => personal.forget(userId),
    });

    if (!dryRun && summary.remaining > 0) {
      enqueueMasterKeyRotation(db, clock, { dryRun: false });
    }

    const warning = masterKeyRetirementWarning(db, masterKeyring);

    if (!dryRun && warning !== undefined) {
      logInfo("master_key.retirement", warning);
    }
  },
};

const reconcileJobHandlers: JobHandlers =
  payments === null
    ? {}
    : {
        [BILLING_RECONCILE_JOB_KIND]: async (payload: string) => {
          await billingReconcileJobHandler({ clock, db, payments }, payload);
        },
      };

const billingJobHandlers: JobHandlers = {
  [GRANT_EXPIRY_JOB_KIND]: async () => {
    try {
      await Promise.resolve(runGrantExpirySweep({ clock, db }));
    } finally {
      ensureGrantExpiryQueued(db, clock);
    }
  },
  ...reconcileJobHandlers,
};

const allJobHandlers: JobHandlers = {
  ...retentionJobHandlers,
  ...billingJobHandlers,
  ...catalogJobHandlers,
  ...preparationJobHandlers,
  ...planningJobHandlers,
  ...llmJobHandlers,
  ...prepDailyJobHandlers,
  ...readyNotifyJobHandlers,
  ...pushNotifyJobHandlers,
  ...billingNoticeJobHandlers,
  ...mailJobHandlers,
  ...dispatchJobHandlers,
  ...fixtureJobHandlers,
  ...labJobHandlers,
  ...watchJobHandlers,
  ...probeJobHandlers,
  ...checkinJobHandlers,
  ...liveCheckJobHandlers,
  ...accountJobHandlers,
  ...exportJobHandlers,
  ...masterKeyRotationJobHandlers,
  ...testJobHandlers,
};

const worker = env.JOBS_AUTORUN
  ? startJobWorker(
      db,
      clock,
      allJobHandlers,
      shutdownController.signal,
      (notify) => {
        registerEnqueueNotify(notify);
      },
      jobSingletons,
      { startupSettleMs: env.JOBS_STARTUP_SETTLE_MS },
    )
  : null;

if (activeDispatcher !== null) {
  await activeDispatcher.recover();
  activeDispatcher.ensureRecoveryQueued();
  ensureWatchQueued(db, clock);
}

if (dispatchTick !== null) {
  dispatchTick.ensureQueued();
}

ensurePlannerQueuedForRunningUsers(db, clock);

ensureSweepQueued(catalogDeps);

if (env.NODE_ENV === "production") {
  ensureLiveCheckQueued(db, clock);
  ensureWorkableIngestQueued(db, clock);
}

if (env.ANTHROPIC_API_KEY !== undefined) {
  ensureTagFallbackQueued(db, clock);
  ensurePrepQueuedForRunningUsers(db, clock);
}

function requestWithAbsoluteUrl(request: Request) {
  if (URL.canParse(request.url)) {
    return request;
  }

  const path = request.url.startsWith("/") ? request.url : `/${request.url}`;

  return new Request(`http://localhost${path}`, request);
}

const app = createApp({
  db,
  catalogDb,
  clock,
  databasePath,
  degraded: degradedFlag,
  staticRoot: env.STATIC_ROOT,
  testRoutes: env.ENABLE_TEST_ROUTES,
  jobHandlers: allJobHandlers,
  auth,
  objects,
  llm: anthropicLlmPort,
  spendGate,
  mailboxes,
  resolver,
  liveCheckAddress: liveCheckAddressValue,
  preparation,
  reviews,
  singletonJobKinds: jobSingletons,
  backups,
  providers: browserProviders,
  catalogWorker,
  eraser,
  exports,
  mail: mailSender,
  payments,
  personal,
  shutdown: shutdownController.signal,
});

const SERVER_IDLE_TIMEOUT_ABOVE_SSE_HEARTBEAT_SECONDS = 60;
const SHUTDOWN_QUIET_GRACE_MS = 2000;
const SHUTDOWN_HARD_EXIT_GRACE_MS = 1000;

const server = Bun.serve({
  port: env.PORT,
  fetch: async (request) => app.fetch(requestWithAbsoluteUrl(request)),
  idleTimeout: SERVER_IDLE_TIMEOUT_ABOVE_SSE_HEARTBEAT_SECONDS,
});

process.stdout.write(`overture listening on ${String(server.port)}\n`);

let shuttingDown = false;

async function stopTelemetry() {
  try {
    await sdk.shutdown();
  } catch {}
}

async function quietGrace(budgetMs: number) {
  const graceMs = Math.min(SHUTDOWN_QUIET_GRACE_MS, Math.max(50, Math.floor(budgetMs / 4)));

  await new Promise<void>((resolve) => {
    setTimeout(resolve, graceMs).unref();
  });
}

function handleShutdown(signal: string) {
  if (shuttingDown) {
    logInfo("shutdown", `${signal}: already stopping`);

    return;
  }

  shuttingDown = true;

  const startedAt = performance.now();
  const budgetMs = env.KILL_TIMEOUT_MS;

  logInfo("shutdown", `${signal}: draining with a ${String(budgetMs)} ms budget`);

  shutdownController.abort();

  const hardExitTimer = setTimeout(() => {
    logError("shutdown", new Error(`still running after ${String(budgetMs)} ms; forcing exit`));
    process.kill(process.pid, "SIGKILL");
  }, budgetMs + SHUTDOWN_HARD_EXIT_GRACE_MS);

  hardExitTimer.unref();

  void (async () => {
    try {
      await Promise.race([server.stop(false), quietGrace(budgetMs)]);
      await server.stop(true);
      await worker?.drain(Math.max(0, budgetMs - (performance.now() - startedAt)));
      catalogWorker.stop();
    } catch (error) {
      logError("shutdown", error);
    } finally {
      await Promise.race([stopTelemetry(), quietGrace(budgetMs)]);

      try {
        appSqlite.close();
      } catch (error) {
        logError("shutdown", error);
      }

      try {
        catalogSqlite.close();
      } catch (error) {
        logError("shutdown", error);
      }

      clearTimeout(hardExitTimer);
      logInfo("shutdown", `stopped in ${String(Math.round(performance.now() - startedAt))} ms`);
      process.exit(0);
    }
  })();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handleShutdown(signal);
  });
}
