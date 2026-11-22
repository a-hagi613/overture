import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";

import type { Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { openBoard, seedBoard, seedBoardOwner } from "./board-harness.ts";

const test = appTest.extend<{ detailServer: AppServer }>({
  detailServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

async function box(page: Page, locator: ReturnType<Page["locator"]>) {
  const value = await locator.boundingBox();

  expect(value).not.toBeNull();

  return value ?? { height: 0, width: 0, x: 0, y: 0 };
}

for (const width of [1280, 390]) {
  test(`the Calendar keeps its month header and legend outside the grid card at ${String(width)}px`, async ({
    browser,
    appServerUrl,
    ownerStorageState,
  }) => {
    const context = await browser.newContext({
      storageState: ownerStorageState,
      viewport: { width, height: width === 1280 ? 900 : 844 },
    });

    const page = await context.newPage();

    await page.goto(`${appServerUrl}/calendar`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const month = await box(
      page,
      page.getByRole("heading", { level: 2, name: /November/u }).first(),
    );

    const grid = page.getByRole("list", { name: /one day per cell/u });
    const card = await box(page, grid.locator("xpath=.."));
    const legend = await box(page, page.getByRole("list", { name: "Colour key" }));

    expect(month.y + month.height).toBeLessThanOrEqual(card.y);
    expect(legend.y).toBeGreaterThanOrEqual(card.y + card.height);

    const previous = await box(page, page.getByRole("button", { name: "Previous month" }));
    const next = await box(page, page.getByRole("button", { name: "Next month" }));
    const today = await box(page, page.getByRole("button", { name: "Today" }));

    expect(previous.x).toBeLessThan(next.x);
    expect(next.x).toBeLessThan(today.x);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations, `${String(width)}px`).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow).toBeLessThanOrEqual(0);

    await context.close();
  });
}

test("the card detail uses the card detail board's tab names and reference", async ({
  browser,
  detailServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: detailServer.url });

  const userId = await seedBoardOwner(request, detailServer.url);

  await request.post("/api/profile/resume", {
    multipart: {
      file: {
        name: "Maya_Okafor_Resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      },
    },
  });

  const { selectedId } = await seedBoard(request, userId);

  const seeded = await request.post("/__test__/snapshots/seed", {
    data: {
      answers: [
        {
          answer: "Yes",
          by_user: false,
          fact_key: "work_authorization",
          fact_revision: 1,
          kind: "fact",
          label: "Are you legally authorized to work in Canada?",
          question_id: "q-fact",
          resume_line_ids: [],
        },
      ],
      applicationId: selectedId,
      coverLetter: [
        { resume_line_ids: [], sentence: "Dear Halden Systems hiring team," },
        {
          resume_line_ids: [],
          sentence:
            "Halden Systems' focus on dependable platform tooling matches the work I do best.",
        },
        { resume_line_ids: [], sentence: "Maya Okafor" },
      ],
    },
  });

  expect(seeded.ok()).toBe(true);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  await openBoard(page, detailServer.url, 1280, selectedId);
  await expect(page.getByRole("tablist", { name: "Application sections" })).toBeVisible();

  const tabs = page.getByRole("tablist", { name: "Application sections" }).getByRole("tab");

  await expect(tabs).toHaveText(["Overview", "Questions", "Cover letter & resume", "Emails"]);
  await expect(page.getByText(/Application · no\./u)).toBeVisible();

  await page.getByRole("tab", { name: "Cover letter & resume" }).click();
  await expect(page.getByText("Dear Halden Systems hiring team,")).toBeVisible();
  await expect(page.getByText("0 resume lines")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  await context.close();
});

test("the Settings submenu lists the pages from the settings navigation board", async ({
  browser,
  appServerUrl,
  ownerStorageState,
}) => {
  const context = await browser.newContext({ storageState: ownerStorageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${appServerUrl}/`);

  const aside = page.locator("aside");

  await aside.getByRole("button", { name: "Show settings pages" }).click();

  const panel = page.locator("#settings-pages");

  await expect(panel.getByRole("link")).toHaveText([
    "Profile data",
    "Notifications",
    "Billing",
    "Export",
    "Delete account",
    "Support",
    "Terms and privacy",
  ]);

  await context.close();
});
