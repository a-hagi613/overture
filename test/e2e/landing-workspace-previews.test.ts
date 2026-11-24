import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const CHAPTER = "#dashboard-preview";
const DESKTOP_MP4 = "/videos/workspace-demo-desktop.mp4";
const DESKTOP_POSTER = "/videos/workspace-demo-desktop-poster.png";
const MOBILE_MP4 = "/videos/workspace-demo-mobile.mp4";
const MOBILE_POSTER = "/videos/workspace-demo-mobile-poster.png";
const MP4_BUDGET_BYTES = 4 * 1024 * 1024;
const POSTER_BUDGET_BYTES = 1024 * 1024;
const screenshotDir = process.env.LANDING_SCREENSHOT_DIR;

type Theme = "dark" | "light";

async function openPlayer(
  browser: Browser,
  appUrl: string,
  viewport: { height: number; width: number },
  options: { reducedMotion?: "no-preference" | "reduce"; theme?: Theme } = {},
) {
  const context = await browser.newContext({ colorScheme: "light", viewport });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.emulateMedia({ reducedMotion: options.reducedMotion ?? "no-preference" });
  await page.addInitScript((theme) => {
    globalThis.localStorage.setItem("overture.theme", theme);
  }, options.theme ?? "light");
  await page.goto(`${appUrl}/#dashboard-preview`, { waitUntil: "load" });
  await page.locator(CHAPTER).scrollIntoViewIfNeeded();

  return { consoleErrors, context, page, pageErrors };
}

async function videoMetrics(page: Page) {
  return page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#dashboard-preview video");

    return {
      height: video?.videoHeight ?? 0,
      poster: video?.getAttribute("poster") ?? "",
      src: video?.getAttribute("src") ?? "",
      width: video?.videoWidth ?? 0,
    };
  });
}

async function expectPlaying(page: Page, playing: boolean) {
  await expect
    .poll(async () =>
      page.evaluate(
        () => document.querySelector<HTMLVideoElement>("#dashboard-preview video")?.paused ?? true,
      ),
    )
    .toBe(!playing);
}

function expectNoConsoleErrors(consoleErrors: string[], pageErrors: string[]) {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

test("both workspace demo recordings and posters ship inside the asset budget", () => {
  const assets = [
    { budget: MP4_BUDGET_BYTES, path: `public${DESKTOP_MP4}` },
    { budget: POSTER_BUDGET_BYTES, path: `public${DESKTOP_POSTER}` },
    { budget: MP4_BUDGET_BYTES, path: `public${MOBILE_MP4}` },
    { budget: POSTER_BUDGET_BYTES, path: `public${MOBILE_POSTER}` },
  ] as const;

  for (const asset of assets) {
    expect(existsSync(join(process.cwd(), asset.path)), asset.path).toBe(true);
    expect(statSync(join(process.cwd(), asset.path)).size, asset.path).toBeLessThanOrEqual(
      asset.budget,
    );
  }
});

test("the recordings and posters are served by the app with the right content type", async ({
  appServerUrl,
}) => {
  const responses = await Promise.all(
    [DESKTOP_MP4, DESKTOP_POSTER, MOBILE_MP4, MOBILE_POSTER].map(async (path) => {
      const response = await fetch(`${appServerUrl}${path}`);

      return {
        contentType: response.headers.get("content-type") ?? "",
        path,
        status: response.status,
      };
    }),
  );

  for (const response of responses) {
    expect(response.status, response.path).toBe(200);
    expect(response.contentType, response.path).toMatch(
      response.path.endsWith(".mp4") ? /^video\/mp4/u : /^image\/png/u,
    );
  }
});

test("the desktop walkthrough autoplays muted, loops, and its controls work", async ({
  appServerUrl,
  browser,
}) => {
  const { consoleErrors, context, page, pageErrors } = await openPlayer(browser, appServerUrl, {
    height: 860,
    width: 1280,
  });

  await expect(page.locator(`${CHAPTER} video`)).toHaveCount(1);
  await expect.poll(async () => (await videoMetrics(page)).width, { timeout: 15_000 }).toBe(1280);

  const metrics = await videoMetrics(page);

  expect(metrics.height).toBe(800);
  expect(metrics.src).toBe(DESKTOP_MP4);
  expect(metrics.poster).toBe(DESKTOP_POSTER);
  await expectPlaying(page, true);

  await page.getByRole("button", { name: "Pause walkthrough" }).click();
  await expectPlaying(page, false);
  await expect(page.getByRole("button", { name: "Play walkthrough" })).toBeVisible();

  await page.getByRole("button", { name: "Play walkthrough" }).click();
  await expectPlaying(page, true);

  await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>("#dashboard-preview video");

    if (video !== null) {
      video.currentTime = 3;
    }
  });
  await page.getByRole("button", { name: "Restart walkthrough" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.querySelector<HTMLVideoElement>("#dashboard-preview video")?.currentTime ?? 99,
      ),
    )
    .toBeLessThan(1.5);

  await page.getByRole("button", { name: "Open full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace walkthrough" });

  await expect(dialog).toBeVisible();
  await expect(dialog.locator("video")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  expectNoConsoleErrors(consoleErrors, pageErrors);
  await context.close();
});

test("the player swaps to the 9:16 phone walkthrough below lg without overflow", async ({
  appServerUrl,
  browser,
}) => {
  const { consoleErrors, context, page, pageErrors } = await openPlayer(browser, appServerUrl, {
    height: 844,
    width: 390,
  });

  await expect.poll(async () => (await videoMetrics(page)).width, { timeout: 15_000 }).toBe(720);

  const metrics = await videoMetrics(page);

  expect(metrics.height).toBe(1280);
  expect(metrics.src).toBe(MOBILE_MP4);
  expect(metrics.poster).toBe(MOBILE_POSTER);
  await expectPlaying(page, true);

  await expect
    .poll(async () =>
      page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth + 1),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Pause walkthrough" }).click();
  await expectPlaying(page, false);
  await page.getByRole("button", { name: "Open full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Workspace walkthrough" });

  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close walkthrough" }).click();
  await expect(dialog).toHaveCount(0);

  expectNoConsoleErrors(consoleErrors, pageErrors);
  await context.close();
});

test("resizing across the lg breakpoint swaps the recording in place", async ({
  appServerUrl,
  browser,
}) => {
  const { context, page } = await openPlayer(browser, appServerUrl, {
    height: 860,
    width: 1280,
  });

  await expect
    .poll(async () => (await videoMetrics(page)).src, { timeout: 15_000 })
    .toBe(DESKTOP_MP4);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect
    .poll(async () => (await videoMetrics(page)).src, { timeout: 15_000 })
    .toBe(MOBILE_MP4);
  await expect(page.locator(`${CHAPTER} video`)).toHaveCount(1);

  await page.setViewportSize({ height: 860, width: 1280 });
  await expect
    .poll(async () => (await videoMetrics(page)).src, { timeout: 15_000 })
    .toBe(DESKTOP_MP4);

  await context.close();
});

test("reduced motion holds the poster still until someone presses play", async ({
  appServerUrl,
  browser,
}) => {
  const { consoleErrors, context, page, pageErrors } = await openPlayer(
    browser,
    appServerUrl,
    { height: 860, width: 1280 },
    { reducedMotion: "reduce" },
  );

  await expect(page.locator(`${CHAPTER} video`)).toHaveCount(1);
  await expectPlaying(page, false);
  await expect(page.getByRole("button", { name: "Play walkthrough" })).toBeVisible();

  await page.getByRole("button", { name: "Play walkthrough" }).click();
  await expectPlaying(page, true);

  expectNoConsoleErrors(consoleErrors, pageErrors);
  await context.close();
});

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the workspace player is axe clean at ${String(width)} in ${theme} mode`, async ({
      appServerUrl,
      browser,
    }) => {
      const { context, page } = await openPlayer(
        browser,
        appServerUrl,
        { height: width === 390 ? 844 : 860, width },
        { reducedMotion: "reduce", theme },
      );

      const results = await new AxeBuilder({ page }).include(CHAPTER).analyze();

      expect(results.violations).toEqual([]);
      await expect
        .poll(async () =>
          page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth + 1),
        )
        .toBe(true);
      await context.close();
    });
  }
}

test("the player fits every layout width from 320 to 2560", async ({ appServerUrl, browser }) => {
  const { context, page } = await openPlayer(browser, appServerUrl, { height: 900, width: 1280 });
  const widths = [320, 390, 768, 1023, 1024, 1280, 1440, 2560] as const;

  const checkWidth = async (index: number) => {
    const width = widths[index];

    if (width === undefined) {
      return;
    }

    await page.setViewportSize({ height: width < 768 ? 844 : 900, width });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth + 1),
      )
      .toBe(true);
    await expect(page.locator(`${CHAPTER} video`)).toHaveCount(1);
    await checkWidth(index + 1);
  };

  await checkWidth(0);
  await context.close();
});

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`captures ${String(width)} ${theme} workspace player screenshots`, async ({
      appServerUrl,
      browser,
    }) => {
      test.skip(
        !screenshotDir,
        "LANDING_SCREENSHOT_DIR is set only for the screenshot capture run",
      );

      const { context, page } = await openPlayer(
        browser,
        appServerUrl,
        { height: width === 390 ? 844 : 860, width },
        { reducedMotion: "reduce", theme },
      );

      await expect(page.locator(`${CHAPTER} video`)).toHaveCount(1);
      await page.locator(CHAPTER).screenshot({
        path: `${screenshotDir ?? ""}/${String(width)}-${theme}-player.png`,
      });

      await page.getByRole("button", { name: "Open full screen" }).click();
      await expect(page.getByRole("dialog", { name: "Workspace walkthrough" })).toBeVisible();
      await page.screenshot({
        path: `${screenshotDir ?? ""}/${String(width)}-${theme}-expanded.png`,
      });

      await context.close();
    });
  }
}
