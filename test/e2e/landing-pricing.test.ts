import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const PLAN = {
  monthApps: 250,
  monthPrice: "$29.99",
  weekApps: 50,
  weekDays: 7,
  weekPrice: "$9.99",
};

const TRIAL_APPS = 3;
const PAID_GAP_MINUTES = 5;
const PUBLIC_ATS = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"];

const widths = [390, 768, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;

const landingHeadline = "The job search, handled.";
const annotationPattern = /\bfig(?:ure)?\.?\s*\d|\bfolio\b|§|\bartboard\b|\bboard note\b/iu;

async function noScriptPage(browser: Browser, url: string) {
  const context = await browser.newContext({ javaScriptEnabled: false });

  try {
    const page = await context.newPage();

    await page.goto(url);

    return {
      html: await page.content(),
      text: await page.locator("body").textContent(),
    };
  } finally {
    await context.close();
  }
}

test.describe("public landing and embedded pricing, readable without JavaScript", () => {
  test("the landing reads in full with JavaScript disabled and links to sign-in, sign-up, Terms, Privacy, and pricing", async ({
    browser,
    appServerUrl,
  }) => {
    const { html, text } = await noScriptPage(browser, `${appServerUrl}/`);

    expect(text).toContain("The job search,");
    expect(text).toContain("handled.");
    expect(text).toContain("Pay only for applications sent.");
    expect(text).toContain(PLAN.weekPrice);
    expect(text).toContain(`${String(PLAN.weekApps)} confirmed applications`);
    expect(text).toContain(PLAN.monthPrice);
    expect(text).toContain(`${String(PLAN.monthApps)} confirmed applications`);
    expect(text).toContain(`${String(TRIAL_APPS)} confirmed applications`);
    expect(text).toContain(`over ${String(PLAN.weekDays)} days`);
    expect(html).toContain('href="/signin"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="#pricing"');
    expect(text).toContain(
      `the trial's ${String(TRIAL_APPS)} together, then paid sends about ${String(PAID_GAP_MINUTES)} minutes apart`,
    );
  });

  test("the landing lists the supported hiring systems, never Workday, and has no canvas annotations", async ({
    browser,
    appServerUrl,
  }) => {
    const { text, html } = await noScriptPage(browser, `${appServerUrl}/`);

    for (const ats of PUBLIC_ATS) {
      expect(text).toContain(ats);
    }

    expect(html).not.toMatch(/workday/iu);
    expect(text).not.toMatch(annotationPattern);
  });
});

test.describe("public landing served and checked in the browser", () => {
  test("the landing screen is reachable, axe clean, shows pricing and the workspace walkthrough", async ({
    page,
    appServerUrl,
  }) => {
    await page.goto(appServerUrl);
    await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();
    await expect(page).toHaveURL(`${appServerUrl}/`);
    await expect(
      page.getByRole("heading", { level: 2, name: "Pay only for applications sent." }),
    ).toBeVisible();

    const workspace = page.locator("#dashboard-preview");

    await workspace.scrollIntoViewIfNeeded();
    await expect(workspace.locator("video")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play walkthrough" })).toBeVisible();

    const landing = await new AxeBuilder({ page }).analyze();

    expect(landing.violations).toEqual([]);
  });

  for (const width of widths) {
    for (const theme of themes) {
      test(`/ at ${String(width)} ${theme} has no horizontal overflow and is axe clean`, async ({
        page,
        appServerUrl,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript((mode) => {
          globalThis.localStorage.setItem("overture.theme", mode);
        }, theme);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${appServerUrl}/`);
        await expect(page.locator("h1").first()).toBeVisible();

        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations).toEqual([]);
      });
    }
  }
});

test("the mobile header shows Start free trial and menu toggle, and desktop shows section links", async ({
  page,
  appServerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(appServerUrl);

  const header = page.locator("header");

  await expect(header.getByRole("link", { name: "How it works" })).toBeHidden();
  await expect(header.getByRole("link", { name: "Start free trial" }).first()).toBeVisible();
  await expect(header.getByRole("button", { name: "Open menu" })).toBeVisible();

  await header.getByRole("button", { name: "Open menu" }).click();
  await expect(header.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(header.getByRole("link", { name: "How it works" }).first()).toBeVisible();
  await expect(header.getByRole("link", { name: "Pricing", exact: true }).first()).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});
