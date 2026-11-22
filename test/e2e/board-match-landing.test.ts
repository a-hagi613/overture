import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";

const widths = [390, 1280, 1440, 1920, 2560] as const;
const themes = ["light", "dark"] as const;
const landingHeadline = "Overture prepares every application. It sends only when you approve.";

const shotsDir = process.env.LANDING_SHOTS_DIR ?? "";

for (const width of widths) {
  for (const theme of themes) {
    test(`the landing at ${String(width)} ${theme} has no horizontal overflow, is axe clean, and renders the hero`, async ({
      page,
      appServerUrl,
    }, testInfo) => {
      await page.addInitScript((mode) => {
        globalThis.localStorage.setItem("overture.theme", mode);
      }, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(appServerUrl);
      await expect(page.getByRole("heading", { level: 1, name: landingHeadline })).toBeVisible();
      await page.evaluate(async () => document.fonts.ready.then(() => true));

      const overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));

      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);

      const name = `${String(width)}-${theme}`;
      const shot = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });

      await testInfo.attach(`${name}.png`, { body: shot, contentType: "image/png" });

      if (shotsDir !== "") {
        mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({
          animations: "disabled",
          caret: "hide",
          fullPage: true,
          path: join(shotsDir, `${name}.png`),
        });
      }
    });
  }
}
