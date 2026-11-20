import { chromium } from "@playwright/test";

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

const referenceRoot = "design/reference/home";
const outputRoot = "test/e2e/chrome-baselines";

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const elementSchema = z.object({ box: boxSchema, path: z.string() });

const referenceSchema = z.object({ elements: z.array(elementSchema) });

interface Rect {
  height: number;
  width: number;
  x: number;
  y: number;
}

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

const parts = {
  1280: [
    { name: "header", suffix: ">main>header" },
    { name: "sidebar", suffix: "aside" },
  ],
  390: [
    { name: "header", suffix: ">main>header" },
    { name: "tabbar", suffix: ">div>nav" },
  ],
} as const;

const themes = ["light", "dark"];

function referenceRect(variant: string, suffix: string) {
  const reference = referenceSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), referenceRoot, `${variant}.json`), "utf8")),
  );

  const element = reference.elements.find((candidate) => candidate.path.endsWith(suffix));

  if (element === undefined) {
    throw new Error(`no element ends with ${suffix} in ${variant}`);
  }

  return rectOfBox(element.box);
}

async function crop(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  reference: string,
  rect: Rect,
  output: string,
) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: rect.height, width: rect.width },
  });

  await page.setContent(
    `<img id="reference" style="display:block;margin:0;padding:0;position:absolute" />`,
  );

  await page.locator("#reference").evaluate(async (element: HTMLImageElement, data: string) => {
    element.src = `data:image/png;base64,${data}`;

    await element.decode();
  }, readFileSync(reference).toString("base64"));

  await page.locator("#reference").evaluate(
    (element, position: { left: number; top: number }) => {
      element.style.left = `-${String(position.left)}px`;
      element.style.top = `-${String(position.top)}px`;
    },
    { left: rect.x, top: rect.y },
  );

  mkdirSync(dirname(output), { recursive: true });

  await page.screenshot({ path: output });

  await page.close();
}

async function main() {
  const browser = await chromium.launch();

  const combinations = Object.entries(parts).flatMap(([width, namedParts]) =>
    themes.map((theme) => ({
      namedParts,
      reference: join(process.cwd(), referenceRoot, `${width}-${theme}.png`),
      variant: `${width}-${theme}`,
    })),
  );

  await Promise.all(
    combinations.map(async (combination) => {
      await Promise.all(
        combination.namedParts.map(async (namedPart) => {
          await crop(
            browser,
            combination.reference,
            referenceRect(combination.variant, namedPart.suffix),
            join(process.cwd(), outputRoot, `home-${combination.variant}-${namedPart.name}.png`),
          );
        }),
      );
    }),
  );

  await browser.close();
}

await main();
