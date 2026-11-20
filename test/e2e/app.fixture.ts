import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test as base } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { startAppServer } from "./app-server.ts";

interface TestFixtures {
  appServerUrl: string;
}

interface WorkerFixtures {
  appServer: AppServer;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  appServer: [
    async ({ browserName: _browserName }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-e2e-"));
      const databasePath = join(directory, "overture.db");

      copyFileSync(join(process.cwd(), "test/e2e/.tmp/template.db"), databasePath);

      const server = await startAppServer(databasePath);

      await provide(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  appServerUrl: async ({ appServer }, provide) => {
    await provide(appServer.url);
  },
});

export { expect } from "@playwright/test";
