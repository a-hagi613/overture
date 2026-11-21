import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedBoardOwner } from "./board-harness.ts";

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

const cardStateSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(
        z.object({ id: z.string(), stage: z.string().nullable(), stageLocked: z.boolean() }),
      ),
      stage: z.string(),
    }),
  ),
});

async function cardState(request: Awaited<ReturnType<typeof apiRequest.newContext>>, id: string) {
  const body = cardStateSchema.parse(await (await request.get("/api/board")).json());

  return body.columns.flatMap((column) => column.cards).find((card) => card.id === id) ?? null;
}

async function openSeeded(browser: Browser, appServerUrl: string, width: number) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const userId = await seedBoardOwner(request, appServerUrl);

  await seedBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "1");
  });
  await page.goto(`${appServerUrl}/board`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("button[data-card]").filter({ visible: true }).first()).toBeVisible();

  return { context, page, request };
}

async function dragCardTo(page: Page, card: ReturnType<Page["locator"]>, stage: string) {
  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await card.dragTo(page.locator(`section[aria-label="${stage}"]`));
  await response;
}

test("dragging a card on desktop moves it and locks it", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 1280);
  const card = page.locator('section[aria-label="Queued"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the queued card has no id");
  }

  await dragCardTo(page, card, "Applied");

  await expect(page.locator(`section[aria-label="Applied"] button[data-card="${id}"]`)).toHaveCount(
    1,
  );

  const state = await cardState(request, id);

  expect(state?.stage).toBe("applied");
  expect(state?.stageLocked).toBe(true);

  await context.close();
  await request.dispose();
});

test("arrow keys move a card on desktop and lock it", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 1280);
  const card = page.locator('section[aria-label="Queued"] button[data-card]').nth(1);
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the queued card has no id");
  }

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await card.focus();
  await page.keyboard.press("ArrowRight");
  await response;

  const state = await cardState(request, id);

  expect(state?.stage).toBe("applied");
  expect(state?.stageLocked).toBe(true);

  await context.close();
  await request.dispose();
});

test("holding a card on the phone and dropping it on a stage moves and locks it", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 390);
  const card = page.locator("button[data-card]").filter({ visible: true }).first();
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the card has no id");
  }

  const cardBox = await card.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  });

  const stage = page.locator('button[data-stage="applied"]');

  const stageBox = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  });

  await page.clock.install();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.clock.fastForward(300);
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2, {
    steps: 5,
  });

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await page.mouse.up();
  await response;

  const state = await cardState(request, id);

  expect(state?.stage).toBe("applied");
  expect(state?.stageLocked).toBe(true);

  await context.close();
  await request.dispose();
});

test("swiping the phone column changes the stage", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 390);
  const panel = page.getByRole("tabpanel", { name: "Queued" });

  const box = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  });

  await page.clock.install();
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + 40, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole("tab", { name: /Applied/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tabpanel", { name: "Applied" })).toBeVisible();

  await context.close();
  await request.dispose();
});

test("archiving a queued card removes it from the Board", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 1280);
  const card = page.locator('section[aria-label="Queued"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the queued card has no id");
  }

  await card.click();
  await expect(page.locator('aside[aria-label="Application detail"] h2')).toBeVisible();

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/withdraw"),
  );

  await page.getByRole("button", { name: "Archive" }).click();
  await response;

  expect(await cardState(request, id)).toBeNull();
  await expect(page.locator(`button[data-card="${id}"]`)).toHaveCount(0);

  await context.close();
  await request.dispose();
});
