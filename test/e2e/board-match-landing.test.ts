import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import type { Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const shotWidths = [390, 1280] as const;
const widths = [390, 768, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;

const headline = "Overture prepares every application. It sends only when you approve.";

async function settle(page: Page, appServerUrl: string, theme: string) {
  await page.addInitScript((mode) => {
    globalThis.localStorage.setItem("overture.theme", mode);
  }, theme);

  await page.goto(`${appServerUrl}/`);
  await expect(page.getByRole("heading", { level: 1, name: headline })).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });
}

test.describe("the public landing at every width", () => {
  for (const width of widths) {
    for (const theme of themes) {
      test(`${String(width)} ${theme} has no horizontal overflow and is axe clean`, async ({
        page,
        appServerUrl,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await settle(page, appServerUrl, theme);

        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        expect(overflow.scrollWidth, `${String(width)}px ${theme}`).toBeLessThanOrEqual(
          overflow.clientWidth,
        );

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);
      });
    }
  }
});

test.describe("the landing keeps the product's facts", () => {
  test("the hero example, the five systems and the prices are all on the page", async ({
    page,
    appServerUrl,
  }) => {
    await page.goto(`${appServerUrl}/`);

    await expect(page.getByText("The posting asks", { exact: true })).toBeVisible();
    await expect(page.getByText("Your resume", { exact: true })).toBeVisible();
    await expect(page.getByText("Ready to send", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Five applicant tracking systems")).toBeVisible();
    await expect(page.getByText(/Applies where companies actually hire/u)).toBeVisible();
    await expect(page.getByText("$12", { exact: true })).toBeVisible();
    await expect(page.getByText("$35", { exact: true })).toBeVisible();
    await expect(page.getByText("Never charged for failure")).toBeVisible();
    await expect(page.getByText("Does Overture edit my resume?")).toBeVisible();
  });

  test("no canvas annotations or retired copy ship", async ({ page, appServerUrl }) => {
    await page.goto(`${appServerUrl}/`);

    const text = await page.locator("body").textContent();

    expect(text).not.toMatch(/\bfig(?:ure)?\.?\s*\d|\bfolio\b|§|artboard|sample data/iu);
    expect(text).not.toMatch(/workday|smartrecruiters|recruitee/iu);
    expect(text).not.toMatch(/no credit card/iu);
    expect(text).not.toMatch(/\bhold\b/iu);
    expect(text).not.toMatch(/answer bank/iu);
    expect(text).not.toMatch(/gmail/iu);
  });
});

test.describe("the landing screenshots for review", () => {
  for (const width of shotWidths) {
    for (const theme of themes) {
      test(`${String(width)} ${theme} renders the canvas composition`, async ({
        page,
        appServerUrl,
      }) => {
        mkdirSync(join(process.cwd(), "test/e2e/.tmp/landing"), { recursive: true });

        await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
        await settle(page, appServerUrl, theme);

        await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
        await expect(page.getByText("Every reply, read and sorted.")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Start with three applications." }),
        ).toBeVisible();
        await expect(
          page.getByRole("contentinfo").getByText("Overture", { exact: true }),
        ).toBeVisible();

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          path: join(process.cwd(), `test/e2e/.tmp/landing/${String(width)}-${theme}.png`),
        });
      });
    }
  }
});
