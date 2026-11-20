import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "./app.fixture.ts";
import { z } from "zod";

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const elementSchema = z.object({ box: boxSchema, path: z.string() });

const referenceSchema = z.object({
  elements: z.array(elementSchema),
  page: z.object({ height: z.number(), width: z.number() }),
});

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

function elementBySuffix(reference: z.infer<typeof referenceSchema>, suffix: string) {
  const element = reference.elements.find((candidate) => candidate.path.endsWith(suffix));

  if (element === undefined) {
    throw new Error(`no element ends with ${suffix}`);
  }

  return element;
}

function chromeCrop(width: number, theme: string) {
  const reference = referenceSchema.parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `design/reference/home/${String(width)}-${theme}.json`),
        "utf8",
      ),
    ),
  );

  const variant = `${String(width)}-${theme}`;

  const chromeSuffix = width === 390 ? ">div>nav" : "aside";

  return {
    chromeName: `home-${variant}-${width === 390 ? "tabbar" : "sidebar"}`,
    chromeRect: rectOfBox(elementBySuffix(reference, chromeSuffix).box),
    headerName: `home-${variant}-header`,
    headerRect: rectOfBox(elementBySuffix(reference, ">main>header").box),
    pageHeight: reference.page.height,
  };
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"]) {
    test(`the ${String(width)} ${theme} shell matches the home board chrome`, async ({
      appServerUrl,
      browser,
      chromeOwnerStorage,
    }) => {
      const { chromeName, chromeRect, headerName, headerRect, pageHeight } = chromeCrop(
        width,
        theme,
      );

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: chromeOwnerStorage,
        viewport: { height: Math.round(pageHeight), width },
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
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const options = {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.01,
      } as const;

      await expect(page).toHaveScreenshot(`${headerName}.png`, { clip: headerRect, ...options });
      await expect(page).toHaveScreenshot(`${chromeName}.png`, { clip: chromeRect, ...options });

      await context.close();
    });
  }
}
