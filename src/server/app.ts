import { Hono } from "hono";
import type { DNSResolver } from "mailauth";
import { join, resolve } from "node:path";

import type { AppDatabase } from "./platform/db/client.ts";
import type { BackupMonitor } from "./platform/ports/backup.ts";
import type { ClientIpConfig } from "./auth/client-ip.ts";
import type { Auth } from "./auth/index.ts";
import type { AdjustableClock } from "./platform/ports/clock.ts";
import type { JobHandlers } from "./platform/jobs/run-due.ts";
import type { LlmPort } from "./platform/ports/llm.ts";
import type { ObjectStore } from "./platform/ports/object-store.ts";
import type { PreparationService } from "./pipeline/prepare.ts";
import type { ReviewService } from "./pipeline/reviews.ts";
import type { createMailboxService } from "./inbox/mailboxes.ts";
import type { BrowserProviderRegistry } from "./dispatch/browser/provider.ts";
import type { CatalogSweepWorker } from "./catalog/sweep-worker-runner.ts";
import type { AccountEraser } from "./account/erase.ts";
import type { ExportService } from "./export/service.ts";

import { createHealthRoutes } from "./routes/health.ts";
import { createMeRoutes } from "./routes/me.ts";
import { createApiRoutes } from "./routes/api.ts";
import { createNotificationRoutes } from "./routes/notifications.ts";
import { createApplicationRoutes } from "./routes/applications.ts";
import { createHomeRoutes } from "./routes/home.ts";
import { createNavRoutes } from "./routes/nav.ts";
import { createCheckinRoutes } from "./routes/checkins.ts";
import { createCalendarRoutes } from "./routes/calendar.ts";
import { createReadyRoutes } from "./routes/ready.ts";
import { createMatchingRoutes } from "./routes/matching.ts";
import { createReviewRoutes } from "./routes/reviews.ts";
import { createAdminApi, isAdminHost } from "./routes/admin.ts";
import { createTestRoutes } from "./routes/test-only.ts";
import { stripUntrustedIpHeaders } from "./auth/client-ip.ts";
import { env } from "./config/env.ts";
import { demoLocked } from "./demo/guard.ts";
import { createProfileRoutes } from "./routes/profile.ts";
import { createOnboardingRoutes } from "./routes/onboarding.ts";
import { createConsentRoutes } from "./routes/consent.ts";
import { createConsentService } from "./profile/consent.ts";
import { createMatchingService } from "./matching/score.ts";
import { createInboundRoutes } from "./routes/inbound.ts";
import { createMailRoutes } from "./routes/mail.ts";
import { createSupportAccessRoutes } from "./routes/support-access.ts";
import { createAccountRoutes } from "./routes/account.ts";
import { createInboxRoutes } from "./routes/inbox.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { securityHeaders } from "./security-headers.ts";
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
  mailboxes: ReturnType<typeof createMailboxService>;
  resolver: DNSResolver;
  liveCheckAddress: string;
  preparation: PreparationService;
  reviews: ReviewService;
  singletonJobKinds: readonly string[];
  providers: BrowserProviderRegistry | null;
  catalogWorker: CatalogSweepWorker;
  eraser: AccountEraser;
  exports: ExportService;
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
  const clientIpConfig = {
    flyAppName: env.FLY_APP_NAME,
    nodeEnv: env.NODE_ENV,
  } satisfies ClientIpConfig;

  const personal = createPersonalCrypto(
    deps.db,
    parseMasterKey(env.MASTER_KEY_V1, env.MASTER_KEY_CURRENT),
    env.MASTER_KEY_CURRENT,
  );

  const adminApi = createAdminApi(deps.db, deps.clock, deps.auth, {
    providers: deps.providers,
    personal,
  });

  const adminHost = new Hono();

  const matching = createMatchingService({
    db: deps.db,
    clock: deps.clock,
    llm: deps.llm,
    personal,
  });

  adminHost.route("/admin/api", adminApi);
  adminHost.all("/api/auth/*", async (context) =>
    deps.auth.handler(stripUntrustedIpHeaders(context.req.raw, clientIpConfig)),
  );

  const app = new Hono();

  app.use("*", securityHeaders(env.NODE_ENV === "production"));

  const { mailboxes } = deps;

  app.use("/api/*", async (context, next) => {
    if (context.req.method === "GET" || context.req.method === "HEAD") {
      return next();
    }

    if (new URL(context.req.url).pathname.startsWith("/api/auth/")) {
      return next();
    }

    const session = await deps.auth.api
      .getSession({ headers: context.req.raw.headers })
      .catch(() => null);

    const locked = demoLocked(session?.user.role);

    if (locked !== null) {
      return locked;
    }

    return next();
  });

  app.all("/api/auth/*", async (context) =>
    deps.auth.handler(stripUntrustedIpHeaders(context.req.raw, clientIpConfig)),
  );
  app.route("/api", createHealthRoutes(deps.db, deps.backups));
  app.route("/api", createMeRoutes(deps.auth));
  app.route("/api", createSupportAccessRoutes(deps.db, deps.auth));
  app.route("/api", createApiRoutes(deps.db, deps.clock, deps.auth));
  app.route("/api", createNotificationRoutes(deps.db, deps.clock, deps.auth));
  app.route("/api", createProfileRoutes(deps));
  app.route(
    "/api",
    createAccountRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      eraser: deps.eraser,
      exports: deps.exports,
    }),
  );
  app.route(
    "/api",
    createOnboardingRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      llm: deps.llm,
      objects: deps.objects,
      reviews: deps.reviews,
    }),
  );
  app.route(
    "/api",
    createConsentRoutes({
      auth: deps.auth,
      consent: createConsentService({ clock: deps.clock, db: deps.db }),
    }),
  );
  app.route(
    "/api",
    createHomeRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      matching,
      personal,
      reviews: deps.reviews,
    }),
  );
  app.route("/api", createNavRoutes({ auth: deps.auth, db: deps.db, reviews: deps.reviews }));
  app.route("/api", createApplicationRoutes(deps.db, deps.clock, deps.auth, personal));
  app.route("/api", createCheckinRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db }));
  app.route("/api", createCalendarRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db }));
  app.route(
    "/api",
    createReadyRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      personal,
      preparation: deps.preparation,
    }),
  );
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
  app.route(
    "/api",
    createMailRoutes({
      db: deps.db,
      clock: deps.clock,
      auth: deps.auth,
      personal,
      mailboxes,
      secretSet: env.INBOUND_HMAC_SECRET !== undefined,
    }),
  );
  app.route(
    "/api",
    createInboxRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      objects: deps.objects,
      personal,
    }),
  );
  app.route(
    "/",
    createInboundRoutes({
      db: deps.db,
      clock: deps.clock,
      objects: deps.objects,
      personal,
      mailboxes,
      resolver: deps.resolver,
      liveCheckAddress: deps.liveCheckAddress,
      secret: env.INBOUND_HMAC_SECRET,
    }),
  );

  if (deps.testRoutes) {
    app.route(
      "/__test__",
      createTestRoutes(
        deps.db,
        deps.clock,
        deps.jobHandlers,
        deps.singletonJobKinds,
        deps.preparation,
        deps.catalogWorker,
        deps.objects,
      ),
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
