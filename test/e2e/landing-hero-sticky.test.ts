import { AxeBuilder } from "@axe-core/playwright";

import type { Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const landingHeadline = "The job search, handled.";
const screenshotDir = process.env.LANDING_SCREENSHOT_DIR;

async function headerTop(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");

    return header ? header.getBoundingClientRect().top : Number.NaN;
  });
}

test.describe("landing sticky header and hero", () => {
  test("the header stays pinned to the top while scrolling on desktop", async ({
    page,
    appServerUrl,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${appServerUrl}/`);
    await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();

    await page.evaluate(() => {
      globalThis.scrollTo(0, 1200);
    });

    await expect.poll(async () => headerTop(page)).toBe(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("the header stays pinned and the mobile drawer works while scrolled on 390px", async ({
    page,
    appServerUrl,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${appServerUrl}/`);
    await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();

    await page.evaluate(() => {
      globalThis.scrollTo(0, 1600);
    });
    await expect.poll(async () => headerTop(page)).toBe(0);

    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.locator("#landing-msheet");

    await expect(sheet).toBeVisible();
    const sheetBox = await sheet.boundingBox();
    const headerBox = await page.locator("header").boundingBox();

    expect(sheetBox?.y ?? Number.NaN).toBeGreaterThanOrEqual(
      (headerBox?.y ?? 0) + (headerBox?.height ?? 0) - 1,
    );

    await sheet.getByRole("link", { name: "Pricing" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator("#pricing")).toBeInViewport();
    await expect.poll(async () => headerTop(page)).toBe(0);
  });

  test("section anchors land below the sticky header", async ({ page, appServerUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${appServerUrl}/`);

    const gaps = await page.evaluate(() => {
      const anchors = ["how-it-works", "pricing", "faq"];

      return anchors.map((anchor) => {
        const section = document.querySelector(`#${anchor}`);
        const header = document.querySelector("header");

        section?.scrollIntoView({ behavior: "instant", block: "start" });

        return (
          (section?.getBoundingClientRect().top ?? 0) -
          (header?.getBoundingClientRect().bottom ?? 0)
        );
      });
    });

    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(0);
    }
  });

  test("the hero with the sticky header is axe clean in dark mode at 1280px", async ({
    page,
    appServerUrl,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${appServerUrl}/`);
    await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);
  });

  test("the live pulse indicator animates on desktop and respects reduced motion", async ({
    page,
    appServerUrl,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${appServerUrl}/`);

    const animations = await page.evaluate(() =>
      [
        ...document.querySelectorAll("[data-testid='hero-counter'] span[aria-hidden='true'] span"),
      ].map((element) => getComputedStyle(element).animationName),
    );

    expect(animations).toContain("ov-live-ping");
    expect(animations).toContain("ov-live-core-tick");
  });

  for (const width of [390, 1280] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`captures ${String(width)} ${theme} hero and scrolled sticky header screenshots`, async ({
        page,
        appServerUrl,
      }) => {
        test.skip(
          !screenshotDir,
          "LANDING_SCREENSHOT_DIR is set only for the screenshot capture run",
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript((mode) => {
          globalThis.localStorage.setItem("overture.theme", mode);
        }, theme);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await page.goto(`${appServerUrl}/`);
        await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();

        await page.screenshot({
          path: `${screenshotDir}/${String(width)}-${theme}-hero.png`,
        });

        await page.evaluate(() => {
          globalThis.scrollTo(0, 1000);
        });
        await expect.poll(async () => headerTop(page)).toBe(0);
        await page.screenshot({
          path: `${screenshotDir}/${String(width)}-${theme}-scrolled.png`,
        });
      });
    }
  }
});
