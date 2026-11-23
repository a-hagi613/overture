import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DNSResolver } from "mailauth";
import { join, resolve } from "node:path";

import type { AppDatabase, CatalogDatabase } from "./platform/db/client.ts";
import type { BackupMonitor } from "./platform/ports/backup.ts";
import type { ClientIpConfig } from "./auth/client-ip.ts";
import type { Auth } from "./auth/index.ts";
import type { AdjustableClock } from "./platform/ports/clock.ts";
import type { JobHandlers } from "./platform/jobs/run-due.ts";
import type { LlmPort } from "./platform/ports/llm.ts";
import type { ObjectStore } from "./platform/ports/object-store.ts";
import type { Payments } from "./platform/ports/payments.ts";
import type { PreparationService } from "./pipeline/prepare.ts";
import type { ReviewService } from "./pipeline/reviews.ts";
import type { createMailboxService } from "./inbox/mailboxes.ts";
import type { BrowserProviderRegistry } from "./dispatch/browser/provider.ts";
import type { CatalogSweepWorker } from "./catalog/sweep-worker-runner.ts";
import type { AccountEraser } from "./account/erase.ts";
import type { ExportService } from "./export/service.ts";
import type { SpendGate } from "./billing/spend.ts";

import { readSession } from "./auth/session.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createLabRoutes } from "./routes/lab.ts";
import { createMeRoutes } from "./routes/me.ts";
import { createApiRoutes } from "./routes/api.ts";
import { createNotificationRoutes } from "./routes/notifications.ts";
import { createApplicationRoutes } from "./routes/applications.ts";
import { createHomeRoutes } from "./routes/home.ts";
import { createNavRoutes } from "./routes/nav.ts";
import { createCheckinRoutes } from "./routes/checkins.ts";
import { createCalendarRoutes } from "./routes/calendar.ts";
import { createCalendarFeedRoutes } from "./routes/calendar-feed.ts";
import { createReadyRoutes } from "./routes/ready.ts";
import { createMatchingRoutes } from "./routes/matching.ts";
import { createReviewRoutes } from "./routes/reviews.ts";
import { createAdminApi, isAdminHost } from "./routes/admin.ts";
import { createTestRoutes } from "./routes/test-only.ts";
import { stripUntrustedIpHeaders } from "./auth/client-ip.ts";
import { env, labEnvironment } from "./config/env.ts";
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
import { createBillingRoutes, createStripeWebhookRoutes } from "./routes/billing.ts";
import { createInboxRoutes } from "./routes/inbox.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { createConfiguredBackupStore } from "./platform/object-store.ts";
import { securityHeaders } from "./security-headers.ts";
import { parseMasterKey } from "./platform/crypto.ts";
import { logError } from "./platform/log.ts";
import { API_ERRORS } from "../shared/api-errors.ts";

export interface AppDependencies {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  clock: AdjustableClock;
  backups: BackupMonitor;
  databasePath: string;
  staticRoot: string;
  testRoutes: boolean;
  jobHandlers: JobHandlers;
  auth: Auth;
  objects: ObjectStore;
  llm: LlmPort;
  spendGate: SpendGate;
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
  payments: Payments | null;
  /** Aborted on shutdown; long-lived responses (the event stream) end with it. */
  shutdown: AbortSignal;
}

async function staticResponseFrom(root: string, url: string) {
  const { pathname } = new URL(url);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const resolvedRoot = resolve(root);
  const requested = resolve(resolvedRoot, relativePath);

  const candidates = requested.startsWith(`${resolvedRoot}/`)
    ? [requested, join(requested, "index.html")]
    : [];

  const found = await Promise.all(
    candidates.map(async (candidate) => ((await Bun.file(candidate).exists()) ? candidate : null)),
  );

  const match = found.find((candidate) => candidate !== null);

  if (match !== undefined) {
    return new Response(Bun.file(match));
  }

  const shells = await Promise.all(
    ["app-shell.html", "index.html"].map(async (name) => {
      const shell = Bun.file(join(resolvedRoot, name));

      return (await shell.exists()) ? shell : null;
    }),
  );

  const shell = shells.find((candidate) => candidate !== null);

  if (shell !== undefined) {
    return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return null;
}

function jsonError(error: Error, context: Context) {
  if (error instanceof HTTPException) {
    let code: string = API_ERRORS.internal;

    if (error.status === 400) {
      code = API_ERRORS.invalidRequest;
    } else if (error.status === 401) {
      code = API_ERRORS.signInRequired;
    } else if (error.status === 404) {
      code = API_ERRORS.notFound;
    }

    return context.json({ error: code }, error.status);
  }

  logError("http", error);

  return context.json({ error: API_ERRORS.internal }, 500);
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
    backupObjects: createConfiguredBackupStore(),
    catalogDb: deps.catalogDb,
    databasePath: deps.databasePath,
    objects: deps.objects,
    payments: deps.payments,
    providers: deps.providers,
    personal,
  });

  const adminHost = new Hono();

  const matching = createMatchingService({
    db: deps.db,
    catalogDb: deps.catalogDb,
    clock: deps.clock,
    llm: deps.llm,
    personal,
    spendGate: deps.spendGate,
  });

  adminHost.route("/admin/api", adminApi);
  adminHost.all("/api/auth/*", async (context) =>
    deps.auth.handler(stripUntrustedIpHeaders(context.req.raw, clientIpConfig)),
  );

  const app = new Hono();

  app.onError(jsonError);
  adminHost.onError(jsonError);

  app.use("*", securityHeaders(env.NODE_ENV === "production"));

  const { mailboxes } = deps;

  app.use("/api/*", async (context, next) => {
    if (context.req.method === "GET" || context.req.method === "HEAD") {
      return next();
    }

    if (new URL(context.req.url).pathname.startsWith("/api/auth/")) {
      return next();
    }

    const session = await readSession(deps.auth, context.req.raw.headers);

    const locked = demoLocked(session?.user.role);

    if (locked !== null) {
      return locked;
    }

    return next();
  });

  app.all("/api/auth/*", async (context) =>
    deps.auth.handler(stripUntrustedIpHeaders(context.req.raw, clientIpConfig)),
  );
  app.route(
    "/lab",
    createLabRoutes({
      clock: deps.clock,
      environment: labEnvironment,
      recaptchaSecret: env.LAB_RECAPTCHA_SECRET,
      recaptchaVerifyUrl: env.LAB_RECAPTCHA_VERIFY_URL,
    }),
  );
  app.route("/api", createHealthRoutes(deps.db, deps.backups));
  app.route("/api", createMeRoutes(deps.auth));
  app.route("/api", createSupportAccessRoutes(deps.db, deps.auth));
  app.route(
    "/api",
    createApiRoutes(deps.db, deps.catalogDb, deps.clock, deps.auth, { shutdown: deps.shutdown }),
  );
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
      catalogDb: deps.catalogDb,
      clock: deps.clock,
      db: deps.db,
      llm: deps.llm,
      objects: deps.objects,
      reviews: deps.reviews,
      spendGate: deps.spendGate,
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
  app.route(
    "/api",
    createBillingRoutes({
      appOrigin: env.APP_ORIGIN ?? "http://localhost:3000",
      auth: deps.auth,
      cardFingerprintSecret: env.CARD_FINGERPRINT_SECRET ?? null,
      clock: deps.clock,
      db: deps.db,
      payments: deps.payments,
    }),
  );
  app.route("/api", createApplicationRoutes(deps.db, deps.clock, deps.auth, personal));
  app.route("/api", createCheckinRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db }));
  app.route("/api", createCalendarRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db }));
  app.route("/", createCalendarFeedRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db }));
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
      catalogDb: deps.catalogDb,
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
  app.route(
    "/",
    createStripeWebhookRoutes({
      cardFingerprintSecret: env.CARD_FINGERPRINT_SECRET ?? null,
      clock: deps.clock,
      db: deps.db,
      payments: deps.payments,
    }),
  );

  if (deps.testRoutes) {
    app.route(
      "/__test__",
      createTestRoutes(
        deps.db,
        deps.catalogDb,
        deps.clock,
        deps.jobHandlers,
        deps.singletonJobKinds,
        deps.preparation,
        deps.catalogWorker,
        deps.objects,
      ),
    );
  }

  app.all("/api/*", (context) => context.json({ error: API_ERRORS.notFound }, 404));

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
