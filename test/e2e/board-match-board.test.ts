import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { openBoard, seedBoard, seedBoardOwner } from "./board-harness.ts";

const test = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function expectBoardMatches(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  const userId = await seedBoardOwner(request, appServerUrl);
  const { selectedId } = await seedBoard(request, userId);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "1");
  });

  await openBoard(page, appServerUrl, width, selectedId);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Senior Backend Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByText("Twenty-nine applications across six stages").filter({ visible: true }),
  ).toBeVisible();

  if (width === 1280) {
    await expect(
      page.getByText("Checking with the employer").filter({ visible: true }),
    ).toBeVisible();
  }

  if (width === 1280) {
    await expect(page.getByText("63", { exact: true }).filter({ visible: true })).toBeVisible();
  } else {
    await expect(page.getByText("63 left").filter({ visible: true })).toBeVisible();
  }

  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const contentHeight =
    width === 1280 ? 1110 : await page.evaluate(() => document.documentElement.scrollHeight);

  await page.setViewportSize({ width, height: contentHeight });
  await expect(page).toHaveScreenshot(`${String(width)}-${theme}.png`, {
    maxDiffPixelRatio: 0.01,
  });
  await context.close();
}

for (const width of [1280]) {
  for (const theme of ["light", "dark"]) {
    test(`the Board page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      boardServer,
    }) => {
      await expectBoardMatches(browser, boardServer.url, width, theme);
    });
  }
}
