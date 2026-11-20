import { readFileSync } from "node:fs";

import { z } from "zod";

import type { AppServer } from "./app-server.ts";

import type { Page } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test as appTest, startFreshAppServer } from "./app.fixture.ts";

const boardTest = appTest.extend<{ boardServer: AppServer }>({
  boardServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const widths = [390, 1440];
const themes = ["light", "dark"];
const modes = ["sign-in", "sign-up", "magic-sent"];

const referenceDir = new URL("../../design/reference/signin/", import.meta.url);

const boardJson = z.object({
  page: z.object({ height: z.number() }),
  elements: z.tuple([z.object({ box: z.object({ h: z.number() }) })]).rest(z.unknown()),
});

function readArtboardHeight(name: string) {
  const board = boardJson.parse(
    JSON.parse(readFileSync(new URL(`${name}.json`, referenceDir), "utf8")),
  );

  return board.elements[0].box.h;
}

async function compareArtboard({
  actual,
  expected,
  width,
  height,
}: {
  actual: string;
  expected: string;
  width: number;
  height: number;
}) {
  const decode = async (base64: string) => {
    const image = new Image();

    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (context === null) {
      throw new Error("no 2d canvas context");
    }

    context.drawImage(image, 0, 0, width, height, 0, 0, width, height);

    return context.getImageData(0, 0, width, height).data;
  };

  const colorDelta = (
    first: Uint8ClampedArray,
    x1: number,
    y1: number,
    second: Uint8ClampedArray,
    x2: number,
    y2: number,
  ) => {
    const [r1 = 0, g1 = 0, b1 = 0] = first.subarray(
      (y1 * width + x1) * 4,
      (y1 * width + x1) * 4 + 3,
    );

    const [r2 = 0, g2 = 0, b2 = 0] = second.subarray(
      (y2 * width + x2) * 4,
      (y2 * width + x2) * 4 + 3,
    );

    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const dy = dr * 0.299 + dg * 0.587 + db * 0.114;
    const di = dr * 0.596 - dg * 0.274 - db * 0.322;
    const dq = dr * 0.211 - dg * 0.523 + db * 0.312;
    const delta = 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;

    return dy > 0 ? -delta : delta;
  };

  const bounds = (x: number, y: number) => ({
    x0: Math.max(x - 1, 0),
    y0: Math.max(y - 1, 0),
    x2: Math.min(x + 1, width - 1),
    y2: Math.min(y + 1, height - 1),
  });

  const hasManySiblings = (data: Uint8ClampedArray, x: number, y: number) => {
    const { x0, y0, x2, y2 } = bounds(x, y);
    let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;

    for (let nx = x0; nx <= x2; nx += 1) {
      for (let ny = y0; ny <= y2; ny += 1) {
        if ((nx !== x || ny !== y) && colorDelta(data, x, y, data, nx, ny) === 0) {
          zeroes += 1;

          if (zeroes > 1) {
            return true;
          }
        }
      }
    }

    return false;
  };

  const isAntialiased = (data: Uint8ClampedArray, x: number, y: number) => {
    const { x0, y0, x2, y2 } = bounds(x, y);
    let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
    let min = 0;
    let max = 0;
    let minPoint = { x, y };
    let maxPoint = { x, y };

    for (let nx = x0; nx <= x2; nx += 1) {
      for (let ny = y0; ny <= y2; ny += 1) {
        if (nx === x && ny === y) {
          continue;
        }

        const delta = colorDelta(data, x, y, data, nx, ny);

        if (delta === 0) {
          zeroes += 1;

          if (zeroes > 2) {
            return false;
          }
        } else if (delta < min) {
          min = delta;
          minPoint = { x: nx, y: ny };
        } else if (delta > max) {
          max = delta;
          maxPoint = { x: nx, y: ny };
        }
      }
    }

    if (min === 0 || max === 0) {
      return false;
    }

    return (
      hasManySiblings(data, minPoint.x, minPoint.y) && hasManySiblings(data, maxPoint.x, maxPoint.y)
    );
  };

  const maxDelta = 35_215 * 0.2 * 0.2;
  const actualData = await decode(actual);
  const expectedData = await decode(expected);
  let different = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const delta = colorDelta(actualData, x, y, expectedData, x, y);

      if (
        Math.abs(delta) > maxDelta &&
        !isAntialiased(actualData, x, y) &&
        !isAntialiased(expectedData, x, y)
      ) {
        different += 1;
      }
    }
  }

  return different / (width * height);
}

async function openSignIn(page: Page, theme: string, serverUrl: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${serverUrl}/signin`);
  await page.evaluate(async () => document.fonts.ready.then(() => true));
}

async function expectArtboardToMatchBoard(page: Page, name: string, width: number) {
  const height = readArtboardHeight(name);

  const actual = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    clip: { x: 0, y: 0, width, height },
  });

  const expected = readFileSync(new URL(`${name}.png`, referenceDir));

  const ratio = await page.evaluate(compareArtboard, {
    actual: actual.toString("base64"),
    expected: expected.toString("base64"),
    width,
    height,
  });

  expect(ratio).toBeLessThanOrEqual(0.01);
}

for (const width of widths) {
  for (const theme of themes) {
    for (const mode of modes) {
      boardTest(
        `the ${String(width)} ${theme} sign-in screen matches the board in ${mode} mode`,
        async ({ boardServer, browser }) => {
          const context = await browser.newContext({
            deviceScaleFactor: 1,
            viewport: { width, height: 900 },
          });

          const page = await context.newPage();

          await openSignIn(page, theme, boardServer.url);

          await page.getByLabel("Email").fill(authTestIdentity.ownerEmail);

          if (mode === "sign-up") {
            await page.getByRole("button", { name: "Create an account" }).click();
            await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
          }

          if (mode === "magic-sent") {
            await expect
              .poll(
                async () =>
                  await page
                    .locator('[data-turnstile="magic"] input[name="cf-turnstile-response"]')
                    .inputValue(),
              )
              .not.toBe("");
            await page.getByRole("button", { name: "Email me a sign-in link" }).click();
            await expect(page.getByText("Link sent to")).toBeVisible();
          }

          await page.evaluate(() => {
            const active = document.activeElement;

            if (active instanceof HTMLElement) {
              active.blur();
            }
          });

          const name = `${String(width)}-${theme}-${mode}`;

          if (width === 390) {
            await expectArtboardToMatchBoard(page, name, width);
          } else {
            await expect(page).toHaveScreenshot(`${name}.png`, {
              animations: "disabled",
              caret: "hide",
              maxDiffPixelRatio: 0.01,
            });
          }

          await context.close();
        },
      );
    }
  }
}
