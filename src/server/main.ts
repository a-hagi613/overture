import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { openDatabase } from "./platform/db/client.ts";
import { migrateDatabase } from "./platform/db/migrate.ts";
import { createClock } from "./platform/ports/clock.ts";
import { recoverStaleLocks } from "./platform/jobs/queue.ts";

import type { JobHandlers } from "./platform/jobs/run-due.ts";

const { db } = openDatabase(env.DATABASE_URL);

migrateDatabase(db, "drizzle");

if (env.ENABLE_TEST_ROUTES) {
  const { startInterception } = await import("./testing/interception.ts");

  startInterception();
}

const clock = createClock();
const shutdownController = new AbortController();

recoverStaleLocks(db, clock);

const testJobHandlers: JobHandlers = env.ENABLE_TEST_ROUTES
  ? {
      "test.ping": async (payload) => {
        await Promise.resolve(payload);
      },
    }
  : {};

const app = createApp({
  db,
  clock,
  staticRoot: env.STATIC_ROOT,
  testRoutes: env.ENABLE_TEST_ROUTES,
  jobHandlers: testJobHandlers,
});

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

process.stdout.write(`overture listening on ${String(server.port)}\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdownController.abort();
    void server.stop(true);
  });
}
