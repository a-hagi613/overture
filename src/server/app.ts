import { Hono } from "hono";
import { join, resolve } from "node:path";

import type { AppDatabase } from "./platform/db/client.ts";
import type { JobHandlers } from "./platform/jobs/run-due.ts";
import type { AdjustableClock } from "./platform/ports/clock.ts";

import { createHealthRoutes } from "./routes/health.ts";
import { createTestRoutes } from "./routes/test-only.ts";

export interface AppDependencies {
  db: AppDatabase;
  clock: AdjustableClock;
  staticRoot: string;
  testRoutes: boolean;
  jobHandlers: JobHandlers;
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  app.route("/api", createHealthRoutes(deps.db));

  if (deps.testRoutes) {
    app.route("/__test__", createTestRoutes(deps.db, deps.clock, deps.jobHandlers));
  }

  app.get("*", async (context) => {
    const root = resolve(deps.staticRoot);
    const { pathname } = new URL(context.req.url);
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
    const requested = resolve(root, relativePath);
    const file = Bun.file(requested);

    if (requested.startsWith(`${root}/`) && (await file.exists())) {
      return new Response(file);
    }

    const fallback = Bun.file(join(root, "index.html"));

    if (await fallback.exists()) {
      return new Response(fallback, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return context.notFound();
  });

  return app;
}
