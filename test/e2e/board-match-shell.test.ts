import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "./app.fixture.ts";
import { z } from "zod";

interface Box {
  height: number;
  width: number;
  x: number;
  y: number;
}

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const elementSchema = z.object({ box: boxSchema, path: z.string() }).transform((element) => ({
  box: { height: element.box.h, width: element.box.w, x: element.box.x, y: element.box.y },
  path: element.path,
}));

const referenceSchema = z.object({ elements: z.array(elementSchema) });

function unionRect(boxes: Box[]) {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));

  return {
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    x,
    y,
  };
}

function shellCrop(width: number, theme: string) {
  const reference = referenceSchema.parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `design/reference/home/${String(width)}-${theme}.json`),
        "utf8",
      ),
    ),
  );

  const suffixes = [">main>header", width === 390 ? ">nav" : ">aside"];

  return unionRect(
    reference.elements
      .filter((element) => suffixes.some((suffix) => element.path.endsWith(suffix)))
      .map((element) => element.box),
  );
}

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`the ${String(width)} ${theme} shell matches the home board chrome`, async ({
      appServerUrl,
      browser,
      chromeOwnerStorage,
    }) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: chromeOwnerStorage,
        viewport: { height: 1197, width },
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
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const crop = shellCrop(width, theme);

      await expect(page).toHaveScreenshot(`${String(width)}-${theme}-shell.png`, {
        animations: "disabled",
        caret: "hide",
        clip: { height: crop.height, width: crop.width, x: crop.x, y: crop.y },
        mask: [page.locator("main > div").first()],
        maxDiffPixelRatio: 0.01,
      });

      await context.close();
    });
  }
}
