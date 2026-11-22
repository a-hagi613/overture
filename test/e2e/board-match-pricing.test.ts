import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import type { Browser, Page } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const boards = [
  { height: 1560, theme: "light", width: 1280 },
  { height: 1560, theme: "dark", width: 1280 },
  { height: 2700, theme: "light", width: 390 },
  { height: 2700, theme: "dark", width: 390 },
] as const;

const responsiveWidths = [390, 768, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;

const planFacts = {
  monthApps: 300,
  monthPrice: 35,
  trialApps: 3,
  weekApps: 70,
  weekPrice: 12,
} as const;

const atsNames = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"] as const;
const annotationPattern = /\bfig(?:ure)?\.?\s*\d|\bfolio\b|§|\bartboard\b|\bboard note\b/iu;

async function openPricing(page: Page, serverUrl: string, theme: string) {
  await page.addInitScript((mode) => {
    globalThis.localStorage.setItem("overture.theme", mode);
  }, theme);

  await page.goto(`${serverUrl}/pricing`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Pay for applications sent." }),
  ).toBeVisible();
  await page.waitForFunction(
    (mode) => mode !== "dark" || document.documentElement.classList.contains("dark"),
    theme,
  );
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });
}

async function assertMatchesBoard(
  browser: Browser,
  serverUrl: string,
  width: number,
  height: number,
  theme: string,
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height, width },
  });

  try {
    const page = await context.newPage();

    await openPricing(page, serverUrl, theme);

    const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    expect(contentHeight, `${String(width)}px ${theme} page height`).toBe(height);

    await expect(page).toHaveScreenshot(`${String(width)}-${theme}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.01,
    });
  } finally {
    await context.close();
  }
}

for (const board of boards) {
  test(`the pricing page matches the ${String(board.width)}px ${board.theme} board`, async ({
    appServerUrl,
    browser,
  }) => {
    await assertMatchesBoard(browser, appServerUrl, board.width, board.height, board.theme);
  });
}

test.describe("the pricing page keeps the product's facts", () => {
  test("the trial, Week and Month prices, allowances and renewal windows are all shown", async ({
    page,
    appServerUrl,
  }) => {
    await page.goto(`${appServerUrl}/pricing`);

    const text = await page.locator("body").textContent();

    await expect(page.getByText("Card verified", { exact: true })).toBeVisible();
    expect(text).toContain(`${String(planFacts.trialApps)} applications`);
    await expect(page.getByText("Once per card", { exact: true })).toBeVisible();
    expect(text).toContain(`$${String(planFacts.weekPrice)}`);
    await expect(
      page.getByText(`${String(planFacts.weekApps)} applications`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Renews every 7 days")).toBeVisible();
    expect(text).toContain(`$${String(planFacts.monthPrice)}`);
    await expect(
      page.getByText(`${String(planFacts.monthApps)} applications`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Renews every 30 days")).toBeVisible();
  });

  test("the five hiring systems ship, Workday never does, and the failure promise is stated", async ({
    page,
    appServerUrl,
  }) => {
    await page.goto(`${appServerUrl}/pricing`);

    const text = await page.locator("body").textContent();

    for (const ats of atsNames) {
      expect(text).toContain(ats);
    }

    expect(text).not.toMatch(/workday/iu);
    expect(text).toContain("Never charged for failure");
    expect(text).toContain("08:00 to 20:00 your local time");
    expect(text).not.toMatch(annotationPattern);
  });

  test("the pricing banner matches the landing banner", async ({ page, appServerUrl }) => {
    const banner = async (path: string) => {
      await page.goto(`${appServerUrl}${path}`);

      const header = page.getByRole("banner");
      const footer = page.getByRole("contentinfo");

      await expect(header).toBeVisible();
      await expect(footer).toBeVisible();

      return {
        footerHrefs: await footer
          .locator("a")
          .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        footerText: await footer.textContent(),
        headerHrefs: await header
          .locator("a")
          .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        headerText: await header.textContent(),
      };
    };

    const landing = await banner("/");
    const pricing = await banner("/pricing");

    expect(pricing.headerText).toBe(landing.headerText);
    expect(pricing.headerHrefs).toEqual(landing.headerHrefs);
    expect(pricing.footerText).toBe(landing.footerText);
    expect(pricing.footerHrefs).toEqual(landing.footerHrefs);
  });
});

test.describe("the pricing page at every width", () => {
  for (const width of responsiveWidths) {
    for (const theme of themes) {
      test(`${String(width)} ${theme} has no horizontal overflow and is axe clean`, async ({
        page,
        appServerUrl,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await openPricing(page, appServerUrl, theme);

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

test("the pricing page exports the reviewed screenshots", async ({ browser, appServerUrl }) => {
  mkdirSync(join(process.cwd(), "test/e2e/.tmp/pricing"), { recursive: true });

  await Promise.all(
    boards.map(async (board) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        viewport: { height: board.height, width: board.width },
      });

      try {
        const page = await context.newPage();

        await openPricing(page, appServerUrl, board.theme);

        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          path: join(
            process.cwd(),
            `test/e2e/.tmp/pricing/${String(board.width)}-${board.theme}.png`,
          ),
        });
      } finally {
        await context.close();
      }
    }),
  );
});
