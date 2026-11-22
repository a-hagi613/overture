import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { request as apiRequest } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
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

const boardStageSchema = z.object({
  columns: z.array(z.object({ cards: z.array(z.object({ id: z.string() })), stage: z.string() })),
});

const SHEET = 'aside[aria-label="Application detail"]';
const SCREENSHOT_DIR = process.env["DOSSIER_SCREENSHOT_DIR"] ?? null;

async function seedSentDossier(
  request: APIRequestContext,
  appServerUrl: string,
  untraced: boolean,
) {
  const userId = await seedBoardOwner(request, appServerUrl);

  const resume = await request.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "maya-okafor-resume.pdf",
      },
    },
  });

  expect(resume.ok()).toBe(true);

  const { selectedId } = await seedBoard(request, userId);

  const snapshot = await request.post("/__test__/snapshots/seed", {
    data: {
      answers: [
        {
          answer: "Toronto, ON",
          fact_key: "current_city",
          fact_revision: 1,
          kind: "fact",
          by_user: false,
          label: "Current city",
          question_id: "q-city",
          resume_line_ids: [],
        },
        {
          answer: "No",
          by_user: true,
          fact_key: "q:sponsorship",
          fact_revision: 1,
          kind: "open_text",
          label: "Will you need sponsorship?",
          question_id: "q-sponsorship",
          resume_line_ids: [],
        },
        {
          answer: "maya-okafor-resume.pdf",
          by_user: false,
          fact_key: null,
          fact_revision: null,
          kind: "file",
          label: "Resume",
          question_id: "q-file",
          resume_line_ids: [],
        },
      ],
      applicationId: selectedId,
      coverLetter: [
        {
          resume_line_ids: ["L1"],
          sentence: "I led the migration of the order-intake pipeline.",
        },
        {
          by_user: !untraced,
          resume_line_ids: [],
          sentence: "I would like to join your platform team.",
        },
      ],
    },
  });

  expect(snapshot.ok()).toBe(true);

  return selectedId;
}

async function openSentSheet(
  browser: Browser,
  appServerUrl: string,
  width: number,
  scheme: "light" | "dark",
  untraced: boolean,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const selectedId = await seedSentDossier(request, appServerUrl, untraced);
  const storageState = await request.storageState();

  const context = await browser.newContext({
    colorScheme: scheme,
    storageState,
    timezoneId: "America/Toronto",
  });

  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
  await page.addInitScript((theme: string) => {
    globalThis.localStorage.setItem("overture.theme", theme);
    globalThis.localStorage.setItem("overture.rail", "1");
  }, scheme);
  await page.goto(`${appServerUrl}/board`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  if (width < 768) {
    const board = boardStageSchema.parse(await (await request.get("/api/board")).json());

    const stage = board.columns.find((column) =>
      column.cards.some((card) => card.id === selectedId),
    )?.stage;

    if (stage === undefined) {
      throw new Error("the selected card is in no stage");
    }

    await page
      .getByRole("tab", {
        name: new RegExp(`^${stage.charAt(0).toUpperCase()}${stage.slice(1)}`, "u"),
      })
      .click();
  }

  await page.locator(`button[data-card="${selectedId}"]`).filter({ visible: true }).click();
  await expect(page.locator(`${SHEET} h2`)).toBeVisible();

  return { context, page, request };
}

async function captureSheet(page: Page, name: string) {
  if (SCREENSHOT_DIR === null) {
    return;
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.locator(SHEET).screenshot({
    animations: "disabled",
    caret: "hide",
    path: join(SCREENSHOT_DIR, `${name}.png`),
  });
}

for (const [width, scheme] of [
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const) {
  test(`the Dossier panels show the real send at ${String(width)}px ${scheme}`, async ({
    boardServer,
    browser,
  }) => {
    const { context, page, request } = await openSentSheet(
      browser,
      boardServer.url,
      width,
      scheme,
      false,
    );

    const banner = page.getByRole("region", { name: "How this was sent" });

    await expect(banner).toContainText("Sent via Greenhouse");
    await expect(banner).toContainText("One submission. Nothing is sent after it.");

    await page.getByRole("tab", { name: "Cover letter & resume" }).click();
    await expect(page.getByRole("heading", { name: "The file is sent as-is" })).toBeVisible();
    await expect(page.getByText("maya-okafor-resume.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("The stored copy matches the bytes that were sent.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What Overture wrote from your facts" }),
    ).toBeVisible();
    await expect(page.getByText("current_city · revision 1")).toBeVisible();
    await expect(page.getByText("From your facts", { exact: true })).toBeVisible();
    await expect(page.getByText("Typed here").first()).toBeVisible();
    await expect(page.getByText("L1 · ", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("The PDF was not restyled or regenerated")).toBeVisible();
    await expect(page.getByText("No fact was invented")).toBeVisible();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

    expect(overflows).toBe(false);

    const results = await new AxeBuilder({ page }).include(SHEET).analyze();

    expect(results.violations, `${String(width)}px ${scheme}`).toEqual([]);

    await captureSheet(page, `dossier-${String(width)}-${scheme}`);

    await context.close();
    await request.dispose();
  });
}

test("a sentence with no recorded source says so and withholds the no-invention line", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request } = await openSentSheet(
    browser,
    boardServer.url,
    1280,
    "light",
    true,
  );

  await page.getByRole("tab", { name: "Cover letter & resume" }).click();

  await expect(page.getByText("No source recorded")).toBeVisible();
  await expect(page.getByText("No fact was invented")).toHaveCount(0);
  await expect(page.getByText("The PDF was not restyled or regenerated")).toBeVisible();

  await context.close();
  await request.dispose();
});
