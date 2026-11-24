import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DNSResolver } from "mailauth";
import { join, resolve } from "node:path";

import type { AppDatabase, CatalogDatabase } from "./platform/db/client.ts";
import type { BackupMonitor } from "./platform/ports/backup.ts";
import type { DegradedFlagReader } from "./platform/degraded.ts";
import type { ClientIpConfig } from "./auth/client-ip.ts";
import type { PersonalCrypto } from "./profile/personal-crypto.ts";
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
import type { MailSender } from "./platform/mail/port.ts";

import { readSession } from "./auth/session.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createSupplyRoutes } from "./routes/supply.ts";
import { createLabRoutes } from "./routes/lab.ts";
import { createMeRoutes } from "./routes/me.ts";
import { createWaitlistRoutes } from "./routes/waitlist.ts";
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
import { createAdminApi } from "./routes/admin.ts";
import { createTestRoutes } from "./routes/test-only.ts";
import { stripUntrustedIpHeaders } from "./auth/client-ip.ts";
import { crossSiteRefusal } from "./auth/csrf.ts";
import { DEMO_SIGN_IN_PATH } from "./auth/demo-paths.ts";
import { env, labEnvironment, masterKeyring } from "./config/env.ts";
import { accessVerifier } from "./platform/access/configured.ts";
import { resolveAdminAccessOwner } from "./admin/access-owner.ts";
import { demoLocked } from "./demo/guard.ts";
import { createProfileRoutes } from "./routes/profile.ts";
import { createOnboardingRoutes } from "./routes/onboarding.ts";
import { createConsentRoutes } from "./routes/consent.ts";
import { createConsentService } from "./profile/consent.ts";
import { createMatchingService } from "./matching/score.ts";
import {
  adminOwnerRefusalPage,
  adminRootLocation,
  dispatchByHost,
  isAdminPageRequest,
  mainHostAdminApiRefusal,
} from "./host-routing.ts";
import { createInboundRoutes } from "./routes/inbound.ts";
import { createInternalCatalogRoutes } from "./routes/internal-catalog.ts";
import { createMailRoutes } from "./routes/mail.ts";
import { createWorkspaceSearchRoutes } from "./routes/workspace-search.ts";
import { createSupportAccessRoutes } from "./routes/support-access.ts";
import { createSupportRoutes } from "./routes/support.ts";
import { createAccountRoutes } from "./routes/account.ts";
import { createBillingRoutes, createStripeWebhookRoutes } from "./routes/billing.ts";
import { createInboxRoutes } from "./routes/inbox.ts";
import { createPersonalCrypto } from "./profile/personal-crypto.ts";
import { createConfiguredBackupStore } from "./platform/object-store.ts";
import { securityHeaders } from "./security-headers.ts";
import { logError } from "./platform/log.ts";
import type { CatalogHotSwap } from "./catalog/hot-swap.ts";
import { API_ERRORS } from "../shared/api-errors.ts";

export interface AppDependencies {
  db: AppDatabase;
  catalogDb: CatalogDatabase;
  catalogHotSwap?: CatalogHotSwap | undefined;
  /** Where a relay upload stages the compressed snapshot; defaults to the OS temp dir. */
  catalogStagingDir?: string | undefined;
  clock: AdjustableClock;
  backups: BackupMonitor;
  databasePath: string;
  degraded: DegradedFlagReader;
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
  mail: MailSender;
  payments: Payments | null;
  personal?: PersonalCrypto | undefined;
  /** Aborted on shutdown; long-lived responses (the event stream) end with it. */
  shutdown: AbortSignal;
}

export { hostnameFromHeader } from "./host-routing.ts";

function adminHostSharesMainHostname() {
  try {
    return (
      new URL(env.APP_ORIGIN ?? "http://localhost:3000").hostname ===
      new URL(env.ADMIN_ORIGIN).hostname
    );
  } catch {
    return false;
  }
}

export async function staticResponseFrom(root: string, url: string) {
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
    const headers = staticCacheHeaders(pathname);

    return headers === undefined
      ? new Response(Bun.file(match))
      : new Response(Bun.file(match), { headers });
  }

  if (isHashedAssetPath(pathname)) {
    return new Response("Not found", {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }

  const shells = await Promise.all(
    ["app-shell.html", "index.html"].map(async (name) => {
      const shell = Bun.file(join(resolvedRoot, name));

      return (await shell.exists()) ? shell : null;
    }),
  );

  const shell = shells.find((candidate) => candidate !== null);

  if (shell !== undefined) {
    return new Response(shell, {
      headers: { "Cache-Control": "no-cache", "content-type": "text/html; charset=utf-8" },
    });
  }

  return null;
}

export async function serviceWorkerResponse(root: string) {
  const worker = Bun.file(join(resolve(root), "sw.js"));

  if (!(await worker.exists())) {
    return new Response("Not found", {
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }

  return new Response(worker, {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "CDN-Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
      Pragma: "no-cache",
      "Service-Worker-Allowed": "/",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function crossSiteExempt(pathname: string) {
  return (
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/events" ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/internal/")
  );
}

export function isHashedAssetPath(pathname: string) {
  return pathname.startsWith("/assets/") || pathname === "/sw.js";
}

export function staticCacheHeaders(pathname: string) {
  if (pathname.startsWith("/assets/")) {
    return { "Cache-Control": "public, max-age=31536000, immutable" };
  }

  if (pathname === "/sw.js") {
    return {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "CDN-Cache-Control": "no-store",
    };
  }

  const revalidate = pathname === "/" || pathname.endsWith(".html");

  return revalidate ? { "Cache-Control": "no-cache" } : undefined;
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

  const personal = deps.personal ?? createPersonalCrypto(deps.db, masterKeyring);

  const allowedWriteOrigins = [env.APP_ORIGIN, env.ADMIN_ORIGIN].flatMap((origin) =>
    origin === undefined ? [] : [origin],
  );

  const adminApi = createAdminApi(deps.db, deps.clock, {
    backupObjects: createConfiguredBackupStore(),
    backups: deps.backups,
    catalogDb: deps.catalogDb,
    databasePath: deps.databasePath,
    degraded: deps.degraded,
    mail: deps.mail,
    objects: deps.objects,
    payments: deps.payments,
    providers: deps.providers,
    personal,
  });

  const adminHost = new Hono();

  adminHost.use("/admin/api/*", async (context, next) => {
    await next();

    if (!context.res.headers.has("Cache-Control")) {
      context.res.headers.set("Cache-Control", "private, no-store");
    }
  });

  const matching = createMatchingService({
    db: deps.db,
    catalogDb: deps.catalogDb,
    clock: deps.clock,
    llm: deps.llm,
    personal,
    spendGate: deps.spendGate,
  });

  adminHost.use("/admin/api/*", async (context, next) => {
    const refusal = crossSiteRefusal(context.req.raw, allowedWriteOrigins);

    if (refusal !== null) {
      return refusal;
    }

    return next();
  });
  adminHost.route("/admin/api", adminApi);
  adminHost.route("/api", createMeRoutes(deps.auth, deps.db, deps.clock));
  adminHost.all("/api/auth/*", async (context) => {
    if (new URL(context.req.url).pathname === DEMO_SIGN_IN_PATH) {
      return context.json({ error: API_ERRORS.notFound }, 404);
    }

    return deps.auth.handler(stripUntrustedIpHeaders(context.req.raw, clientIpConfig));
  });

  adminHost.use("*", async (context, next) => {
    const { pathname } = new URL(context.req.url);

    if (!isAdminPageRequest(context.req.method, pathname, context.req.header("accept") ?? "")) {
      return next();
    }

    const identity = accessVerifier === null ? null : await accessVerifier.verify(context.req.raw);

    if (identity !== null) {
      const resolved = await resolveAdminAccessOwner(deps.db, deps.clock, identity);

      if (!resolved.ok) {
        return new Response(adminOwnerRefusalPage(env.OWNER_EMAIL), {
          headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" },
          status: 403,
        });
      }

      if (pathname === "/signin" || pathname === "/signup") {
        return context.redirect("/admin", 302);
      }

      return next();
    }

    const session = await readSession(deps.auth, context.req.raw.headers);

    if (session === null) {
      return next();
    }

    if (session.user.role !== "owner") {
      return new Response(adminOwnerRefusalPage(env.OWNER_EMAIL), {
        headers: { "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" },
        status: 403,
      });
    }

    if (pathname === "/signin" || pathname === "/signup") {
      return context.redirect("/admin", 302);
    }

    return next();
  });

  adminHost.get("/", (context) =>
    context.redirect(adminRootLocation(new URL(context.req.url)), 302),
  );

  const app = new Hono();

  app.onError(jsonError);
  adminHost.onError(jsonError);

  app.use("*", securityHeaders(env.NODE_ENV === "production"));

  const splitHosts = !adminHostSharesMainHostname();

  if (splitHosts) {
    app.use("*", dispatchByHost(adminHost, env.ADMIN_ORIGIN));
  }

  app.use("/api/*", async (context, next) => {
    await next();

    if (!context.res.headers.has("Cache-Control")) {
      context.res.headers.set("Cache-Control", "private, no-store");
    }
  });

  const { mailboxes } = deps;

  app.use("/api/*", async (context, next) => {
    const { pathname } = new URL(context.req.url);

    if (crossSiteExempt(pathname)) {
      return next();
    }

    const refusal = crossSiteRefusal(context.req.raw, allowedWriteOrigins);

    if (refusal !== null) {
      return refusal;
    }

    return next();
  });

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
      clientIpConfig,
      environment: labEnvironment,
      recaptchaSecret: env.LAB_RECAPTCHA_SECRET,
      recaptchaVerifyUrl: env.LAB_RECAPTCHA_VERIFY_URL,
    }),
  );
  app.route("/api", createHealthRoutes(deps.db, deps.backups));
  app.route(
    "/api",
    createSupplyRoutes({
      catalogDb: deps.catalogDb,
      clientIpConfig,
      clock: deps.clock,
      db: deps.db,
    }),
  );
  app.route("/api", createMeRoutes(deps.auth, deps.db, deps.clock));
  app.route("/api", createWaitlistRoutes({ clientIpConfig, clock: deps.clock, db: deps.db }));
  app.route("/api", createSupportAccessRoutes(deps.db, deps.auth));
  app.route(
    "/api",
    createSupportRoutes({
      auth: deps.auth,
      clock: deps.clock,
      db: deps.db,
      mail: deps.mail,
      personal,
    }),
  );
  app.route(
    "/api",
    createApiRoutes(deps.db, deps.catalogDb, deps.clock, deps.auth, { shutdown: deps.shutdown }),
  );
  app.route("/api", createNotificationRoutes(deps.db, deps.clock, deps.auth));
  app.route("/api", createProfileRoutes({ ...deps, personal }));
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
      personal,
      reviews: deps.reviews,
      spendGate: deps.spendGate,
      matching,
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
  app.route(
    "/api",
    createWorkspaceSearchRoutes({ auth: deps.auth, clock: deps.clock, db: deps.db, personal }),
  );
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

  if (deps.catalogHotSwap !== undefined && env.CATALOG_REFRESH_SECRET !== undefined) {
    app.route(
      "/",
      createInternalCatalogRoutes({
        clock: deps.clock,
        hotSwap: deps.catalogHotSwap,
        objects: deps.objects,
        secret: env.CATALOG_REFRESH_SECRET,
        ...(deps.catalogStagingDir !== undefined && { stagingDir: deps.catalogStagingDir }),
      }),
    );
  }

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
    const testRoutes = createTestRoutes(
      deps.db,
      deps.catalogDb,
      deps.clock,
      deps.jobHandlers,
      deps.singletonJobKinds,
      deps.preparation,
      deps.catalogWorker,
      deps.objects,
    );

    app.route("/__test__", testRoutes);
    adminHost.route("/__test__", testRoutes);
  }

  app.all("/api/*", (context) => context.json({ error: API_ERRORS.notFound }, 404));

  if (!splitHosts) {
    app.use("*", dispatchByHost(adminHost, env.ADMIN_ORIGIN));
  }

  app.all("/admin/api/*", mainHostAdminApiRefusal);

  app.get("/sw", async () => serviceWorkerResponse(deps.staticRoot));

  app.get("*", async (context) => {
    const page = await staticResponseFrom(deps.staticRoot, context.req.url);

    return page ?? context.notFound();
  });

  adminHost.get("/sw", async () => serviceWorkerResponse(deps.staticRoot));

  adminHost.get("*", async (context) => {
    const page = await staticResponseFrom(deps.staticRoot, context.req.url);

    return page ?? context.notFound();
  });

  return app;
}
