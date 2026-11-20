import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./app.fixture.ts";
import { z } from "zod";

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const elementSchema = z.object({ box: boxSchema, path: z.string() });

const referenceSchema = z.object({
  elements: z.array(elementSchema),
  page: z.object({ height: z.number(), width: z.number() }),
});

const USAGE_SUFFIX = "aside>div:nth-of-type(2)>div:nth-of-type(1)";

function rectOfBox(box: z.infer<typeof boxSchema>) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);

  return {
    height: Math.round(box.y + box.h) - y,
    width: Math.round(box.x + box.w) - x,
    x,
    y,
  };
}

function usageCrop() {
  const reference = referenceSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "design/reference/home/1280-light.json"), "utf8")),
  );

  const element = reference.elements.find((candidate) => candidate.path.endsWith(USAGE_SUFFIX));

  if (element === undefined) {
    throw new Error(`No Applications-left element found in the 1280 light board.`);
  }

  return {
    pageHeight: reference.page.height,
    usageName: `1280-light-usage`,
    usageRect: rectOfBox(element.box),
  };
}

for (const theme of ["light", "dark"] as const) {
  test(`the 1280 ${theme} Applications-left element matches the home board`, async ({
    appServerUrl,
    browser,
    chromeOwnerStorage,
  }) => {
    const { pageHeight, usageName, usageRect } = usageCrop();

    const context = await browser.newContext({
      deviceScaleFactor: 1,
      storageState: chromeOwnerStorage,
      viewport: { height: Math.round(pageHeight), width: 1280 },
    });

    const page = await context.newPage();

    await page.clock.setFixedTime(new Date(2026, 10, 17, 3, 0, 0));

    if (theme === "dark") {
      await page.addInitScript(() => {
        globalThis.localStorage.setItem("overture.theme", "dark");
      });
    }

    await page.goto(`${appServerUrl}/`);
    await expect(page.getByRole("heading", { name: "Overture is ready" })).toBeVisible();
    await expect(page.getByText("of 70 on your week plan")).toBeVisible();
    await expect(page.getByText("7 of 10 sent today · resets at midnight")).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    await expect(page).toHaveScreenshot(`${usageName.replace("light", theme)}.png`, {
      animations: "disabled",
      caret: "hide",
      clip: usageRect,
      maxDiffPixelRatio: 0.01,
    });

    await context.close();
  });
}
