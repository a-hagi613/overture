import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

async function openProfile(page: Page, appServerUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/profile`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
}

async function expectProfileMatchesBoard(
  browser: Browser,
  ownerStorageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const profilePage = await context.newPage();

  await profilePage.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
  await openProfile(profilePage, appServerUrl, theme);

  const results = await new AxeBuilder({ page: profilePage }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const contentHeight = await profilePage.evaluate(() => document.documentElement.scrollHeight);

  await profilePage.setViewportSize({ width, height: contentHeight });
  await expect(profilePage).toHaveScreenshot(`${String(width)}-${theme}.png`, {
    maxDiffPixelRatio: 0.01,
  });
  await context.close();
}

test("the Profile page matches the board at 1280px in light", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  await expectProfileMatchesBoard(browser, ownerStorageState, appServerUrl, 1280, "light");
});

test("the Profile page matches the board at 1280px in dark", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  await expectProfileMatchesBoard(browser, ownerStorageState, appServerUrl, 1280, "dark");
});

test("the Profile page matches the board at 390px in light", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  await expectProfileMatchesBoard(browser, ownerStorageState, appServerUrl, 390, "light");
});

test("the Profile page matches the board at 390px in dark", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  await expectProfileMatchesBoard(browser, ownerStorageState, appServerUrl, 390, "dark");
});
