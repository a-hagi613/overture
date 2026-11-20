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
  projects: [
    {
      name: "chromium",
      testIgnore: "**/board-match-*.test.ts",
    },
    {
      name: "signin-boards",
      testMatch: /board-match-signin\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/signin/{arg}{ext}",
        },
      },
    },
    {
      name: "profile-boards",
      testMatch: /board-match-profile\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/profile/{arg}{ext}",
        },
      },
    },
    {
      name: "shell-boards",
      testMatch: /board-match-shell\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/chrome-baselines/{arg}{ext}",
        },
      },
    },
  ],
});
