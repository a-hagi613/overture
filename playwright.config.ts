import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  globalSetup: "./test/e2e/global-setup.ts",
  use: {
    trace: "retain-on-failure",
  },
});
