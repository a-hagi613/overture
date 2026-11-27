import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";

import type { Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";

const SHOT_DIR = join(process.cwd(), "docs/screenshots/759");

const JOBS = [
  {
    public_slug: "isl-islamic",
    company: "International School of London Qatar",
    title: "Islamic Studies Teacher",
    score: 80,
  },
  {
    public_slug: "isl-pyp",
    company: "International School of London Qatar",
    title: "PYP PHE Teacher",
    score: 91,
  },
  {
    public_slug: "isl-spanish",
    company: "International School of London Qatar",
    title: "MYP & DP Spanish",
    score: 92,
  },
  {
    public_slug: "ics-teacher",
    company: "International Community Schools",
    title: "Class Teacher",
    score: 70,
  },
  {
    public_slug: "ics-coordinator",
    company: "International Community Schools",
    title: "PYP Coordinator",
    score: 95,
  },
] as const;

const SHOTS = [390, 1280].flatMap((width) =>
  (["light", "dark"] as const).map((theme) => ({ theme, width })),
);

async function captureShots(page: Page, index: number) {
  const shot = SHOTS[index];

  if (shot === undefined) {
    return;
  }

  await page.setViewportSize({ height: 1000, width: shot.width });
  await page.evaluate((theme) => {
    globalThis.localStorage.setItem("overture.theme", theme);
  }, shot.theme);
  await page.reload();
  await expect(page.getByText("2 of 3 selected", { exact: true })).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: join(SHOT_DIR, `onboarding-matches-${String(shot.width)}-${shot.theme}.png`),
  });
  await captureShots(page, index + 1);
}

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

test("a batch pick keeps one role per employer and the screen says so", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const { userId } = await seedOnboardingTargetsFlow(request, onboardingServer.url);

  const seededJobs = await request.post("/__test__/jobs/seed", {
    data: {
      jobs: JOBS.map((job) => ({
        category: "software_engineering",
        cities: ["London"],
        company: job.company,
        countries: ["gb"],
        public_slug: job.public_slug,
        title: job.title,
      })),
    },
  });

  expect(seededJobs.ok(), `job seed: ${String(seededJobs.status())}`).toBe(true);

  const seededMatches = await Promise.all(
    JOBS.map(async (job) =>
      request.post("/__test__/matches/seed", {
        data: { codeRank: job.score, postingId: job.public_slug, score: job.score, userId },
      }),
    ),
  );

  for (const seededMatch of seededMatches) {
    expect(seededMatch.ok(), `match seed: ${String(seededMatch.status())}`).toBe(true);
  }

  const context = await browser.newContext({
    storageState: await request.storageState(),
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();

  try {
    await walkOnboardingSteps1To4(page, onboardingServer.url);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    await expect(page.getByText("2 of 3 selected", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Select PYP PHE Teacher at International School of London Qatar",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Selected MYP & DP Spanish at International School of London Qatar",
      }),
    ).toBeVisible();

    mkdirSync(SHOT_DIR, { recursive: true });
    await captureShots(page, 0);
  } finally {
    await context.close().catch(() => undefined);
    await request.dispose();
  }
});
