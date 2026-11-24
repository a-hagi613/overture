import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { copy } from "../../src/shared/copy.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { seedBoard as seedTrackerBoard, seedBoardOwner } from "./board-harness.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";
import {
  seedApplication,
  seedBoard as seedCatalogBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { TRACKER_LANES } from "../../src/web/lib/tracker-lanes.ts";

const test = appTest.extend<{ uiServer: AppServer }>({
  uiServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const SHEET = 'dialog[aria-label="Application detail"]';
const reviewCreatedSchema = z.object({ questionId: z.string(), reviewId: z.string() });

const applicationStageSchema = z.object({
  application: z.object({ stage: z.string().nullable() }),
});

const clockSchema = z.object({ now: z.number() });

const WAITING_LABEL = TRACKER_LANES.find((lane) => lane.key === "waiting")?.label ?? "Waiting";

function laneLabel(key: string) {
  return TRACKER_LANES.find((lane) => lane.key === key)?.label ?? key;
}

async function storedStage(request: APIRequestContext, id: string) {
  return applicationStageSchema.parse(
    await (await request.get(`/api/applications/${encodeURIComponent(id)}`)).json(),
  ).application.stage;
}

const REVIEW_WORDS = ["alpha", "beta"] as const;

async function seedReview(request: APIRequestContext, userId: string, index: number) {
  const word = REVIEW_WORDS[index] ?? `extra-${String(index)}`;
  const prompt = `How many years of platform work at ${word}?`;
  const companyName = `Review Co ${word}`;
  const company = await seedCompany(request, companyName, null);

  const board = await seedCatalogBoard(
    request,
    company,
    "greenhouse",
    `review-board-${String(index)}`,
  );

  const posting = await seedPosting(request, {
    atsJobId: `ui-followup-review-${String(index)}`,
    boardId: board,
    companyId: company,
    tags: [{ dimension: "subrole", value: "Platform" }],
    title: `Platform Engineer ${String(index)}`,
    url: `https://review-co-${String(index)}.example/jobs/1`,
  });

  const application = await seedApplication(request, {
    createdAt: index + 1,
    postingId: posting,
    status: "needs_review",
    userId,
  });

  const seeded = await request.post("/__test__/reviews/seed", {
    data: {
      applicationIds: [application],
      fieldType: "text",
      options: [],
      prompt,
      userId,
    },
  });

  const seededBody = await seeded.text();

  expect(seeded.ok(), `${String(seeded.status())} ${seededBody}`).toBe(true);
  reviewCreatedSchema.parse(JSON.parse(seededBody));

  return { company: companyName, prompt };
}

test("view switches are segmented controls and the detail sheet has real tab panels", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/home`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const styleGroup = page.getByRole("group", { name: copy.home.chart.styleLabel });

  await expect(styleGroup).toBeVisible();
  await expect(page.getByRole("button", { name: copy.home.chart.areaLabel })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: copy.home.chart.barLabel })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(
    page.getByRole("group", { name: copy.home.chart.styleLabel }).getByRole("tab"),
  ).toHaveCount(0);

  const homeAxe = await new AxeBuilder({ page }).analyze();

  expect(homeAxe.violations).toEqual([]);

  await page.goto(`${uiServer.url}/board`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: copy.board.stagesLabel })).toBeVisible();

  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();

  await card.click();
  await expect(page.locator(SHEET)).toBeVisible();

  const timeline = page.getByRole("tab", { name: copy.board.tabs.timeline });
  const controls = await timeline.getAttribute("aria-controls");

  expect(controls).not.toBeNull();

  const panel = page.locator(`#${controls ?? ""}`);

  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", (await timeline.getAttribute("id")) ?? "");
  await expect(panel).toHaveAttribute("tabindex", "0");

  await timeline.focus();
  await page.keyboard.press("Tab");

  expect(await panel.evaluate((element) => element === globalThis.document.activeElement)).toBe(
    true,
  );
  expect(await panel.evaluate((element) => globalThis.getComputedStyle(element).outlineWidth)).toBe(
    "2px",
  );

  const sheetAxe = await new AxeBuilder({ page }).include(SHEET).analyze();

  expect(sheetAxe.violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("the Board card and phone lane live in the URL through refresh and Back", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/board`);
  await expect(page.locator('section[aria-label="Applied"]')).toBeVisible();

  await page.getByRole("button", { name: WAITING_LABEL }).click();
  await expect(page).toHaveURL(/[?&]filter=waiting/u);
  await expect(page.getByRole("button", { name: WAITING_LABEL })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await expect(page.locator('section[aria-label="Waiting"]')).toBeVisible();
  await expect(page.getByRole("button", { name: WAITING_LABEL })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Applied" }).click();
  await expect(page.locator('section[aria-label="Applied"]')).toBeVisible();

  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  await card.click();
  await expect(page.locator(SHEET)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]card=${id ?? ""}`, "u"));

  await page.reload();
  await expect(page.locator(SHEET)).toBeVisible();

  await page.goBack();
  await expect(page.locator(SHEET)).toHaveCount(0);
  await expect(page).toHaveURL(/\/board(?:\?.*)?$/u);

  await context.close();
  await request.dispose();
});

test("the Review question and filter live in the URL and Back returns to the phone list", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedReview(request, userId, 0);
  const second = await seedReview(request, userId, 1);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/review`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const filterGroup = page.getByRole("group", { name: copy.review.filters });
  const category = filterGroup.getByRole("button").filter({ hasNotText: copy.review.all }).first();

  await category.click();
  await expect(page).toHaveURL(/[?&]filter=/u);

  const filter = new URL(page.url()).searchParams.get("filter");

  expect(filter).not.toBeNull();
  await page.reload();
  await expect(filterGroup.getByRole("button", { name: copy.review.all })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.goto(`${uiServer.url}/review`);
  await page.getByRole("button", { name: copy.review.back, exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(second.company, "u") })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(second.company, "u") }).click();
  await expect(page.getByRole("heading", { name: second.prompt })).toBeVisible();
  await expect(page).toHaveURL(/[?&]question=/u);

  await page.reload();
  await expect(page.getByRole("heading", { name: second.prompt })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { name: second.prompt })).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(second.company, "u") })).toBeVisible();

  await page.goForward();
  await expect(page.getByRole("heading", { name: second.prompt })).toBeVisible();
  await expect(page).toHaveURL(/[?&]question=/u);

  await context.close();
  await request.dispose();
});

test("the phone stage tabs move lanes with Arrow, Home and End when each tab is wrapped", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/board`);

  const lanes = page.getByRole("group", { name: copy.board.stagesLabel });
  const lane = (key: string) => lanes.getByRole("button", { name: laneLabel(key), exact: true });

  await expect(lane("applied")).toHaveAttribute("aria-pressed", "true");
  await lane("applied").focus();

  await page.keyboard.press("ArrowRight");
  await expect(lane("waiting")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`section[aria-label="${laneLabel("waiting")}"]`)).toBeVisible();

  await page.keyboard.press("End");
  await expect(lane("closed")).toBeFocused();
  await expect(lane("closed")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Home");
  await expect(lane("review")).toBeFocused();
  await expect(lane("review")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(lane("closed")).toHaveAttribute("aria-pressed", "true");

  await context.close();
  await request.dispose();
});

test("crossing to the desktop layout closes the phone More sheet and frees the page", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });

  await seedBoardOwner(request, uiServer.url);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/home`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: copy.nav.profilePages.mobileMore }).click();

  const sheet = page.locator('dialog[aria-labelledby="mobile-nav-sheet-title"]');

  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.setViewportSize({ height: 900, width: 1280 });

  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  await page.getByRole("button", { name: copy.shell.collapseSidebar }).click();
  await expect(page.getByRole("button", { name: copy.shell.collapseSidebar })).toHaveCount(0);

  await context.close();
  await request.dispose();
});

test("closing stacked sheets gives scrolling back to the page", async ({ uiServer, browser }) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/board`);

  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();

  await card.click();

  const sheet = page.locator(SHEET);

  await expect(sheet).toBeVisible();

  await page.goBack();
  await expect(sheet).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: copy.nav.profilePages.mobileMore }).click();

  const navSheet = page.locator('dialog[aria-labelledby="mobile-nav-sheet-title"]');

  await expect(navSheet).toBeVisible();

  await page.goForward();
  await expect(sheet).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.setViewportSize({ height: 900, width: 1280 });
  await expect(navSheet).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await context.close();
  await request.dispose();
});

test("a toast raised while the board sheet is open stays in the top layer and its Undo works", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  const eventsConnected = page.waitForResponse(
    (response) => response.url().endsWith("/api/events") && response.status() === 200,
  );

  await page.goto(`${uiServer.url}/board`);
  await eventsConnected;

  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  expect(id).not.toBeNull();

  const applicationId = id ?? "";

  await card.click();

  const sheet = page.locator(SHEET);

  await expect(sheet).toBeVisible();

  const moved = await request.patch(
    `/api/applications/${encodeURIComponent(applicationId)}/stage`,
    {
      data: { position: null, stage: "screening" },
    },
  );

  expect(moved.ok(), `${String(moved.status())} ${await moved.text()}`).toBe(true);
  await expect.poll(async () => storedStage(request, applicationId)).toBe("screening");

  const clock = clockSchema.parse(await (await request.get("/__test__/clock")).json());

  const seeded = await request.post("/__test__/applications/events/seed", {
    data: {
      applicationId,
      events: [
        {
          at: clock.now + 60_000,
          detail: "A recruiter asked for your availability. Moved to Screening.",
          fromValue: "applied",
          kind: "stage",
          source: "email",
          toValue: "screening",
        },
      ],
    },
  });

  expect(seeded.ok(), `${String(seeded.status())} ${await seeded.text()}`).toBe(true);

  const published = await request.post("/__test__/events/publish", {
    data: {
      payload: { applicationId, source: "email", stage: "screening" },
      topic: "board.moved",
      userId,
    },
  });

  expect(published.ok(), `${String(published.status())} ${await published.text()}`).toBe(true);

  const toast = page.locator("[data-sonner-toast]");

  await expect(toast).toContainText(copy.board.moved(copy.board.columns.screening));
  expect(await toast.evaluate((element) => element.closest("dialog") !== null)).toBe(true);

  const undo = toast.getByRole("button", { name: copy.board.undo });

  await expect(undo).toBeVisible();
  await undo.click();

  await expect.poll(async () => storedStage(request, applicationId)).toBe("applied");
  await expect(toast).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await expect(page.getByPlaceholder(copy.shell.searchPlaceholder)).toBeVisible();
  await expect(sheet).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(copy.shell.searchPlaceholder)).toHaveCount(0);

  await context.close();
  await request.dispose();
});

test("notifications group by the profile zone, not the browser zone", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });

  await requestMagicLink(uiServer.url, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(uiServer.url, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${uiServer.url}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });

  const home = z
    .object({ timeZone: z.string() })
    .parse(await (await request.get("/api/home")).json());

  expect(home.timeZone).toBe("UTC");

  const probe = "Zone probe: grouped by the profile zone";

  const clock = z
    .object({ now: z.number() })
    .parse(await (await request.get("/__test__/clock")).json());

  await request.post("/__test__/notifications/seed", {
    data: {
      email: authTestIdentity.ownerEmail,
      rows: [
        {
          at: Math.floor(clock.now / 86_400_000) * 86_400_000 + 1_800_000,
          body: "Seeded before local midnight in Toronto, after it in UTC.",
          kind: "ready",
          title: probe,
          url: "/ready",
        },
      ],
    },
  });

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: 844, width: 390 },
  });

  const page = await context.newPage();

  await page.goto(`${uiServer.url}/notifications`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  expect(browserZone).toBe("America/Toronto");
  await expect(page.getByTestId("notifications-today")).toContainText(probe);
  await expect(page.getByTestId("notifications-earlier")).toHaveCount(0);

  const { violations } = await new AxeBuilder({ page }).analyze();

  expect(violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("a sheet is truly modal, keeps focus inside, and returns it on Escape", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });
  const userId = await seedBoardOwner(request, uiServer.url);

  await seedTrackerBoard(request, userId);

  const storageState = await request.storageState();
  const context = await browser.newContext({ storageState, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();

  await page.goto(`${uiServer.url}/home`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const more = page.getByRole("button", { name: copy.nav.profilePages.mobileMore });

  await more.click();

  const navSheet = page.locator('dialog[aria-labelledby="mobile-nav-sheet-title"]');

  await expect(navSheet).toBeVisible();
  expect(await navSheet.evaluate((element) => element.matches(":modal"))).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await navSheet.getByRole("link").last().focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);

  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('a[href="#main-content"]')?.focus();
  });
  expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(navSheet).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await page.goto(`${uiServer.url}/board`);
  const card = page.locator('section[aria-label="Applied"] button[data-card]').first();
  const id = await card.getAttribute("data-card");

  await card.click();

  const sheet = page.locator(SHEET);

  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => element.matches(":modal"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.locator(`button[data-card="${id ?? ""}"]`).filter({ visible: true }),
  ).toBeFocused();

  await context.close();
  await request.dispose();
});

test("the theme flip cross-fades and stays instant under reduced motion", async ({
  uiServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: uiServer.url });

  await seedBoardOwner(request, uiServer.url);

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  const homeResponse = await page.goto(`${uiServer.url}/home`);

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const bootScripts = page.locator("head script:not([src])");

  await expect(bootScripts).toHaveCount(1);
  await expect(page.locator('script[src="/theme-boot.js"]')).toHaveCount(0);

  const bootCode = (await bootScripts.first().textContent()) ?? "";

  expect(bootCode).toContain("overture.theme");
  const servedCsp = homeResponse?.headers()["content-security-policy"] ?? "";

  expect(servedCsp).toContain(
    `'sha256-${createHash("sha256").update(bootCode, "utf8").digest("base64")}'`,
  );

  const switched = await page.evaluate(() => {
    document.querySelector<HTMLElement>('[role="switch"]')?.click();

    return document.documentElement.className;
  });

  expect(switched).toContain("theme-switching");
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(page.locator("html")).not.toHaveClass(/theme-switching/u, { timeout: 2000 });

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/u);

  const reduced = await browser.newContext({
    reducedMotion: "reduce",
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const reducedPage = await reduced.newPage();

  await reducedPage.goto(`${uiServer.url}/home`);
  await expect(reducedPage.getByRole("heading", { level: 1 })).toBeVisible();

  const flip = await reducedPage.evaluate(() => {
    const switchControl = document.querySelector<HTMLElement>('[role="switch"]');

    switchControl?.click();

    return {
      duration: getComputedStyle(document.querySelector("main") ?? document.body)
        .transitionDuration,
      switching: document.documentElement.classList.contains("theme-switching"),
    };
  });

  expect(flip.switching).toBe(true);
  expect(Number(flip.duration.slice(0, -1))).toBeLessThan(0.01);

  await reduced.close();
  await context.close();
  await request.dispose();
});
