import { chromium } from "@playwright/test";

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const referenceRoot = "design/reference/home";
const outputRoot = "test/e2e/chrome-baselines";

interface Part {
  file: string;
  height: number;
  width: number;
  x: number;
  y: number;
}

const boards: { parts: Part[]; variant: string }[] = [
  {
    parts: [
      { file: "header", height: 262, width: 390, x: 0, y: 0 },
      { file: "tabbar", height: 64, width: 390, x: 0, y: 1975 },
    ],
    variant: "390",
  },
  {
    parts: [
      { file: "sidebar", height: 1197, width: 268, x: 0, y: 0 },
      { file: "header", height: 140, width: 1012, x: 268, y: 0 },
    ],
    variant: "1280",
  },
];

const themes = ["light", "dark"];

async function screenshotPart(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  reference: string,
  part: Part,
  variant: string,
  theme: string,
) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: part.height, width: part.width },
  });

  await page.setContent(
    `<img id="reference" style="display:block;margin:0;padding:0;position:absolute" />`,
  );

  await page
    .locator("#reference")
    .evaluate(async (element: HTMLImageElement, data: string) => {
      element.src = `data:image/png;base64,${data}`;

      await element.decode();
    }, readFileSync(reference).toString("base64"));

  await page
    .locator("#reference")
    .evaluate(
      (element, position: { left: number; top: number }) => {
        element.style.left = `-${position.left}px`;
        element.style.top = `-${position.top}px`;
      },
      { left: part.x, top: part.y },
    );

  const output = join(process.cwd(), outputRoot, `home-${variant}-${theme}-${part.file}.png`);

  mkdirSync(dirname(output), { recursive: true });

  await page.screenshot({ path: output });

  await page.close();
}

async function main() {
  const browser = await chromium.launch();

  const combinations = boards.flatMap((board) =>
    themes.map((theme) => ({ theme, variant: board.variant, parts: board.parts })),
  );

  await Promise.all(
    combinations.map(async (combination) => {
      const reference = join(
        process.cwd(),
        referenceRoot,
        `${combination.variant}-${combination.theme}.png`,
      );

      await Promise.all(
        combination.parts.map(async (part) =>
          screenshotPart(browser, reference, part, combination.variant, combination.theme),
        ),
      );
    }),
  );

  await browser.close();
}

await main();
