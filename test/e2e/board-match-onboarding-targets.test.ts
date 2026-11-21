import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingTargetsBoard } from "./onboarding-targets-harness.ts";

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

async function expectOnboardingMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOnboardingTargetsBoard(request, appServerUrl);

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

  await page.goto(`${appServerUrl}/onboarding/targets`);

  await expect(
    page.getByRole("heading", { level: 1, name: /Set up your workspace/u }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /What do you want/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Platform Engineer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Backend Engineer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Site Reliability Engineer" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "DevOps Engineer" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "London" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Remote, UK" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Berlin" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "Amsterdam" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByLabel("Salary floor")).toHaveValue("140,000");
  await expect(page.getByTestId("targets-match-count")).toHaveText("213");

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.setViewportSize({ width, height: contentHeight });

  await expect(page).toHaveScreenshot(`${String(width)}-${theme}.png`, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });

  await context.close();
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`the What you want step matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      onboardingServer,
    }) => {
      await expectOnboardingMatchesBoard(browser, onboardingServer.url, width, theme);
    });
  }
}
