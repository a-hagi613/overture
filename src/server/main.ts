import { z } from "zod";

import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import { databasePath, env } from "./config/env.ts";
import { createMailSender } from "./platform/mail/index.ts";
import { openDatabase } from "./platform/db/client.ts";
import { migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { createBackupMonitor } from "./platform/ports/backup.ts";
import { recoverStaleLocks, registerEnqueueNotify } from "./platform/jobs/queue.ts";
import { startJobWorker } from "./platform/jobs/scheduler.ts";
import { startTelemetry, trace } from "./platform/telemetry/otel.ts";
import { createDiskObjectStore } from "./platform/ports/object-store.ts";
import { createR2ObjectStore } from "./platform/ports/r2-object-store.ts";
import { createGreenhouseFeed } from "./catalog/greenhouse-feed.ts";
import { createLeverFeed } from "./catalog/lever-feed.ts";
import { createAshbyFeed } from "./catalog/ashby-feed.ts";
import type { BoardFeeds } from "./catalog/board-feed.ts";
import {
  BACKFILL_JOB_KIND,
  SINGLETON_JOB_KINDS,
  SWEEP_JOB_KIND,
  ensureSweepQueued,
  runBackfillJob,
  runSweepJob,
} from "./catalog/discovery.ts";
import {
  TAG_FALLBACK_JOB_KIND,
  ensureTagFallbackQueued,
  runTagFallbackJob,
} from "./catalog/llm-tagging.ts";
import { createAnthropicLlmPort } from "./platform/llm/anthropic-batches.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { parseMasterKey } from "./platform/crypto.ts";
import { MATCH_FILL_JOB_KIND, ensureMatchFillQueued, runMatchFillJob } from "./matching/score.ts";

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
const shutdownController = new AbortController();
const backups = createBackupMonitor(db, clock);

void backups.run(shutdownController.signal);

const mailSender = createMailSender(clock);
const auth = createAuth(db, clock, mailSender);

recoverStaleLocks(db, clock, SINGLETON_JOB_KINDS);

const tracer = trace.getTracer("overture");

const otelPayloadSchema = z.record(z.string(), z.string());

const feeds: BoardFeeds = {
  greenhouse: createGreenhouseFeed(env.GREENHOUSE_FEED_BASE_URL),
  lever: createLeverFeed(env.LEVER_FEED_BASE_URL),
  ashby: createAshbyFeed(env.ASHBY_FEED_BASE_URL),
};

const catalogDeps = { db, clock, feeds };

const catalogJobHandlers: JobHandlers = {
  [BACKFILL_JOB_KIND]: async () => {
    await runBackfillJob(catalogDeps);
  },
  [SWEEP_JOB_KIND]: async () => {
    await runSweepJob(catalogDeps);
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

const matchDeps = {
  db,
  clock,
  llm: anthropicLlmPort,
  personal,
};

const llmJobHandlers: JobHandlers =
  env.ANTHROPIC_API_KEY === undefined
    ? {}
    : {
        [TAG_FALLBACK_JOB_KIND]: async () => {
          await runTagFallbackJob(tagDeps);
        },
        [MATCH_FILL_JOB_KIND]: async () => {
          await runMatchFillJob(matchDeps);
          ensureMatchFillQueued(db, clock);
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

const worker = startJobWorker(
  db,
  clock,
  { ...catalogJobHandlers, ...llmJobHandlers, ...testJobHandlers },
  shutdownController.signal,
  (notify) => {
    registerEnqueueNotify(notify);
  },
  SINGLETON_JOB_KINDS,
);

ensureSweepQueued(catalogDeps);

if (env.ANTHROPIC_API_KEY !== undefined) {
  ensureTagFallbackQueued(db, clock);
  ensureMatchFillQueued(db, clock);
}

const app = createApp({
  db,
  clock,
  staticRoot: env.STATIC_ROOT,
  testRoutes: env.ENABLE_TEST_ROUTES,
  jobHandlers: {
    ...catalogJobHandlers,
    ...llmJobHandlers,
    ...testJobHandlers,
  },
  auth,
  objects,
  llm: anthropicLlmPort,
  singletonJobKinds: SINGLETON_JOB_KINDS,
  backups,
});

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

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

    clearTimeout(killTimer);
    await sdk.shutdown();
  })();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, handleShutdown);
}
