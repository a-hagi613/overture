import { z } from "zod";

import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { openDatabase } from "./platform/db/client.ts";
import { migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { recoverStaleLocks, registerEnqueueNotify } from "./platform/jobs/queue.ts";
import { startJobWorker } from "./platform/jobs/scheduler.ts";
import { startTelemetry, trace } from "./platform/telemetry/otel.ts";

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

const { db } = openDatabase(env.DATABASE_URL);

migrateDatabase(db, "drizzle");

if (env.ENABLE_TEST_ROUTES) {
  const { startInterception } = await import("./testing/interception.ts");

  startInterception();
}

const clock = createClock();
const shutdownController = new AbortController();

recoverStaleLocks(db, clock);

const tracer = trace.getTracer("overture");

const otelPayloadSchema = z.record(z.string(), z.string());

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

const worker = startJobWorker(db, clock, testJobHandlers, shutdownController.signal, (notify) => {
  registerEnqueueNotify(notify);
});

const app = createApp({
  db,
  clock,
  staticRoot: env.STATIC_ROOT,
  testRoutes: env.ENABLE_TEST_ROUTES,
  jobHandlers: testJobHandlers,
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
