import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Locator, Page } from "@playwright/test";
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

const referenceSchema = z.object({
  elements: z.array(z.object({ box: boxSchema, path: z.string() })),
  page: z.object({ height: z.number(), width: z.number() }),
});

function referenceFor(width: number, theme: string) {
  return referenceSchema.parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `design/reference/settings-delete/${String(width)}-${theme}.json`),
        "utf8",
      ),
    ),
  );
}

function cardBoxes(reference: z.infer<typeof referenceSchema>) {
  return reference.elements
    .filter((element) => element.path.endsWith(">section") && element.path.includes("main>div>div"))
    .map((element) => element.box);
}

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

const MAX_TEXT_ANTIALIAS_DRIFT = 0.12;

async function parkAtViewportTop(section: Locator) {
  await section.evaluate((element) => {
    element.scrollIntoView({ behavior: "instant", block: "start" });
  });
}

async function compareRegion(
  page: Page,
  section: Locator,
  expectedPath: string,
  region: z.infer<typeof boxSchema>,
) {
  await parkAtViewportTop(section);

  const actualBox = await section.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return {
      height: rect.height,
      width: rect.width,
      x: rect.x + globalThis.scrollX,
      y: rect.y + globalThis.scrollY,
    };
  });

  expect(Math.round(actualBox.width)).toBe(Math.round(region.w));
  expect(Math.round(actualBox.height)).toBe(Math.round(region.h));

  const pageImage = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });

  const ratio = await page.evaluate(
    async ({ actual, actualCrop, expected, box }) => {
      const { height, width } = box;

      const decode = async (base64: string, crop: { x: number; y: number }) => {
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

        context.drawImage(image, crop.x, crop.y, width, height, 0, 0, width, height);

        return context.getImageData(0, 0, width, height).data;
      };

      const first = await decode(actual, actualCrop);
      const second = await decode(expected, { x: Math.round(box.x), y: Math.floor(box.y) });
      let differing = 0;

      for (let index = 0; index < first.length; index += 4) {
        const dr = (first[index] ?? 0) - (second[index] ?? 0);
        const dg = (first[index + 1] ?? 0) - (second[index + 1] ?? 0);
        const db = (first[index + 2] ?? 0) - (second[index + 2] ?? 0);

        if (Math.hypot(dr, dg, db) > 18) {
          differing += 1;
        }
      }

      return differing / (width * height);
    },
    {
      actual: pageImage.toString("base64"),
      actualCrop: { x: Math.round(actualBox.x), y: Math.floor(actualBox.y) },
      box: { height: Math.round(region.h), width: Math.round(region.w), x: region.x, y: region.y },
      expected: readFileSync(join(process.cwd(), expectedPath)).toString("base64"),
    },
  );

  expect(ratio).toBeLessThanOrEqual(MAX_TEXT_ANTIALIAS_DRIFT);
}

async function expectNoHorizontalScroll(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));

  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

const REAUTH_WINDOW_MS = 15 * 60 * 1000;

async function setClockOffset(appServerUrl: string, offsetMs: number) {
  await fetch(`${appServerUrl}/__test__/clock/offset`, {
    body: JSON.stringify({ offsetMs }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectButtonInteractive(page: Page, button: Locator) {
  expect(await button.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");

  await page.mouse.move(0, 0);
  const rest = await button.evaluate((element) => getComputedStyle(element).backgroundColor);

  await button.hover();
  const hovered = await button.evaluate((element) => getComputedStyle(element).backgroundColor);

  expect(hovered).not.toBe(rest);

  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");

  const outline = await button.evaluate((element) => {
    const style = getComputedStyle(element);

    return { style: style.outlineStyle, width: style.outlineWidth };
  });

  expect(outline.style).not.toBe("none");
  expect(outline.width).not.toBe("0px");
}

async function expectButtonsAreInteractive(page: Page) {
  await expectButtonInteractive(page, page.getByRole("button", { name: "Continue to delete" }));
  await expectButtonInteractive(
    page,
    page.getByRole("button", { name: "Send sign-in link", exact: true }),
  );
  await expectButtonInteractive(page, page.getByRole("button", { name: "Delete my account" }));

  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

async function expectDeleteBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await seedOwner(request, appServerUrl);

  const storage = await request.storageState();

  await request.dispose();

  const reference = referenceFor(width, theme);
  const boxes = cardBoxes(reference);

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState: storage,
    viewport: { height: 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await setClockOffset(appServerUrl, REAUTH_WINDOW_MS + 1);

  await page.goto(`${appServerUrl}/settings/delete`);
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await expectNoHorizontalScroll(page);
  await expectButtonsAreInteractive(page);

  const path = `design/reference/settings-delete/${String(width)}-${theme}.png`;

  await compareRegion(page, page.getByTestId("delete-warning"), path, {
    h: boxes[0]?.h ?? 0,
    w: boxes[0]?.w ?? 0,
    x: boxes[0]?.x ?? 0,
    y: boxes[0]?.y ?? 0,
  });
  await compareRegion(page, page.getByTestId("delete-reauth"), path, {
    h: boxes[1]?.h ?? 0,
    w: boxes[1]?.w ?? 0,
    x: boxes[1]?.x ?? 0,
    y: boxes[1]?.y ?? 0,
  });
  await compareRegion(page, page.getByTestId("delete-confirm"), path, {
    h: boxes[2]?.h ?? 0,
    w: boxes[2]?.w ?? 0,
    x: boxes[2]?.x ?? 0,
    y: boxes[2]?.y ?? 0,
  });

  await setClockOffset(appServerUrl, 0);

  await page.getByLabel("I understand my data is erased").check();
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("Erasing your account")).toBeVisible();

  await compareRegion(page, page.getByTestId("delete-erasing"), path, {
    h: boxes[3]?.h ?? 0,
    w: boxes[3]?.w ?? 0,
    x: boxes[3]?.x ?? 0,
    y: boxes[3]?.y ?? 0,
  });
  await compareRegion(page, page.getByTestId("delete-email"), path, {
    h: boxes[4]?.h ?? 0,
    w: boxes[4]?.w ?? 0,
    x: boxes[4]?.x ?? 0,
    y: boxes[4]?.y ?? 0,
  });

  await context.close();
}

test("the delete page has no horizontal overflow at every breakpoint", async ({
  boardServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: boardServer.url });

  await seedOwner(request, boardServer.url);

  const storage = await request.storageState();

  await request.dispose();

  await Promise.all(
    [390, 768, 1280, 1920, 2560].map(async (width) => {
      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState: storage,
        viewport: { height: 900, width },
      });

      const page = await context.newPage();

      await page.goto(`${boardServer.url}/settings/delete`);
      await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await context.close();
    }),
  );
});

for (const width of [390, 1280] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`the delete account states match the ${String(width)} ${theme} board`, async ({
      boardServer,
      browser,
    }) => {
      await expectDeleteBoard(browser, boardServer.url, width, theme);
    });
  }
}
