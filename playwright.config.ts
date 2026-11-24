import { defineConfig } from "@playwright/test";

const ci = Bun.env.CI === "true";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  workers: 2,
  maxFailures: ci ? 10 : 0,
  retries: ci ? 1 : 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  globalSetup: "./test/e2e/global-setup.ts",
  use: {
    trace: ci ? "on-first-retry" : "retain-on-failure",
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
      name: "board-boards",
      testMatch: /board-match-board\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/board/{arg}{ext}",
        },
      },
    },
    {
      name: "ready-boards",
      testMatch: /board-match-ready\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/ready/{arg}{ext}",
        },
      },
    },
    {
      name: "board-phone-boards",
      testMatch: /board-match-board-phone\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/.tmp/board-baselines/{arg}{ext}",
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
      testMatch: /board-match-home.*\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/home/{arg}{ext}",
        },
      },
    },
    {
      name: "home-paused-boards",
      testMatch: /board-match-paused\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/home-paused/{arg}{ext}",
        },
      },
    },
    {
      name: "code-wait-boards",
      testMatch: /board-match-code-wait\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/code-wait/{arg}{ext}",
        },
      },
    },
    {
      name: "onboarding-boards",
      testMatch: /board-match-onboarding-facts\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/onboarding-questions/{arg}{ext}",
        },
      },
    },
    {
      name: "onboarding-resume-boards",
      testMatch: /board-match-onboarding-resume\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/onboarding-resume/{arg}{ext}",
        },
      },
    },
    {
      name: "onboarding-welcome-boards",
      testMatch: /board-match-onboarding-welcome\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/onboarding-welcome/{arg}{ext}",
        },
      },
    },
    {
      name: "inbox-boards",
      testMatch: /board-match-inbox\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/inbox/main/{arg}{ext}",
        },
      },
    },
    {
      name: "onboarding-targets-boards",
      testMatch: /board-match-onboarding-targets\.test\.ts/u,
      expect: {
        toHaveScreenshot: {
          maxDiffPixelRatio: 0.01,
          pathTemplate: "{testDir}/../../design/reference/onboarding-targets/{arg}{ext}",
        },
      },
    },
    {
      name: "notifications-boards",
      testMatch: /board-match-notifications\.test\.ts/u,
    },
    {
      name: "settings-delete-boards",
      testMatch: /board-match-settings-delete\.test\.ts/u,
    },
  ],
});
