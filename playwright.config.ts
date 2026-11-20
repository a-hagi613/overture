import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  workers: 2,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
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
    {
      name: "review-boards",
      testMatch: /board-match-review\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/review/{arg}{ext}",
        },
      },
    },
    {
      name: "home-boards",
      testMatch: /board-match-home-usage\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/home/{arg}{ext}",
        },
      },
    },
  ],
});
