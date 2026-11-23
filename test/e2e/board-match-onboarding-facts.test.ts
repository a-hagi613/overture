import { request as apiRequest } from "@playwright/test";

import type { Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingBoard, startAtsStub } from "./onboarding-harness.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const ats = startAtsStub();

      const server = await startFreshAppServer(identityServer, {
        GREENHOUSE_BOARD_BASE_URL: ats.url,
        GREENHOUSE_FEED_BASE_URL: ats.url,
      });

      await provide(server);
      await server.stop();
      ats.close();
    },
    { scope: "test" },
  ],
});

async function expectOnboardingMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOnboardingBoard(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 1280 ? 800 : 844, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/onboarding/facts`);

  await expect(
    page.getByRole("heading", { level: 1, name: /Set up your workspace/u }),
  ).toBeVisible();
  await expect(page.getByLabel("Current job title")).toHaveValue("Platform Engineer");
  await expect(page.getByText("Unlocks 14 queued jobs").first()).toBeVisible();
  await expect(page.getByText("Unlocks 31 queued jobs")).toBeVisible();
  await expect(page.getByText("1 of 3 answered")).toBeVisible();
  await expect(page.getByText("1 of 2 answered")).toBeVisible();
  await expect(page.getByText("Not answered")).toBeVisible();
  await expect(page.getByLabel("Salary expectation in CAD")).toHaveValue("140,000");

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, `${String(width)}px ${theme}`).toBe(false);

  await context.close();
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`the Your facts step matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      onboardingServer,
    }) => {
      await expectOnboardingMatchesBoard(browser, onboardingServer.url, width, theme);
    });
  }
}
