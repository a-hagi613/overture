import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, BrowserContext, Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

const screenshotDir = join("parity-captures", "not-found");
const boardWidths = [390, 1440] as const;
const sweepWidths = [390, 768, 1024, 1280, 1440, 1920, 2560] as const;

async function openNotFound(
  browser: Browser,
  appServerUrl: string,
  storageState: StorageState,
  width: number,
  theme: string,
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: width === 390 ? 844 : 900, width },
  });

  const page = await context.newPage();

  await page.addInitScript((value) => {
    globalThis.localStorage.setItem("overture.theme", value);
  }, theme);
  await page.goto(`${appServerUrl}/this-page-does-not-exist`);

  return { context, page };
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const width of boardWidths) {
  for (const theme of ["light", "dark"] as const) {
    test(`the 404 page renders the board content at ${String(width)} ${theme}`, async ({
      browser,
      appServerUrl,
      ownerStorageState,
    }) => {
      const { context, page } = await openNotFound(
        browser,
        appServerUrl,
        ownerStorageState,
        width,
        theme,
      );

      await expect(page.getByRole("heading", { level: 1, name: "Page not found." })).toBeVisible();
      await expect(page.getByText("This page has moved on, or never existed.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
      await expect(page.getByRole("link", { name: "Open the Board" })).toHaveAttribute(
        "href",
        "/board",
      );

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);
      expect(await horizontalOverflow(page), `${String(width)}px ${theme} overflow`).toBe(0);

      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        fullPage: true,
        path: join(screenshotDir, `${String(width)}-${theme}.png`),
      });
      await context.close();
    });
  }
}

for (const width of sweepWidths) {
  test(`the 404 page has no horizontal overflow at ${String(width)}`, async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const { context, page } = await openNotFound(
      browser,
      appServerUrl,
      ownerStorageState,
      width,
      "light",
    );

    await expect(page.getByRole("heading", { level: 1, name: "Page not found." })).toBeVisible();
    expect(await horizontalOverflow(page), `${String(width)}px overflow`).toBe(0);
    await context.close();
  });
}
