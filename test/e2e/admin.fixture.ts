import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";

import { test as base } from "./app.fixture.ts";

import type { AppServer } from "./app-server.ts";
import type { BrowserContext } from "@playwright/test";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startAppServer } from "./app-server.ts";
import { accessTeamIdentity, startAccessServer } from "./access-server.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

type AccessServer = Awaited<ReturnType<typeof startAccessServer>>;

interface AdminTestFixtures {
  adminAppServer: AppServer;
  adminAppUrl: string;
  adminApiUrl: string;
  accessServer: AccessServer;
  adminIsolatedAppServer: AppServer;
  adminIsolatedAppUrl: string;
  ownerAccessHeaders: Record<string, string>;
  ownerAccessCookieState: StorageState;
  captureAppServer: AppServer;
  captureAppUrl: string;
  browserUseApi: BrowserUseFixture;
}

interface AdminWorkerFixtures {
  _accessServerWorker: AccessServer;
  _identityServerWorker: IdentityServer;
  _adminAppServerWorker: AppServer;
  _ownerAccessHeadersWorker: Record<string, string>;
  _ownerAccessCookieStateWorker: { state: StorageState; token: string };
}

const ADMIN_PORT_BASE = 4600;

function adminPort(offset: number) {
  return ADMIN_PORT_BASE + Number(process.env.TEST_WORKER_INDEX ?? "0") * 10 + offset;
}

function adminEnv(
  jwksUrl: string,
  port: number,
  identityServer: IdentityServer,
  extra: Record<string, string> = {},
) {
  return {
    PORT: String(port),
    ADMIN_ORIGIN: `http://localhost:${String(port)}`,
    OAUTH_GOOGLE_DISCOVERY_URL: `${identityServer.url}/.well-known/openid-configuration`,
    OAUTH_LINKEDIN_DISCOVERY_URL: `${identityServer.url}/.well-known/openid-configuration`,
    AUTH_ALLOWED_HOSTS: "127.0.0.1,localhost",
    CF_ACCESS_AUD: accessTeamIdentity.audience,
    CF_ACCESS_TEAM_DOMAIN: accessTeamIdentity.teamDomain,
    CF_ACCESS_JWKS_URL: jwksUrl,
    ...extra,
  };
}

async function startFreshAdminServer(
  identityServer: IdentityServer,
  accessServer: AccessServer,
  offset: number,
  extraEnvironment: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-admin-e2e-"));
  const databasePath = join(directory, "overture.db");

  copyFileSync(join(process.cwd(), "test/e2e/.tmp/template.db"), databasePath);

  return startAppServer(
    databasePath,
    adminEnv(accessServer.url, adminPort(offset), identityServer, {
      OBJECT_STORE_ROOT: join(directory, "objects"),
      ...extraEnvironment,
    }),
  );
}

function adminUrlOf(server: AppServer) {
  return server.url.replace("127.0.0.1", "localhost");
}

export const test = base.extend<AdminTestFixtures, AdminWorkerFixtures>({
  _accessServerWorker: [
    async ({ browser: _browser }, provide) => {
      const server = await startAccessServer();

      await provide(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  _adminAppServerWorker: [
    async ({ _identityServerWorker, _accessServerWorker }, provide) => {
      const server = await startFreshAdminServer(_identityServerWorker, _accessServerWorker, 0);

      await provide(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  _ownerAccessHeadersWorker: [
    async ({ _accessServerWorker }, provide) => {
      const token = await _accessServerWorker.issueToken({ email: authTestIdentity.ownerEmail });

      await provide({ "cf-access-jwt-assertion": token });
    },
    { scope: "worker" },
  ],
  _ownerAccessCookieStateWorker: [
    async ({ _adminAppServerWorker, _accessServerWorker }, provide) => {
      const adminUrl = adminUrlOf(_adminAppServerWorker);
      const context = await apiRequest.newContext();

      await requestMagicLink(adminUrl, context, authTestIdentity.ownerEmail);

      const link = await latestMailLink(adminUrl, context, authTestIdentity.ownerEmail);

      await context.get(link);

      const state = await context.storageState();
      const token = await _accessServerWorker.issueToken({ email: authTestIdentity.ownerEmail });

      state.cookies.push({
        name: "CF_Authorization",
        value: token,
        domain: "localhost",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      });

      await context.dispose();
      await provide({ state, token });
    },
    { scope: "worker" },
  ],
  adminAppServer: async ({ _adminAppServerWorker }, provide) => {
    await provide(_adminAppServerWorker);
  },
  accessServer: async ({ _accessServerWorker }, provide) => {
    await provide(_accessServerWorker);
  },
  adminAppUrl: async ({ _adminAppServerWorker }, provide) => {
    await provide(adminUrlOf(_adminAppServerWorker));
  },
  adminApiUrl: async ({ adminAppUrl }, provide) => {
    await provide(`${adminAppUrl}/admin/api`);
  },
  adminIsolatedAppServer: async ({ _identityServerWorker, _accessServerWorker }, provide) => {
    const server = await startFreshAdminServer(_identityServerWorker, _accessServerWorker, 1);

    await provide(server);
    await server.stop();
  },
  adminIsolatedAppUrl: async ({ adminIsolatedAppServer }, provide) => {
    await provide(adminUrlOf(adminIsolatedAppServer));
  },
  browserUseApi: async ({ browser: _browser }, provide) => {
    const fixture = startBrowserUseFixture();

    await provide(fixture);
    fixture.close();
  },
  captureAppServer: async (
    { _identityServerWorker, _accessServerWorker, browserUseApi },
    provide,
  ) => {
    const server = await startFreshAdminServer(_identityServerWorker, _accessServerWorker, 2, {
      BROWSER_PROVIDER: "browser_use",
      BROWSER_USE_API_BASE_URL: browserUseApi.url,
      BROWSER_USE_API_KEY: "admin-capture-test-key",
      BROWSER_PROXY_COUNTRY: "ca",
    });

    await provide(server);
    await server.stop();
  },
  captureAppUrl: async ({ captureAppServer }, provide) => {
    await provide(adminUrlOf(captureAppServer));
  },
  ownerAccessHeaders: async ({ _ownerAccessHeadersWorker }, provide) => {
    await provide(_ownerAccessHeadersWorker);
  },
  ownerAccessCookieState: async ({ _ownerAccessCookieStateWorker }, provide) => {
    await provide(_ownerAccessCookieStateWorker.state);
  },
});

export { expect } from "@playwright/test";

export { accessTeamIdentity, startAccessServer } from "./access-server.ts";

export type { StorageState };
