import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

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

const boxSchema = z.object({ h: z.number(), w: z.number(), x: z.number(), y: z.number() });

const elementSchema = z.object({ box: boxSchema, path: z.string() });

const referenceSchema = z.object({
  elements: z.array(elementSchema),
  page: z.object({ height: z.number(), width: z.number() }),
});

function referenceFor(width: number, theme: string) {
  return referenceSchema.parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `design/reference/settings/${String(width)}-${theme}.json`),
        "utf8",
      ),
    ),
  );
}

function cardBox(reference: z.infer<typeof referenceSchema>) {
  const element = reference.elements.find((candidate) =>
    candidate.path.endsWith(">section:nth-of-type(5)"),
  );

  if (element === undefined) {
    throw new Error("the Time and language card is not on the board");
  }

  return element.box;
}

function roundedBox(box: z.infer<typeof boxSchema>) {
  const x = Math.round(box.x);
  const y = Math.round(box.y);

  return {
    height: Math.round(box.y + box.h) - y,
    width: Math.round(box.x + box.w) - x,
    x,
    y,
  };
}

async function compareCardRegion({
  actual,
  expected,
  region,
}: {
  actual: string;
  expected: string;
  region: { height: number; width: number; x: number; y: number };
}) {
  const { height, width } = region;

  const decode = async (base64: string, crop: { x: number; y: number } | null) => {
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

    if (crop === null) {
      context.drawImage(image, 0, 0, width, height, 0, 0, width, height);
    } else {
      context.drawImage(image, crop.x, crop.y, width, height, 0, 0, width, height);
    }

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
    x2: Math.min(x + 1, width - 1),
    y0: Math.max(y - 1, 0),
    y2: Math.min(y + 1, height - 1),
  });

  const hasManySiblings = (data: Uint8ClampedArray, x: number, y: number) => {
    const { x0, x2, y0, y2 } = bounds(x, y);
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
    const { x0, x2, y0, y2 } = bounds(x, y);
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
  const actualData = await decode(actual, null);
  const expectedData = await decode(expected, { x: region.x, y: region.y });
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

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const seeded = await request.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: "America/Toronto" },
  });

  if (!seeded.ok()) {
    throw new Error(`settings seed failed: ${String(seeded.status())}`);
  }
}

async function openSettings(page: Page, appServerUrl: string, theme: string) {
  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("settings-time-language")).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);
}

async function expectCardMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOwner(request, appServerUrl);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ deviceScaleFactor: 1, storageState });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 1800 : 1200 });
  await openSettings(page, appServerUrl, theme);

  const reference = referenceFor(width, theme);
  const board = roundedBox(cardBox(reference));
  const card = page.getByTestId("settings-time-language");

  const cardStyles = await card.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      borderRadius: style.borderTopLeftRadius,
      borderTopWidth: style.borderTopWidth,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
    };
  });

  expect(cardStyles.borderRadius).toBe("8px");
  expect(cardStyles.borderTopWidth).toBe("1px");

  if (width === 1280) {
    expect(cardStyles.paddingTop).toBe("24px");
    expect(cardStyles.paddingRight).toBe("28px");
    expect(cardStyles.paddingBottom).toBe("26px");
    expect(cardStyles.paddingLeft).toBe("28px");
  } else {
    expect(cardStyles.paddingTop).toBe("20px");
    expect(cardStyles.paddingRight).toBe("16px");
    expect(cardStyles.paddingBottom).toBe("22px");
    expect(cardStyles.paddingLeft).toBe("16px");
  }

  const cardRect = await card.boundingBox();

  if (cardRect === null) {
    throw new Error("the Time and language card has no box");
  }

  expect(Math.round(cardRect.width)).toBe(board.width);
  expect(Math.round(cardRect.height)).toBe(board.height);

  const heading = card.getByRole("heading", { level: 2 });

  await expect(heading).toHaveText("Time and language");

  const headingStyles = await heading.evaluate((element) => {
    const style = getComputedStyle(element);

    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
    };
  });

  expect(headingStyles.fontFamily).toContain("Instrument Serif");
  expect(headingStyles.fontSize).toBe("28px");
  expect(headingStyles.lineHeight).toBe("30.8px");
  expect(headingStyles.letterSpacing).toBe("-0.14px");

  const zoneRow = page.getByTestId("settings-time-zone-row");
  const languagesRow = page.getByTestId("settings-posting-languages-row");

  const zoneRect = await zoneRow.boundingBox();
  const languagesRect = await languagesRow.boundingBox();
  const select = card.getByLabel("Time zone");
  const selectRect = await select.boundingBox();

  if (zoneRect === null || languagesRect === null || selectRect === null) {
    throw new Error("a Time and language row has no box");
  }

  expect(await select.inputValue()).toBe("America/Toronto");
  expect(Math.round(selectRect.width)).toBe(230);
  expect(Math.round(selectRect.height)).toBe(width === 1280 ? 40 : 48);
  expect(Math.round(zoneRect.height)).toBe(width === 1280 ? 135 : 143);
  expect(Math.round(languagesRect.height)).toBe(width === 1280 ? 113 : 140);

  const english = card.getByRole("button", { name: "English" });
  const french = card.getByRole("button", { name: "French" });
  const englishRect = await english.boundingBox();

  if (englishRect === null) {
    throw new Error("the English chip has no box");
  }

  expect(Math.round(englishRect.height)).toBe(width === 1280 ? 36 : 44);
  expect(await english.getAttribute("aria-pressed")).toBe("true");
  expect(await french.getAttribute("aria-pressed")).toBe("false");

  const { violations } = await new AxeBuilder({ page })
    .include('[data-testid="settings-time-language"]')
    .analyze();

  expect(violations).toEqual([]);

  const actual = await card.screenshot({ animations: "disabled", caret: "hide" });

  const expected = readFileSync(
    join(process.cwd(), `design/reference/settings/${String(width)}-${theme}.png`),
  );

  const boardExact = cardBox(reference);
  const phaseX = cardRect.x - Math.floor(cardRect.x);

  const cropOffsets = [
    -1.4, -1.3, -1.2, -1.1, -1, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2,
  ];

  const ratios = await Promise.all(
    cropOffsets.map(async (offset) =>
      page.evaluate(compareCardRegion, {
        actual: actual.toString("base64"),
        expected: expected.toString("base64"),
        region: {
          height: actual.readUInt32BE(20),
          width: actual.readUInt32BE(16),
          x: boardExact.x - phaseX,
          y: boardExact.y + offset,
        },
      }),
    ),
  );

  expect(Math.min(...ratios)).toBeLessThanOrEqual(0.01);

  await context.close();
}

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the Time and language card matches the ${String(width)} ${theme} board`, async ({
      boardServer,
      browser,
    }) => {
      await expectCardMatchesBoard(browser, boardServer.url, width, theme);
    });
  }
}
