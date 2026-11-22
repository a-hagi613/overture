import { z } from "zod";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import type { AuthOptions } from "./auth/index.ts";
import { databasePath, env, labBaseUrl } from "./config/env.ts";
import { createMailSender, emailSendingConfigFromEnv } from "./platform/mail/index.ts";
import { MailCapExceededError } from "./platform/mail/metered.ts";
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
import { openDatabase } from "./platform/db/client.ts";
import { migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { createRandom } from "./platform/ports/random.ts";
import { createEventLoopLagMonitor } from "./platform/event-loop-lag.ts";
import { createBackupMonitor } from "./platform/ports/backup.ts";
import { installProcessGuards } from "./platform/process-guard.ts";
import { recoverStaleLocks, registerEnqueueNotify } from "./platform/jobs/queue.ts";
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
import {
  TAG_FALLBACK_JOB_KIND,
  ensureTagFallbackQueued,
  runTagFallbackJob,
} from "./catalog/llm-tagging.ts";
import { createAnthropicLlmPort } from "./platform/llm/anthropic-batches.ts";
import { createDegradedFlag } from "./platform/degraded.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { parseMasterKey } from "./platform/crypto.ts";
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

const { db } = openDatabase(databasePath);

createEventLoopLagMonitor({
  onLag: (lagMs) => {
    logError(
      "event-loop-lag",
      new Error(`the event loop was blocked for ${String(Math.round(lagMs))} ms`),
    );
  },
}).start();

migrateDatabase(db, "drizzle");

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
];

recoverStaleLocks(db, clock, jobSingletons);

ensureCheckinSweepQueued(db, clock);

ensureGrantExpiryQueued(db, clock);

if (payments !== null) {
  ensureReconcileQueued(db, clock);
}

ensureRetentionQueued(db, clock);

ensureApplyFailuresQueued(db, clock);

const tracer = trace.getTracer("overture");

const otelPayloadSchema = z.record(z.string(), z.string());

const catalogDeps = { db, clock };

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

const anthropicLlmPort = createAnthropicLlmPort({
  baseUrl: env.ANTHROPIC_BASE_URL,
  apiKey: env.ANTHROPIC_API_KEY,
  model: env.ANTHROPIC_MODEL,
});

const tagDeps = {
  db,
  clock,
  llm: anthropicLlmPort,
};

const personal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

if (env.DEMO_LOGIN_ENABLED) {
  const demo = await seedDemoAccount({ clock, db, objects, personal });

  logInfo("demo", demoStartupNotice(db, env.NODE_ENV));
  logInfo("demo", `account ready: ${demo.userId}`);
}

const planner = createPlanner({ clock, db, random });

const preparation = createPreparationService({
  db,
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

const reviews = createReviewService({ db, clock, personal, preparation });

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

const testJobHandlers: JobHandlers = env.ENABLE_TEST_ROUTES
  ? {
      "test.ping": async (payload) => {
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

const mailPersonal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

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
  personal: mailPersonal,
  spendGate,
});

const resolver = createMailDnsResolver(env.INBOUND_DNS_SERVER);

const interviewCalendar = createInterviewCalendar({
  clock,
  db,
  objects,
  personal: mailPersonal,
});

const mailIngest = createMailIngest({
  db,
  clock,
  objects,
  personal: mailPersonal,
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

const noticeCrypto = createDeletionNoticeCrypto(
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
);

const eraser = createAccountEraser({
  clock,
  db,
  mailboxes,
  objects,
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

    await runPersonioProbe({ clock, db, urls });
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
    await retentionJobHandler(db, clock);
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

const app = createApp({
  db,
  clock,
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
  payments,
  shutdown: shutdownController.signal,
});

const SERVER_IDLE_TIMEOUT_ABOVE_SSE_HEARTBEAT_SECONDS = 60;
const SHUTDOWN_QUIET_GRACE_MS = 2000;
const SHUTDOWN_HARD_EXIT_GRACE_MS = 1000;

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
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
      logInfo("shutdown", `stopped in ${String(Math.round(performance.now() - startedAt))} ms`);
    }
  })();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    handleShutdown(signal);
  });
}
