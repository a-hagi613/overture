import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { readyStorageState } from "./ready-harness.ts";

const test = appTest.extend<{ readyServer: AppServer }>({
  readyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function expectReadyMatches(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const storageState = await readyStorageState(appServerUrl);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: 800, width },
  });

  const page = await context.newPage();

  await page.clock.setFixedTime(new Date(2026, 10, 21, 12, 0, 0));

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "0");
  });

  await page.goto(`${appServerUrl}/ready`);

  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeVisible();
  await expect(page.getByText("2 ready · 1 approved")).toBeVisible();
  await expect(page.getByText("Approved · sending around 14:20")).toBeVisible();
  await expect(page.getByText("Resume: maya-okafor-2026.pdf").first()).toBeVisible();
  await expect(page.getByText("7 of 10 sent today", { exact: true })).toBeVisible();

  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });
  await page.waitForLoadState("networkidle");

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
    test(`the Ready page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      readyServer,
    }) => {
      await expectReadyMatches(browser, readyServer.url, width, theme);
    });
  }
}
