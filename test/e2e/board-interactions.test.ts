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

async function dragCardTo(
  page: Page,
  card: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
) {
  const from = await card.boundingBox();
  const to = await target.boundingBox();

  if (from === null || to === null) {
    throw new Error("missing drag bounding box");
  }

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(to.height / 2, 120), { steps: 10 });
  await page.mouse.up();
  await response;
}

test("dragging a card on desktop moves it and locks it", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 1280);
  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the applied card has no id");
  }

  await dragCardTo(page, card, page.locator('section[aria-label="Waiting"]'));

  await expect(page.locator(`section[aria-label="Waiting"] button[data-card="${id}"]`)).toHaveCount(
    1,
  );

  const state = await cardState(request, id);

  expect(state?.stage).toBe("screening");
  expect(state?.stageLocked).toBe(true);

  await context.close();
  await request.dispose();
});

test("arrow keys move a card on desktop and lock it", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 1280);
  const card = page.locator('section[aria-label="Applied"] button[data-card]').nth(1);
  const id = await card.getAttribute("data-card");

  if (id === null) {
    throw new Error("the applied card has no id");
  }

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await card.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await response;

  const state = await cardState(request, id);

  expect(state?.stage).toBe("screening");
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

  const stage = page.getByRole("button", { name: "Waiting" });

  const stageBox = await stage.evaluate((element) => {
    const rect = element.getBoundingClientRect();

    return { height: rect.height, width: rect.width, x: rect.x, y: rect.y };
  });

  await page.clock.install();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.clock.fastForward(300);
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2, {
    steps: 10,
  });

  const response = page.waitForResponse(
    (candidate) => candidate.request().method() === "PATCH" && candidate.url().includes("/stage"),
  );

  await page.mouse.up();
  await response;

  const state = await cardState(request, id);

  expect(state?.stage).toBe("screening");
  expect(state?.stageLocked).toBe(true);

  await context.close();
  await request.dispose();
});

test("tapping the phone stage tabs changes the visible lane", async ({ boardServer, browser }) => {
  const { context, page, request } = await openSeeded(browser, boardServer.url, 390);

  await expect(page.getByRole("group", { name: "Stages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Applied" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('section[aria-label="Applied"]')).toBeVisible();

  await page.getByRole("button", { name: "Waiting" }).click();
  await expect(page.getByRole("button", { name: "Waiting" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('section[aria-label="Waiting"]')).toBeVisible();

  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("button", { name: "Closed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('section[aria-label="Closed"]')).toBeVisible();

  await page.getByRole("button", { name: "Queued" }).click();
  await expect(page.getByRole("button", { name: "Queued" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('section[aria-label="Queued"]')).toBeVisible();

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
  await expect(page.locator('dialog[aria-label="Application detail"] h2')).toBeVisible();

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

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(z.object({ id: z.string() })),
      stage: z.string(),
    }),
  ),
});

type Variant = "traced" | "untraced" | "mismatch" | "email" | "empty";

const SHEET = 'dialog[aria-label="Application detail"]';
const SCREENSHOT_DIR = process.env["DOSSIER_SCREENSHOT_DIR"] ?? null;
const COVER_TAB = { name: "Cover letter & resume" } as const;

async function seedSentApplication(
  request: APIRequestContext,
  appServerUrl: string,
  variant: Variant,
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

  const empty = variant === "empty";

  const snapshot = await request.post("/__test__/snapshots/seed", {
    data: {
      answers: empty
        ? []
        : [
            {
              answer: "Toronto, ON",
              by_user: false,
              fact_key: "current_city",
              fact_revision: 1,
              kind: "fact",
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
      confirmedBy: variant === "email" ? "email" : "page",
      coverLetter: empty
        ? null
        : [
            {
              resume_line_ids: ["L1"],
              sentence: "I led the migration of the order-intake pipeline.",
            },
            {
              by_user: variant !== "untraced",
              resume_line_ids: [],
              sentence: "I would like to join your platform team.",
            },
          ],
      resumeSha256: variant === "mismatch" ? "b".repeat(64) : undefined,
    },
  });

  expect(snapshot.ok()).toBe(true);

  return { selectedId, userId };
}

async function openCard(
  browser: Browser,
  appServerUrl: string,
  request: APIRequestContext,
  cardId: string,
  width: number,
  scheme: "light" | "dark",
) {
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
    const board = boardSchema.parse(await (await request.get("/api/board")).json());

    const stage = board.columns.find((column) =>
      column.cards.some((card) => card.id === cardId),
    )?.stage;

    if (stage === undefined) {
      throw new Error("the selected card is in no stage");
    }

    const mobileTabLabels = new Map<string, string>([
      ["applied", "Applied"],
      ["closed", "Closed"],
      ["interviewing", "Waiting"],
      ["offer", "Waiting"],
      ["queued", "Queued"],
      ["ready", "Ready"],
      ["screening", "Waiting"],
    ]);

    await page.getByRole("button", { name: mobileTabLabels.get(stage) ?? "Applied" }).click();
  }

  await page.locator(`button[data-card="${cardId}"]`).filter({ visible: true }).click();
  await expect(page.locator(`${SHEET} h2`)).toBeVisible();

  return { context, page };
}

async function openSentSheet(
  browser: Browser,
  appServerUrl: string,
  width: number,
  scheme: "light" | "dark",
  variant: Variant = "traced",
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });
  const { selectedId } = await seedSentApplication(request, appServerUrl, variant);

  const { context, page } = await openCard(
    browser,
    appServerUrl,
    request,
    selectedId,
    width,
    scheme,
  );

  return { context, page, request, selectedId };
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

async function captureSection(page: Page, heading: string, name: string) {
  if (SCREENSHOT_DIR === null) {
    return;
  }

  await page.getByRole("heading", { name: heading }).scrollIntoViewIfNeeded();
  await captureSheet(page, name);
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
    const { context, page, request } = await openSentSheet(browser, boardServer.url, width, scheme);

    const banner = page.getByRole("region", { name: "How this was sent" });

    await expect(banner).toContainText("Sent via Greenhouse");
    await expect(banner).toContainText("One submission. Nothing is sent after it.");

    await page.getByRole("tab", COVER_TAB).click();
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

    const base = `dossier-${String(width)}-${scheme}`;

    await page.evaluate(() => {
      document
        .querySelector("dialog[aria-label='Application detail'] [data-scroll-region]")
        ?.scrollTo(0, 0);
    });
    await captureSheet(page, base);
    await captureSection(page, "The file is sent as-is", `${base}-file`);
    await captureSection(page, "What Overture wrote from your facts", `${base}-trace`);
    await captureSection(page, "What did not happen", `${base}-did-not-happen`);

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
    "untraced",
  );

  await page.getByRole("tab", COVER_TAB).click();

  await expect(page.getByText("No source recorded")).toBeVisible();
  await expect(page.getByText("No fact was invented")).toHaveCount(0);
  await expect(page.getByText("The PDF was not restyled or regenerated")).toBeVisible();

  await context.close();
  await request.dispose();
});

test("a file that does not match the sent hash is titled as not the file that was sent", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request } = await openSentSheet(
    browser,
    boardServer.url,
    1280,
    "light",
    "mismatch",
  );

  await page.getByRole("tab", COVER_TAB).click();

  await expect(
    page.getByRole("heading", { name: "The stored file is not the file that was sent" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "The file is sent as-is" })).toHaveCount(0);
  await expect(page.getByText("The PDF was not restyled or regenerated")).toHaveCount(0);
  await expect(
    page.getByText(
      "The stored copy does not match the bytes that were sent. Check this before you rely on it.",
    ),
  ).toBeVisible();

  await context.close();
  await request.dispose();
});

test("an email confirmation is worded as email, not as a confirmation page", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request } = await openSentSheet(
    browser,
    boardServer.url,
    1280,
    "light",
    "email",
  );

  const banner = page.getByRole("region", { name: "How this was sent" });

  await expect(banner).toContainText("The employer's confirmation email was received.");
  await expect(banner).not.toContainText("confirmation page was seen");

  await context.close();
  await request.dispose();
});

test("an empty snapshot says nothing was written and still shows the file panel", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request } = await openSentSheet(
    browser,
    boardServer.url,
    1280,
    "light",
    "empty",
  );

  await page.getByRole("tab", COVER_TAB).click();

  await expect(page.getByText("Nothing was written for this application.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The file is sent as-is" })).toBeVisible();

  await context.close();
  await request.dispose();
});

test("an application that was not sent says so on the cover tab", async ({
  boardServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: boardServer.url });
  const userId = await seedBoardOwner(request, boardServer.url);

  await seedBoard(request, userId);

  const board = boardSchema.parse(await (await request.get("/api/board")).json());
  const queued = board.columns.find((column) => column.stage === "queued")?.cards[0];

  if (queued === undefined) {
    throw new Error("the board seeded no queued card");
  }

  const { context, page } = await openCard(
    browser,
    boardServer.url,
    request,
    queued.id,
    1280,
    "light",
  );

  await page.getByRole("tab", COVER_TAB).click();

  await expect(page.getByText("This application has not been sent yet.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What Overture wrote from your facts" }),
  ).toHaveCount(0);

  await context.close();
  await request.dispose();
});

test("the cover tab is reachable and activatable from the keyboard", async ({
  boardServer,
  browser,
}) => {
  const { context, page, request, selectedId } = await openSentSheet(
    browser,
    boardServer.url,
    1280,
    "light",
    "traced",
  );

  await page.getByRole("tab", { name: "Timeline" }).focus();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Answers" })).toBeFocused();
  await page.keyboard.press("ArrowRight");

  await expect(page.getByRole("tab", COVER_TAB)).toBeFocused();

  await page.keyboard.press("Enter");

  await expect(page.getByRole("tab", COVER_TAB)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "The file is sent as-is" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.locator(SHEET)).toHaveCount(0);
  await expect(
    page.locator(`button[data-card="${selectedId}"]`).filter({ visible: true }),
  ).toBeFocused();

  await context.close();
  await request.dispose();
});
