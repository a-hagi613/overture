import { readFileSync } from "node:fs";

import type { Browser, Page } from "@playwright/test";

import { expect, test as appTest } from "./app.fixture.ts";

const widths = [390, 1280] as const;
const themes = ["light", "dark"] as const;

const referenceDir = new URL("../../design/reference/pricing/", import.meta.url);

function readPngSize(name: string) {
  const png = readFileSync(new URL(`${name}.png`, referenceDir));
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  return { height: view.getUint32(20), width: view.getUint32(16) };
}

async function open(page: Page, serverUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${serverUrl}/pricing`);
  await expect(page.getByRole("heading", { name: "Pay for applications sent." })).toBeVisible();
}

async function assertMatchesBoard(
  browser: Browser,
  serverUrl: string,
  width: number,
  theme: string,
) {
  const name = `${String(width)}-${theme}`;
  const { height } = readPngSize(name);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width, height },
  });

  const page = await context.newPage();

  await open(page, serverUrl, theme);
  await page.evaluate(async () => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  });

  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });

  await context.close();
}

for (const width of widths) {
  for (const theme of themes) {
    appTest(
      `the ${String(width)} ${theme} pricing page matches the board`,
      async ({ appServer, browser }) => {
        await assertMatchesBoard(browser, appServer.url, width, theme);
      },
    );
  }
}
