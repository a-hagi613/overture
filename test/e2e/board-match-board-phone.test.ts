import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { openBoard, seedBoard, seedBoardOwner } from "./board-harness.ts";

const test = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;

async function writePhoneBaseline(browser: Browser, theme: string) {
  const directory = "test/e2e/.tmp/board-baselines";

  mkdirSync(directory, { recursive: true });

  const source = readFileSync(`design/reference/board/390-${theme}.png`).toString("base64");
  const cropContext = await browser.newContext();
  const page = await cropContext.newPage();

  const cropped = await page.evaluate(
    async (input: { base64: string; height: number; width: number }) => {
      const image = new Image();

      image.src = `data:image/png;base64,${input.base64}`;
      await image.decode();

      const canvas = document.createElement("canvas");

      canvas.width = input.width;
      canvas.height = input.height;

      const context = canvas.getContext("2d");

      if (context === null) {
        throw new Error("the canvas has no context");
      }

      context.drawImage(image, 0, 0);

      return canvas.toDataURL("image/png").split(",").at(1) ?? "";
    },
    { base64: source, height: PHONE_HEIGHT, width: PHONE_WIDTH },
  );

  await cropContext.close();
  writeFileSync(`${directory}/390-${theme}.png`, Buffer.from(cropped, "base64"));
}

async function expectPhoneBoardMatches(browser: Browser, appServerUrl: string, theme: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  const userId = await seedBoardOwner(request, appServerUrl);
  const { selectedId } = await seedBoard(request, userId);
  const storageState = await request.storageState();

  await request.dispose();
  await writePhoneBaseline(browser, theme);

  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ width: PHONE_WIDTH, height: PHONE_HEIGHT });

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "1");
  });

  await openBoard(page, appServerUrl, PHONE_WIDTH, selectedId);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Senior Backend Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByText("Twenty-nine applications across six stages").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("63 left").filter({ visible: true })).toBeVisible();
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Plus Jakarta Sans"'),
      document.fonts.load('600 16px "Plus Jakarta Sans"'),
      document.fonts.load('400 16px "Instrument Serif"'),
      document.fonts.load('400 12px "IBM Plex Mono"'),
    ]);
    await document.fonts.ready;
  });

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, theme).toEqual([]);

  const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  expect(contentHeight).toBe(PHONE_HEIGHT);

  await expect(page).toHaveScreenshot(`390-${theme}.png`, {
    maxDiffPixelRatio: 0.01,
  });
  await context.close();
}

for (const theme of ["light", "dark"]) {
  test(`the Board page matches the phone board in ${theme}`, async ({ browser, boardServer }) => {
    await expectPhoneBoardMatches(browser, boardServer.url, theme);
  });
}
