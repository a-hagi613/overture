import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedBoardOwner } from "./board-harness.ts";

const test = appTest.extend<{ trackerServer: AppServer }>({
  trackerServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const SHOT_DIR = process.env.TRACKER_SHOT_DIR ?? null;
const SHEET = 'dialog[aria-label="Application detail"]';

async function openTracker(
  browser: Browser,
  appServerUrl: string,
  width: number,
  options: { path?: string; theme?: "light" | "dark" } = {},
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const userId = await seedBoardOwner(request, appServerUrl);
  const { selectedId } = await seedBoard(request, userId);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
  });

  const page = await context.newPage();

  await page.setViewportSize({ height: width >= 1024 ? 900 : 844, width });

  if (options.theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "1");
  });

  await page.goto(`${appServerUrl}/tracker${options.path ?? ""}`);
  await expect(page.getByRole("heading", { level: 1, name: "Application Tracker" })).toBeVisible();

  return { context, page, selectedId };
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("the tracker board shows Queue, Applied and Interviews with Closed behind a filter", async ({
  trackerServer,
  browser,
}) => {
  const { context, page } = await openTracker(browser, trackerServer.url, 1280);

  await Promise.all(
    ["Queue", "Applied", "Interviews"].map(async (column) => {
      await expect(page.locator(`section[aria-label="${column}"]`)).toBeVisible();
    }),
  );

  await expect(page.locator('section[aria-label="Closed"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show closed/u })).toBeVisible();

  await expect(page.getByText("Needs your answer").first()).toBeVisible();
  await expect(page.getByText("Ready to send").first()).toBeVisible();
  await expect(page.getByText("Queued · sends at 2:20 PM", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirming", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Show closed/u }).click();
  await expect(page.locator('section[aria-label="Closed"]')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  await context.close();
});

for (const width of [390, 768, 1024, 1280, 1440, 1920, 2560]) {
  test(`the tracker board has no horizontal scroll at ${String(width)}px`, async ({
    trackerServer,
    browser,
  }) => {
    const { context, page } = await openTracker(browser, trackerServer.url, width, {
      path: "?view=board",
    });

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await context.close();
  });
}

test("a shared ?application= link opens the job drawer and browser Back closes it", async ({
  trackerServer,
  browser,
}) => {
  const { context, page, selectedId } = await openTracker(browser, trackerServer.url, 1280);

  await page.goto(`${trackerServer.url}/tracker?application=${encodeURIComponent(selectedId)}`);

  const drawer = page.getByRole("dialog", { name: "Application detail" });

  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Senior Backend Engineer" })).toBeVisible();

  await page.goBack();

  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/\/tracker(?:\?.*)?$/u);

  await context.close();
});

test("opening a card writes ?application= and Back closes the drawer", async ({
  trackerServer,
  browser,
}) => {
  const { context, page } = await openTracker(browser, trackerServer.url, 1280);

  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the applied card has no id");
  }

  await card.click();
  await expect(page).toHaveURL(new RegExp(`[?&]application=${id}`, "u"));
  await expect(page.locator(SHEET)).toBeVisible();

  await page.goBack();
  await expect(page.locator(SHEET)).toHaveCount(0);

  await context.close();
});

test("⌘K searches applications and opens the selected job drawer", async ({
  trackerServer,
  browser,
}) => {
  const { context, page } = await openTracker(browser, trackerServer.url, 1280);

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();

  await page.getByPlaceholder("Search applications, reviews, emails").fill("Ostrander");

  const result = page.getByRole("option", { name: /Ostrander Freight/u }).first();

  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(/\/tracker\?.*application=/u);
  await expect(page.locator(SHEET)).toBeVisible();

  await context.close();
});

test("captures the tracker board at 390 and 1280 in light and dark", async ({
  trackerServer,
  browser,
}) => {
  if (SHOT_DIR === null) {
    test.skip();

    return;
  }

  mkdirSync(SHOT_DIR, { recursive: true });

  const request = await apiRequest.newContext({ baseURL: trackerServer.url });
  const userId = await seedBoardOwner(request, trackerServer.url);

  await seedBoard(request, userId);

  const storageState = await request.storageState();

  await request.dispose();

  const combinations = [
    { path: "?view=board&filter=queue", theme: "light" as const, width: 390 },
    { path: "?view=board&filter=queue", theme: "dark" as const, width: 390 },
    { path: "", theme: "light" as const, width: 1280 },
    { path: "", theme: "dark" as const, width: 1280 },
  ];

  await Promise.all(
    combinations.map(async ({ path, theme, width }) => {
      const context = await browser.newContext({
        storageState,
        timezoneId: "America/Toronto",
      });

      const page = await context.newPage();

      await page.setViewportSize({ height: width >= 1024 ? 900 : 844, width });

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await page.goto(`${trackerServer.url}/tracker${path}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Application Tracker" }),
      ).toBeVisible();
      await expect(
        page.locator("button[data-card]").filter({ visible: true }).first(),
      ).toBeVisible();

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await page.screenshot({
        animations: "disabled",
        caret: "hide",
        fullPage: width >= 1024,
        path: join(SHOT_DIR, `${String(width)}-${theme}.png`),
      });

      await context.close();
    }),
  );
});
