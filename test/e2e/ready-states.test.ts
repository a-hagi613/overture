import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { request as apiRequest } from "@playwright/test";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedProfile, seedReady } from "./ready-harness.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface Seeded {
  server: AppServer;
  storageState: StorageState;
}

const test = appTest.extend<object, { seededReady: Seeded; seededEmpty: Seeded }>({
  seededReady: [
    async ({ _identityServerWorker }, provide) => {
      const server = await startFreshAppServer(_identityServerWorker);
      const request = await apiRequest.newContext({ baseURL: server.url });

      await seedReady(request, server.url);
      const storageState = await request.storageState();

      await request.dispose();
      await provide({ server, storageState });
      await server.stop();
    },
    { scope: "worker" },
  ],
  seededEmpty: [
    async ({ _identityServerWorker }, provide) => {
      const server = await startFreshAppServer(_identityServerWorker);
      const request = await apiRequest.newContext({ baseURL: server.url });

      await seedProfile(request, server.url);
      const storageState = await request.storageState();

      await request.dispose();
      await provide({ server, storageState });
      await server.stop();
    },
    { scope: "worker" },
  ],
});

const timeZone = "America/Toronto";
const readyApi = "**/api/ready";
const loadingLabel = "Loading your Ready list";
const emptyTitle = "Nothing to approve right now.";
const errorTitle = "Ready could not load.";
const staleWarning = "Could not refresh Ready. The cards below may be out of date.";
const retryLabel = "Try again";
const widths = [390, 1280, 1920, 2560] as const;
const themes = ["light", "dark"] as const;
const states = ["loading", "error", "stale", "empty"] as const;

const screenshotDirectory = process.env.READY_STATE_SCREENSHOTS;

async function openReady(
  browser: Browser,
  storageState: StorageState,
  width: number,
  theme: (typeof themes)[number],
) {
  const context = await browser.newContext({
    storageState,
    timezoneId: timeZone,
    viewport: { height: 900, width },
  });

  await context.addInitScript((stored) => {
    globalThis.localStorage.setItem("overture.theme", stored);
  }, theme);

  return { context, page: await context.newPage() };
}

function loadingStatus(page: Page) {
  return page.getByRole("status", { name: loadingLabel });
}

function errorAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: errorTitle });
}

function staleAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: staleWarning });
}

function northwind(page: Page) {
  return page.getByRole("heading", { level: 2, name: "Northwind Labs" });
}

async function refetchInBackground(page: Page) {
  await page.evaluate(() => {
    globalThis.dispatchEvent(new Event("visibilitychange"));
  });
}

test("Ready shows a loading status, then a retryable error that recovers on Retry", async ({
  browser,
  seededReady,
}) => {
  const { context, page } = await openReady(browser, seededReady.storageState, 1280, "light");
  const release = Promise.withResolvers<undefined>();

  await page.route(readyApi, async (route) => {
    await release.promise;
    await route.fulfill({ status: 500 });
  });
  await page.goto(`${seededReady.server.url}/ready`);

  await expect(loadingStatus(page)).toBeVisible();
  await expect(page.getByText(emptyTitle)).toHaveCount(0);

  release.resolve();

  const alert = errorAlert(page);

  await expect(alert).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(emptyTitle)).toHaveCount(0);
  await expect(loadingStatus(page)).toHaveCount(0);

  const retry = alert.getByRole("button", { name: retryLabel });
  const box = await retry.boundingBox();

  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.unroute(readyApi);
  await retry.click();

  await expect(alert).toHaveCount(0);
  await expect(northwind(page)).toBeVisible();

  await context.close();
});

test("Ready keeps the cached cards and warns when a background refresh fails", async ({
  browser,
  seededReady,
}) => {
  const { context, page } = await openReady(browser, seededReady.storageState, 1280, "light");

  await page.goto(`${seededReady.server.url}/ready`);
  await expect(northwind(page)).toBeVisible();

  await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
  await refetchInBackground(page);

  const warning = staleAlert(page);

  await expect(warning).toBeVisible({ timeout: 20_000 });
  await expect(northwind(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Halden Systems" })).toBeVisible();
  await expect(errorAlert(page)).toHaveCount(0);
  await expect(page.getByText(emptyTitle)).toHaveCount(0);

  await page.unroute(readyApi);
  await warning.getByRole("button", { name: retryLabel }).click();

  await expect(warning).toHaveCount(0);
  await expect(northwind(page)).toBeVisible();

  await context.close();
});

test("keyboard Enter on Try again returns focus to the Ready heading after the error recovers", async ({
  browser,
  seededReady,
}) => {
  const { context, page } = await openReady(browser, seededReady.storageState, 1280, "light");

  await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
  await page.goto(`${seededReady.server.url}/ready`);

  const alert = errorAlert(page);

  await expect(alert).toBeVisible({ timeout: 20_000 });
  await page.unroute(readyApi);

  const retry = alert.getByRole("button", { name: retryLabel });

  await retry.focus();
  await page.keyboard.press("Enter");

  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeFocused();

  await context.close();
});

test("keyboard Enter on Try again in the stale warning returns focus to the Ready heading", async ({
  browser,
  seededReady,
}) => {
  const { context, page } = await openReady(browser, seededReady.storageState, 1280, "light");

  await page.goto(`${seededReady.server.url}/ready`);
  await expect(northwind(page)).toBeVisible();

  await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
  await refetchInBackground(page);

  const warning = staleAlert(page);

  await expect(warning).toBeVisible({ timeout: 20_000 });
  await page.unroute(readyApi);

  const retry = warning.getByRole("button", { name: retryLabel });

  await retry.focus();
  await page.keyboard.press("Enter");

  await expect(warning).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).toBeFocused();

  await context.close();
});

test("a retry that fails again does not move focus when a later refresh recovers", async ({
  browser,
  seededReady,
}) => {
  const { context, page } = await openReady(browser, seededReady.storageState, 1280, "light");

  await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
  await page.goto(`${seededReady.server.url}/ready`);

  const alert = errorAlert(page);

  await expect(alert).toBeVisible({ timeout: 20_000 });
  await alert.getByRole("button", { name: retryLabel }).click();
  await expect(alert.getByRole("button", { name: retryLabel })).toBeVisible({ timeout: 20_000 });

  await page.unroute(readyApi);
  await refetchInBackground(page);

  await expect(alert).toHaveCount(0);
  await expect(northwind(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Ready to send" })).not.toBeFocused();

  await context.close();
});

test("Ready shows the empty state only after a clean, empty fetch", async ({
  browser,
  seededEmpty,
}) => {
  const { context, page } = await openReady(browser, seededEmpty.storageState, 1280, "light");

  await page.goto(`${seededEmpty.server.url}/ready`);

  await expect(page.getByText(emptyTitle)).toBeVisible();
  await expect(loadingStatus(page)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await context.close();
});

for (const theme of themes) {
  for (const width of widths) {
    for (const state of states) {
      test(`the ${state} state at ${String(width)}px, ${theme}, has no horizontal overflow and no axe violations`, async ({
        browser,
        seededEmpty,
        seededReady,
      }) => {
        const seeded = state === "empty" ? seededEmpty : seededReady;
        const { context, page } = await openReady(browser, seeded.storageState, width, theme);
        const pageUrl = `${seeded.server.url}/ready`;

        if (state === "loading") {
          const never = Promise.withResolvers<undefined>();

          await page.route(readyApi, async () => {
            await never.promise;
          });
          await page.goto(pageUrl);
          await expect(loadingStatus(page)).toBeVisible();
        } else if (state === "error") {
          await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
          await page.goto(pageUrl);
          await expect(errorAlert(page)).toBeVisible({ timeout: 20_000 });
        } else if (state === "stale") {
          await page.goto(pageUrl);
          await expect(northwind(page)).toBeVisible();
          await page.route(readyApi, async (route) => route.fulfill({ status: 500 }));
          await refetchInBackground(page);
          await expect(staleAlert(page)).toBeVisible({ timeout: 20_000 });
        } else {
          await page.goto(pageUrl);
          await expect(page.getByText(emptyTitle)).toBeVisible();
        }

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );

        expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations).toEqual([]);

        if (screenshotDirectory !== undefined && (width === 390 || width === 1280)) {
          mkdirSync(screenshotDirectory, { recursive: true });
          const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);

          await page.setViewportSize({ height: fullHeight, width });
          await page.screenshot({
            fullPage: true,
            path: join(screenshotDirectory, `${state}-${String(width)}-${theme}.png`),
          });
        }

        await context.close();
      });
    }
  }
}
