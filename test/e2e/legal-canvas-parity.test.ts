import type { Page } from "@playwright/test";

import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";

import { startFreshAppServer, expect, test as appTest } from "./app.fixture.ts";

const test = appTest.extend<{ legalServer: AppServer }>({
  legalServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const legalPaths = [
  { heading: "Terms of Service", path: "/terms" },
  { heading: "Privacy Policy", path: "/privacy" },
  { heading: "What you agree to", path: "/consent" },
] as const;

async function measuredType(page: Page) {
  return page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const sections = [...document.querySelectorAll("main > div > section")];
    const [first, second] = sections;
    const heading = first?.querySelector("h2");
    const paragraph = first?.querySelector("p");
    const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;

    return {
      body: paragraphStyle === null ? null : Number(paragraphStyle.fontSize.replace("px", "")),
      bodyLead:
        paragraphStyle === null
          ? null
          : Number(paragraphStyle.lineHeight.replace("px", "")) /
            Number(paragraphStyle.fontSize.replace("px", "")),
      heading:
        heading === null || heading === undefined
          ? null
          : Number(getComputedStyle(heading).fontSize.replace("px", "")),
      h1: h1 === null ? null : Number(getComputedStyle(h1).fontSize.replace("px", "")),
      sectionPadding:
        second === undefined ? null : Number(getComputedStyle(second).paddingTop.replace("px", "")),
    };
  });
}

async function measuredAlignment(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const footer = document.querySelector("footer");
    const footerText = footer?.querySelector("p");

    if (main === null || footer === null || footerText === null || footerText === undefined) {
      return null;
    }

    const mainStyle = getComputedStyle(main);
    const footStyle = getComputedStyle(footer);

    return {
      footFont: Number(getComputedStyle(footerText).fontSize.replace("px", "")),
      footLeft:
        footer.getBoundingClientRect().left + Number(footStyle.paddingLeft.replace("px", "")),
      mainLeft: main.getBoundingClientRect().left + Number(mainStyle.paddingLeft.replace("px", "")),
    };
  });
}

async function measuredCard(page: Page) {
  return page.evaluate(() => {
    const title = document.querySelector("#consent-title");
    const panel = document.querySelector("main section");
    const checkbox = document.querySelector("#consent-agree");

    if (title === null || panel === null || checkbox === null) {
      return null;
    }

    const accent = title.querySelector("em");

    return {
      accent: accent === null ? null : getComputedStyle(accent).fontStyle,
      checkbox: checkbox.getBoundingClientRect().width,
      title: Number(getComputedStyle(title).fontSize.replace("px", "")),
      width: panel.getBoundingClientRect().width,
    };
  });
}

for (const [width, h1Size] of [
  [390, 40],
  [1280, 58],
] as const) {
  test(`the legal pages keep the canvas type scale at ${String(width)}px`, async ({
    browser,
    legalServer,
  }) => {
    const context = await browser.newContext({ viewport: { height: 900, width } });
    const page = await context.newPage();

    await page.goto(`${legalServer.url}/privacy`);

    const type = await measuredType(page);

    expect(type.h1).toBe(h1Size);
    expect(type.heading).toBe(26);
    expect(type.body).toBe(15);
    expect(type.bodyLead).toBeCloseTo(1.66, 2);
    expect(type.sectionPadding).toBe(22);

    const alignment = await measuredAlignment(page);

    expect(alignment?.footFont).toBe(12.5);
    expect(Math.abs((alignment?.mainLeft ?? 0) - (alignment?.footLeft ?? 100))).toBeLessThanOrEqual(
      0.5,
    );

    await context.close();
  });
}

test("the consent card keeps the canvas scale", async ({ browser, legalServer }) => {
  const context = await browser.newContext({ viewport: { height: 900, width: 1280 } });
  const page = await context.newPage();

  await page.goto(`${legalServer.url}/consent`);
  await expect(page.getByRole("heading", { level: 1, name: "What you agree to" })).toBeVisible();

  const card = await measuredCard(page);

  expect(card?.title).toBe(34);
  expect(card?.accent).toBe("italic");
  expect(card?.checkbox).toBe(20);
  expect(card?.width).toBeCloseTo(540, 0);

  await context.close();
});

for (const width of [1440, 1920, 2560] as const) {
  test(`the legal pages fit and pass axe at ${String(width)}px`, async ({
    browser,
    legalServer,
  }) => {
    const context = await browser.newContext({ viewport: { height: 900, width } });

    await Promise.all(
      legalPaths.map(async (legalPath) => {
        const page = await context.newPage();
        const label = `${legalPath.path} at ${String(width)}px`;

        await page.goto(`${legalServer.url}${legalPath.path}`);
        await expect(
          page.getByRole("heading", { level: 1, name: legalPath.heading }),
        ).toBeVisible();

        const layout = await page.evaluate(() => ({
          body: document.body.scrollWidth,
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
        }));

        expect(layout.scroll, label).toBeLessThanOrEqual(layout.client);
        expect(layout.body, label).toBeLessThanOrEqual(layout.client);

        const results = await new AxeBuilder({ page }).analyze();

        expect(results.violations, label).toEqual([]);

        await page.close();
      }),
    );

    await context.close();
  });
}
