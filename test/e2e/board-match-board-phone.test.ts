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

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

async function expectPhoneBoardMatches(browser: Browser, appServerUrl: string, theme: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  const userId = await seedBoardOwner(request, appServerUrl);
  const { selectedId } = await seedBoard(request, userId);
  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "1");
  });

  await openBoard(page, appServerUrl, PHONE_WIDTH, selectedId);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Senior Backend Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByText("Track every application from match to decision.").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Stages" })).toBeVisible();
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

  expect(results.violations, theme).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, theme).toBe(false);
  await context.close();
}

for (const theme of ["light", "dark"]) {
  test(`the Board page matches the phone board in ${theme}`, async ({ browser, boardServer }) => {
    await expectPhoneBoardMatches(browser, boardServer.url, theme);
  });
}
