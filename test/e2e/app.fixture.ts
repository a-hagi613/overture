import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { request as apiRequest, test as base } from "@playwright/test";

import type { BrowserContext, Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { authTestIdentity, testAuthEnvironment } from "./auth.fixture.ts";
import { startAppServer } from "./app-server.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";
import { startIdentityServer } from "./identity-server-test.fixture.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface TestFixtures {
  appServerUrl: string;
  appServer: AppServer;
  chromeOwnerStorage: StorageState;
  identityServer: IdentityServer;
  isolatedAppServer: AppServer;
  ownerPage: Page;
  ownerStorageState: StorageState;
}

interface WorkerFixtures {
  _appServerWorker: AppServer;
  _identityServerWorker: IdentityServer;
  _ownerStorageStateWorker: StorageState;
  _chromeOwnerStorageWorker: StorageState;
}

function authEnv(identityServer: IdentityServer) {
  return {
    ...testAuthEnvironment,
    AUTH_ALLOWED_HOSTS: "127.0.0.1,localhost",
    MASTER_KEY_V1: authTestIdentity.masterKey,
    MASTER_KEY_CURRENT: "1",
    OAUTH_GOOGLE_DISCOVERY_URL: `${identityServer.url}/.well-known/openid-configuration`,
    OAUTH_LINKEDIN_DISCOVERY_URL: `${identityServer.url}/.well-known/openid-configuration`,
  };
}

async function startFreshAppServer(
  identityServer: IdentityServer,
  extraEnvironment: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-e2e-"));
  const databasePath = join(directory, "overture.db");

  copyFileSync(join(process.cwd(), "test/e2e/.tmp/template.db"), databasePath);

  return startAppServer(databasePath, {
    ...authEnv(identityServer),
    OBJECT_STORE_ROOT: join(directory, "objects"),
    ...extraEnvironment,
  });
}

export { startFreshAppServer };

export const emailOnlyEnvironment = {
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  LINKEDIN_CLIENT_ID: "",
  LINKEDIN_CLIENT_SECRET: "",
} as const;

export const test = base.extend<TestFixtures, WorkerFixtures>({
  _chromeOwnerStorageWorker: [
    async ({ _appServerWorker }, provide) => {
      const request = await apiRequest.newContext();

      await requestMagicLink(_appServerWorker.url, request, authTestIdentity.ownerEmail);

      const link = await latestMailLink(_appServerWorker.url, request, authTestIdentity.ownerEmail);

      await request.get(link);
      await request.post(`${_appServerWorker.url}/__test__/user/name`, {
        data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
      });

      await request.post(`${_appServerWorker.url}/__test__/ledger/sample`, {
        data: { email: authTestIdentity.ownerEmail },
      });

      const storage = await request.storageState();

      await request.dispose();
      await provide(storage);
    },
    { scope: "worker" },
  ],
  _identityServerWorker: [
    async ({ browser: _browser }, provide) => {
      const server = await startIdentityServer();

      await provide(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  _appServerWorker: [
    async ({ _identityServerWorker }, provide) => {
      const server = await startFreshAppServer(_identityServerWorker);

      await provide(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  appServer: async ({ _appServerWorker }, provide) => {
    await provide(_appServerWorker);
  },
  appServerUrl: async ({ _appServerWorker }, provide) => {
    await provide(_appServerWorker.url);
  },
  chromeOwnerStorage: async ({ _chromeOwnerStorageWorker }, provide) => {
    await provide(_chromeOwnerStorageWorker);
  },
  identityServer: async ({ _identityServerWorker }, provide) => {
    await provide(_identityServerWorker);
  },
  isolatedAppServer: async ({ _identityServerWorker }, provide) => {
    const server = await startFreshAppServer(_identityServerWorker);

    await provide(server);
    await server.stop();
  },
  ownerStorageState: async ({ _ownerStorageStateWorker }, provide) => {
    await provide(_ownerStorageStateWorker);
  },
  ownerPage: async ({ browser, ownerStorageState }, provide) => {
    const context = await browser.newContext({ storageState: ownerStorageState });
    const page = await context.newPage();

    await provide(page);
    await context.close();
  },
  _ownerStorageStateWorker: [
    async ({ _appServerWorker }, provide) => {
      const context = await apiRequest.newContext();

      await requestMagicLink(_appServerWorker.url, context, authTestIdentity.ownerEmail);

      const link = await latestMailLink(_appServerWorker.url, context, authTestIdentity.ownerEmail);

      await context.get(link);

      const storage = await context.storageState();

      await context.dispose();
      await provide(storage);
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";
