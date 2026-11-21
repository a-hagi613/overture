import { z } from "zod";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import { databasePath, env } from "./config/env.ts";
import { createMailSender, emailSendingConfigFromEnv } from "./platform/mail/index.ts";
import { openDatabase } from "./platform/db/client.ts";
import { migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { createRandom } from "./platform/ports/random.ts";
import { createBackupMonitor } from "./platform/ports/backup.ts";
import { installProcessGuards } from "./platform/process-guard.ts";
import { recoverStaleLocks, registerEnqueueNotify } from "./platform/jobs/queue.ts";
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
import { createCatalogSweepWorker } from "./catalog/sweep-worker-runner.ts";
import {
  TAG_FALLBACK_JOB_KIND,
  ensureTagFallbackQueued,
  runTagFallbackJob,
} from "./catalog/llm-tagging.ts";
import { createAnthropicLlmPort } from "./platform/llm/anthropic-batches.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { parseMasterKey } from "./platform/crypto.ts";
import { createGreenhouseQuestionSource } from "./catalog/greenhouse-questions.ts";
import { createPreparationService } from "./pipeline/prepare.ts";
import {
  PREP_DAILY_JOB_KIND,
  ensurePrepDailyQueued,
  ensurePrepQueuedForRunningUsers,
  parsePrepDailyPayload,
  runPrepDailyJob,
} from "./pipeline/daily-prep.ts";
import { createPlainFormReader } from "./pipeline/form-read.ts";
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
import { createMailIngest, MAIL_INGEST_JOB_KIND } from "./inbox/ingest.ts";
import { createMailboxService } from "./inbox/mailboxes.ts";
import { FIXTURE_CAPTURE_JOB_KIND, runFixtureCaptureJob } from "./fixtures/job.ts";

import type { JobHandlers } from "./platform/jobs/run-due.ts";

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

migrateDatabase(db, "drizzle");

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

const mailSender = createMailSender(clock);
const mailboxes = createMailboxService(db, clock, env.INBOUND_HMAC_SECRET ?? "", env.MAIL_DOMAIN);

const auth = createAuth(
  db,
  clock,
  mailSender,
  env.INBOUND_HMAC_SECRET === undefined
    ? {}
    : {
        onUserCreated: async (user) => {
          await mailboxes.ensureFor(user.id);
        },
      },
);

const appOrigin = env.APP_ORIGIN ?? "http://localhost:3000";

const jobSingletons = [...SINGLETON_JOB_KINDS, DISPATCH_TICK_JOB_KIND, LIVE_CHECK_JOB_KIND];

recoverStaleLocks(db, clock, jobSingletons);

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

const planner = createPlanner({ clock, db, random });

const preparation = createPreparationService({
  db,
  clock,
  llm: anthropicLlmPort,
  personal,
  source: createGreenhouseQuestionSource(env.GREENHOUSE_FEED_BASE_URL),
  greenhouseBoardOrigin: env.GREENHOUSE_BOARD_BASE_URL,
  plainFormReader: createPlainFormReader({
    ashbyBaseUrl: env.ASHBY_JOBS_BASE_URL,
    leverBaseUrl: env.LEVER_JOBS_BASE_URL,
    leverEuBaseUrl: env.LEVER_EU_JOBS_BASE_URL,
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

    try {
      if (env.ANTHROPIC_API_KEY === undefined) {
        return;
      }

      await runPrepDailyJob(
        {
          appOrigin,
          clock,
          db,
          llm: anthropicLlmPort,
          mail: mailSender,
          personal,
          preparation,
        },
        userId,
        since ?? clock.now(),
      );
    } finally {
      ensurePrepDailyQueued(db, clock, userId);
    }
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

const mailPersonal = createPersonalCrypto(
  db,
  parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
  env.MASTER_KEY_CURRENT,
);

const resumes = createResumeService({ db, clock, llm: anthropicLlmPort, objects, personal });

const outcomes = createOutcomes({ db, clock, personal, preparation });

const resolver = createMailDnsResolver(env.INBOUND_DNS_SERVER);

const mailIngest = createMailIngest({
  db,
  clock,
  objects,
  personal: mailPersonal,
  resolver,
  mailboxes,
  onAuthenticatedMessage: async (input) => {
    await outcomes.confirmMessage(input);
  },
});

const mailJobHandlers: JobHandlers = {
  [MAIL_INGEST_JOB_KIND]: async (payload) => {
    await mailIngest.run(payload);
  },
};

const browserProviders = createBrowserProvider(env, clock, db);

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

    try {
      planner.plan(userId);
    } finally {
      planner.ensureMidnightQueued(userId);
    }

    await Promise.resolve();
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

const liveCheckAddressValue = liveCheckAddress(env.MAIL_DOMAIN);

const liveCheckDeps = {
  backups,
  clock,
  databasePath,
  db,
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

const allJobHandlers: JobHandlers = {
  ...catalogJobHandlers,
  ...preparationJobHandlers,
  ...planningJobHandlers,
  ...llmJobHandlers,
  ...prepDailyJobHandlers,
  ...mailJobHandlers,
  ...dispatchJobHandlers,
  ...fixtureJobHandlers,
  ...watchJobHandlers,
  ...liveCheckJobHandlers,
  ...testJobHandlers,
};

const worker = startJobWorker(
  db,
  clock,
  allJobHandlers,
  shutdownController.signal,
  (notify) => {
    registerEnqueueNotify(notify);
  },
  jobSingletons,
);

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
  mailboxes,
  resolver,
  liveCheckAddress: liveCheckAddressValue,
  preparation,
  reviews,
  singletonJobKinds: jobSingletons,
  backups,
  providers: browserProviders,
  catalogWorker,
});

const SERVER_IDLE_TIMEOUT_ABOVE_SSE_HEARTBEAT_SECONDS = 60;

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: SERVER_IDLE_TIMEOUT_ABOVE_SSE_HEARTBEAT_SECONDS,
});

process.stdout.write(`overture listening on ${String(server.port)}\n`);

function handleShutdown() {
  shutdownController.abort();

  const killTimer = setTimeout(() => {
    void server.stop(true);
    void sdk.shutdown();
  }, env.KILL_TIMEOUT_MS);

  killTimer.unref();

  void (async () => {
    await server.stop(false);
    await worker.drain(env.KILL_TIMEOUT_MS);
    catalogWorker.stop();

    clearTimeout(killTimer);
    await sdk.shutdown();
  })();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, handleShutdown);
}
