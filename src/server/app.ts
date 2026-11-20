import { Hono } from "hono";
import { join, resolve } from "node:path";

import type { AppDatabase } from "./platform/db/client.ts";
import type { BackupMonitor } from "./platform/ports/backup.ts";
import type { Auth } from "./auth/index.ts";
import type { AdjustableClock } from "./platform/ports/clock.ts";
import type { JobHandlers } from "./platform/jobs/run-due.ts";
import type { LlmPort } from "./platform/ports/llm.ts";
import type { ObjectStore } from "./platform/ports/object-store.ts";
import type { PreparationService } from "./pipeline/prepare.ts";
import type { ReviewService } from "./pipeline/reviews.ts";

import { createHealthRoutes } from "./routes/health.ts";
import { createMeRoutes } from "./routes/me.ts";
import { createApiRoutes } from "./routes/api.ts";
import { createHomeRoutes } from "./routes/home.ts";
import { createMatchingRoutes } from "./routes/matching.ts";
import { createReviewRoutes } from "./routes/reviews.ts";
import { createAdminApi, isAdminHost } from "./routes/admin.ts";
import { createTestRoutes } from "./routes/test-only.ts";
import { env } from "./config/env.ts";
import { createProfileRoutes } from "./routes/profile.ts";
import { createMatchingService } from "./matching/score.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { parseMasterKey } from "./platform/crypto.ts";

export interface AppDependencies {
  db: AppDatabase;
  clock: AdjustableClock;
  backups: BackupMonitor;
  staticRoot: string;
  testRoutes: boolean;
  jobHandlers: JobHandlers;
  auth: Auth;
  objects: ObjectStore;
  llm: LlmPort;
  preparation: PreparationService;
  reviews: ReviewService;
  singletonJobKinds: readonly string[];
}

async function staticResponseFrom(root: string, url: string) {
  const { pathname } = new URL(url);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const resolvedRoot = resolve(root);
  const requested = resolve(resolvedRoot, relativePath);
  const file = Bun.file(requested);

  if (requested.startsWith(`${resolvedRoot}/`) && (await file.exists())) {
    return new Response(file);
  }

  const fallback = Bun.file(join(resolvedRoot, "index.html"));

  if (await fallback.exists()) {
    return new Response(fallback, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return null;
}

export function createApp(deps: AppDependencies) {
  const adminApi = createAdminApi(deps.db, deps.clock, deps.auth);
  const adminHost = new Hono();

  const personal = createPersonalCrypto(
    deps.db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const matching = createMatchingService({
    db: deps.db,
    clock: deps.clock,
    llm: deps.llm,
    personal,
  });

  adminHost.route("/admin/api", adminApi);
  adminHost.all("/api/auth/*", async (context) => deps.auth.handler(context.req.raw));

  const app = new Hono();

  app.all("/api/auth/*", async (context) => deps.auth.handler(context.req.raw));
  app.route("/api", createHealthRoutes(deps.db, deps.backups));
  app.route("/api", createMeRoutes(deps.auth));
  app.route("/api", createApiRoutes(deps.db, deps.clock));
  app.route("/api", createProfileRoutes(deps));
  app.route("/api", createHomeRoutes(deps.db, deps.clock, deps.auth, matching));
  app.route(
    "/api",
    createMatchingRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      matching,
    }),
  );
  app.route(
    "/api",
    createReviewRoutes({
      auth: deps.auth,
      reviews: deps.reviews,
    }),
  );

  if (deps.testRoutes) {
    app.route(
      "/__test__",
      createTestRoutes(deps.db, deps.clock, deps.jobHandlers, deps.singletonJobKinds),
    );
  }

  app.use("*", async (context, next) => {
    const hostHeader = context.req.header("host") ?? "";
    const { hostname } = new URL(`http://${hostHeader}`);

    if (isAdminHost(hostname, env.ADMIN_ORIGIN)) {
      return adminHost.fetch(context.req.raw);
    }

    return next();
  });

  app.get("*", async (context) => {
    const page = await staticResponseFrom(deps.staticRoot, context.req.url);

    return page ?? context.notFound();
  });

  adminHost.get("*", async (context) => {
    const page = await staticResponseFrom(deps.staticRoot, context.req.url);

    return page ?? context.notFound();
  });

  return app;
}
