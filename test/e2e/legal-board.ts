import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";

import { expect } from "./app.fixture.ts";

export async function expectBoardToMatch({
  browser,
  heading,
  height,
  path,
  theme,
  url,
  width,
}: {
  browser: Browser;
  heading: string;
  height: number;
  path: string;
  theme: "light" | "dark";
  url: string;
  width: number;
}) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${url}${path}`);

  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, `${String(width)}px ${theme}`).toBe(false);

  await context.close();
}
