import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedBoardOwner } from "./board-harness.ts";

const test = appTest.extend<{ viewsServer: AppServer }>({
  viewsServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(z.object({ id: z.string(), stage: z.string().nullable() })),
      stage: z.string(),
    }),
  ),
});

const reviewsSchema = z.object({
  reviews: z.array(z.object({ id: z.string(), prompt: z.string() })),
});

const LIST = 'ul[aria-label="Applications list"]';

async function openSeeded(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: "light" | "dark" = "light",
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const userId = await seedBoardOwner(request, appServerUrl);

  await seedBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/applications`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  return { context, page, request };
}

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
}

async function seedReviews(request: APIRequestContext, userId: string) {
  const board = boardSchema.parse(await (await request.get("/api/board")).json());

  const sent = board.columns.find((column) => column.stage === "applied")?.cards[0];

  if (sent === undefined) {
    throw new Error("no sent application was seeded");
  }

  const specific = await request.post("/__test__/reviews/seed", {
    data: {
      applicationIds: [sent.id],
      fieldType: "text",
      options: [],
      prompt: "Why do you want to work at this company?",
      userId,
    },
  });

  expect(specific.ok()).toBe(true);

  const reusable = await request.post("/__test__/reviews/seed", {
    data: {
      applicationIds: [sent.id],
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Are you authorized to work in Canada?",
      userId,
    },
  });

  expect(reusable.ok()).toBe(true);

  return reviewsSchema.parse(await (await request.get("/api/reviews")).json()).reviews;
}

test("the phone opens List by default, keeps Board one tap away, and hides Closed", async ({
  viewsServer,
  browser,
}) => {
  const { context, page, request } = await openSeeded(browser, viewsServer.url, 390);
  const views = page.getByRole("group", { name: "Application views" });

  await expect(views.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
  await expect(views.getByRole("button", { name: "Calendar" })).toHaveCount(0);
  await expect(page.locator(LIST)).toBeVisible();
  await expect(page.locator(LIST).getByRole("button").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Show closed (5)" })).toBeVisible();
  expect(await page.locator(LIST).getByRole("button").count()).toBeGreaterThan(20);

  await page.getByRole("button", { name: "Show closed (5)" }).click();
  await expect(page.getByRole("button", { name: "Hide closed" })).toBeVisible();
  await page.getByRole("button", { name: /^Closed/u }).click();
  await expect(page.locator(LIST).getByRole("button")).toHaveCount(5);

  await expectAxeClean(page);

  await views.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();
  await page
    .getByRole("group", { name: "Stages" })
    .getByRole("button", { name: "Applied" })
    .click();
  await expect(page.locator('section[aria-label="Applied"]')).toBeVisible();

  await context.close();
  await request.dispose();
});

test("the desktop opens Board by default and keeps Closed behind a toggle", async ({
  viewsServer,
  browser,
}) => {
  const { context, page, request } = await openSeeded(browser, viewsServer.url, 1280);
  const views = page.getByRole("group", { name: "Application views" });

  await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(views.getByRole("button", { name: "Calendar" })).toHaveCount(0);
  await expect(page.locator('section[aria-label="Interviews"]')).toBeVisible();
  await expect(page.locator('section[aria-label="Closed"]')).toHaveCount(0);
  await expect(page.getByText("Waiting", { exact: true })).toHaveCount(0);

  await expectAxeClean(page);

  await page.getByRole("button", { name: "Show closed (5)" }).click();
  await expect(page.locator('section[aria-label="Closed"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide closed" })).toBeVisible();

  await views.getByRole("button", { name: "List" }).click();
  await expect(page.locator(LIST)).toBeVisible();

  await context.close();
  await request.dispose();
});

test("Review defaults the save-for-future switch and confirms the save", async ({
  viewsServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: viewsServer.url });
  const userId = await seedBoardOwner(request, viewsServer.url);

  await seedBoard(request, userId);

  const reviews = await seedReviews(request, userId);
  const specific = reviews.find((review) => review.prompt.startsWith("Why do you want"));
  const reusable = reviews.find((review) => review.prompt.startsWith("Are you authorized"));

  if (specific === undefined || reusable === undefined) {
    throw new Error("the seeded Reviews were not listed");
  }

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, timezoneId: "America/Toronto" });
  const page = await context.newPage();

  const toggle = page.getByRole("switch", {
    name: "Save these answers for future applications",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${viewsServer.url}/review?question=${encodeURIComponent(reusable.id)}`);

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(specific.prompt)).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText(
      "Some of these answers look specific to this application, so saving is off by default.",
    ),
  ).toBeVisible();

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText("Every answer becomes a saved answer, reused whenever another form asks it."),
  ).toBeVisible();

  await page.getByRole("textbox", { name: specific.prompt }).fill("I use the product every day.");
  await page
    .getByRole("group", { name: reusable.prompt })
    .getByRole("button", { name: "Yes" })
    .click();

  const answered = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/api/reviews/answers"),
  );

  await page.getByRole("button", { name: "Save and continue" }).click();
  await answered;

  await expect(page.getByText("Saved for this application.")).toBeVisible();

  await context.close();
  await request.dispose();
});
