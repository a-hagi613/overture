import { AxeBuilder } from "@axe-core/playwright";

import type { Browser } from "@playwright/test";

import { comparePageToBoard } from "./artboard-compare.ts";
import { expect } from "./app.fixture.ts";

export async function expectBoardToMatch({
  browser,
  heading,
  height,
  name,
  path,
  referenceDir,
  theme,
  url,
  width,
}: {
  browser: Browser;
  heading: string;
  height: number;
  name: string;
  path: string;
  referenceDir: URL;
  theme: "light" | "dark";
  url: string;
  width: number;
}) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { height: 900, width },
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

  const ratio = await comparePageToBoard(
    page,
    new URL(`${name}.png`, referenceDir).pathname,
    width,
    height,
  );

  expect(ratio, `${String(width)}px ${theme}`).toBeLessThanOrEqual(width === 1280 ? 0.03 : 0.1);

  await context.close();
}
