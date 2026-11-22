import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { KernelFixture } from "./kernel-server.fixture.ts";
import type { LabVerifyFixture } from "./lab-verify-server.fixture.ts";
import type { AppServer } from "./app-server.ts";

import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startKernelFixture } from "./kernel-server.fixture.ts";
import { startLabVerifyServer } from "./lab-verify-server.fixture.ts";
import {
  adminPort,
  adminUrlOf,
  startFreshAdminServer,
  test as adminTest,
} from "./admin.fixture.ts";

interface LabFixtures {
  browserUseApi: BrowserUseFixture;
  kernelApi: KernelFixture;
  labVerify: LabVerifyFixture;
  labAppServer: AppServer;
  labAppUrl: string;
}

const LAB_PORT_OFFSET = 3;

export const test = adminTest.extend<LabFixtures>({
  browserUseApi: async ({ browser: _browser }, provide) => {
    const fixture = startBrowserUseFixture();

    await provide(fixture);
    fixture.close();
  },
  kernelApi: async ({ browser: _browser }, provide) => {
    const fixture = startKernelFixture();

    await provide(fixture);
    fixture.close();
  },
  labVerify: async ({ browser: _browser }, provide) => {
    const fixture = startLabVerifyServer();

    await provide(fixture);
    fixture.close();
  },
  labAppServer: async (
    { _identityServerWorker, _accessServerWorker, browserUseApi, kernelApi, labVerify },
    provide,
  ) => {
    const port = adminPort(LAB_PORT_OFFSET);

    const server = await startFreshAdminServer(
      _identityServerWorker,
      _accessServerWorker,
      LAB_PORT_OFFSET,
      {
        BROWSER_PROVIDER: "browser_use",
        BROWSER_PROXY_COUNTRY: "ca",
        BROWSER_USE_API_BASE_URL: browserUseApi.url,
        BROWSER_USE_API_KEY: "lab-test-key",
        KERNEL_API_BASE_URL: kernelApi.url,
        KERNEL_API_KEY: "lab-test-key",
        LAB_BASE_URL: `http://127.0.0.1:${String(port)}`,
        LAB_RECAPTCHA_SECRET: "lab-test-secret",
        LAB_RECAPTCHA_VERIFY_URL: `${labVerify.url}/recaptcha`,
      },
    );

    await provide(server);
    await server.stop();
  },
  labAppUrl: async ({ labAppServer }, provide) => {
    await provide(adminUrlOf(labAppServer));
  },
});

export { expect } from "@playwright/test";
