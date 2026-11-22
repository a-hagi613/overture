import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";

import { expect, test } from "./app.fixture.ts";

const PLAN = { weekPrice: 12, weekApps: 70, weekDays: 7, monthPrice: 35, monthApps: 300 };
const TRIAL_APPS = 3;
const SEND = { startHour: 8, endHour: 20 };
const PUBLIC_ATS = ["Greenhouse", "Lever", "Ashby", "Personio", "Workable"];

const widths = [390, 768, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;

const landingHeadline = "Overture prepares every application. It sends only when you approve.";
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

test.describe("public landing and pricing, readable without JavaScript", () => {
  test("the landing reads in full with JavaScript disabled and links to sign-in, Terms and Privacy", async ({
    browser,
    appServerUrl,
  }) => {
    const { html, text } = await noScriptPage(browser, `${appServerUrl}/`);

    expect(html).toContain(landingHeadline);
    expect(text).toContain(`The trial is ${String(TRIAL_APPS)} applications, once per card.`);
    expect(text).toContain("Five applicant tracking systems");
    expect(text).toContain("Never charged for failure");
    expect(html).toContain('href="/signin"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/pricing"');
    expect(text).toMatch(/Approve the ones you want/u);
    expect(text).toContain(
      `Send goes out in daytime hours, ${String(SEND.startHour).padStart(2, "0")}:00 to ${String(SEND.endHour).padStart(2, "0")}:00`,
    );
  });

  test("the pricing page reads in full with JavaScript disabled and shows the configured prices", async ({
    browser,
    appServerUrl,
  }) => {
    const { html, text } = await noScriptPage(browser, `${appServerUrl}/pricing`);

    expect(html).toContain("Pay for applications sent.");
    expect(text).toContain(`$${String(PLAN.weekPrice)}`);
    expect(text).toContain(`${String(PLAN.weekApps)} applications`);
    expect(text).toContain(`$${String(PLAN.monthPrice)}`);
    expect(text).toContain(`${String(PLAN.monthApps)} applications`);
    expect(text).toContain(`${String(TRIAL_APPS)} applications`);
    expect(text).toContain(
      `$${String(PLAN.weekPrice)} for ${String(PLAN.weekApps)} applications over ${String(PLAN.weekDays)} days`,
    );
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  for (const path of ["/", "/pricing"]) {
    test(`${path} has the five hiring systems, never Workday, no full-automation claim, and no canvas annotations`, async ({
      browser,
      appServerUrl,
    }) => {
      const { text, html } = await noScriptPage(browser, `${appServerUrl}${path}`);

      for (const ats of PUBLIC_ATS) {
        expect(text).toContain(ats);
      }

      expect(html).not.toMatch(/workday/iu);
      expect(text).not.toMatch(
        /fully automat|full automation|automatically applies|fully automated/iu,
      );
      expect(text).not.toMatch(annotationPattern);
    });
  }
});

test.describe("public landing and pricing, served and checked in the browser", () => {
  test("the landing and pricing screens are reachable, axe clean, and show the headline for a visitor", async ({
    page,
    appServerUrl,
  }) => {
    await page.goto(appServerUrl);
    await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();
    await expect(page).toHaveURL(`${appServerUrl}/`);

    const landing = await new AxeBuilder({ page }).analyze();

    expect(landing.violations).toEqual([]);

    await page.goto(`${appServerUrl}/pricing`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pay for applications sent." }),
    ).toBeVisible();

    const pricing = await new AxeBuilder({ page }).analyze();

    expect(pricing.violations).toEqual([]);
  });

  for (const path of ["/", "/pricing"]) {
    for (const width of widths) {
      for (const theme of themes) {
        test(`${path} at ${String(width)} ${theme} has no horizontal overflow and is axe clean`, async ({
          page,
          appServerUrl,
        }) => {
          await page.addInitScript((mode) => {
            globalThis.localStorage.setItem("overture.theme", mode);
          }, theme);
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${appServerUrl}${path}`);
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
  }
});

test("the mobile header shows only Sign in, Pricing stays in the footer, and section links return on wider screens", async ({
  page,
  appServerUrl,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(appServerUrl);
  await expect(page.getByRole("link", { name: "How it works" })).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Pricing", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "Pricing", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("link", { name: "How it works" }).first()).toBeVisible();
});
