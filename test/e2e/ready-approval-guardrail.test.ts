import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { seedReady } from "./ready-harness.ts";

const test = appTest.extend<{ readyServer: AppServer }>({
  readyServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const createdSchema = z.object({ id: z.string() });

const readySchema = z.object({
  cards: z.array(
    z.object({
      company: z.string(),
      id: z.string(),
      plan: z.object({ hasGeneratedProse: z.boolean(), planSha256: z.string() }).nullable(),
      status: z.string(),
    }),
  ),
});

async function readyOf(request: APIRequestContext) {
  return readySchema.parse(await (await request.get("/api/ready")).json());
}

async function seedSavedOnlyPosting(request: APIRequestContext, userId: string) {
  const companyId = await seedCompany(request, "Cobalt Freight", "cobalt-freight.example");
  const boardId = await seedBoard(request, companyId, "greenhouse", "cobalt");

  const postingId = await seedPosting(request, {
    atsJobId: "590-cobalt",
    boardId,
    companyId,
    questions: [
      {
        answerKind: "fact",
        factKey: "legal_name",
        fieldName: "full_name",
        fieldType: "text",
        options: [],
        required: true,
        text: "Full name",
      },
    ],
    title: "Data Engineer",
    url: "https://cobalt-freight.example/jobs/590",
  });

  return createdSchema.parse(
    await (
      await request.post("/__test__/applications/seed", {
        data: {
          boardPosition: 2,
          postingId,
          stage: "ready",
          status: "ready",
          userId,
        },
      })
    ).json(),
  ).id;
}

async function approveByCompany(request: APIRequestContext, company: string) {
  const card = (await readyOf(request)).cards.find((candidate) => candidate.company === company);

  if (card?.plan === null || card?.plan === undefined) {
    throw new Error(`no plan for ${company}`);
  }

  const response = await request.post(`/api/applications/${encodeURIComponent(card.id)}/approve`, {
    data: { planSha256: card.plan.planSha256 },
  });

  expect(response.ok()).toBe(true);
}

async function captureShot(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  directory: string,
  width: number,
  theme: string,
) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: width === 390 ? 844 : 900, width },
  });

  const page = await context.newPage();

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.addInitScript(() => {
    globalThis.localStorage.setItem("overture.rail", "0");
  });

  await page.goto(`${appServerUrl}/ready`);
  await expect(page.getByRole("heading", { level: 1, name: "Approval Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Platform Engineer" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect Northwind Labs" }).click();
  await expect(page.getByText("Written for this role").first()).toBeVisible();

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  if (width === 390) {
    await page.getByRole("button", { name: "Approve" }).first().scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeInViewport();

    await page.screenshot({
      fullPage: false,
      path: join(directory, `ready-${String(width)}-${theme}.png`),
    });
  } else {
    await page.screenshot({
      fullPage: true,
      path: join(directory, `ready-${String(width)}-${theme}.png`),
    });
  }

  await context.close();
}

async function captureReady(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  directory: string,
) {
  mkdirSync(directory, { recursive: true });

  const shots = [1280, 390].flatMap((width) =>
    ["light", "dark"].map((theme) => ({ theme, width })),
  );

  await Promise.all(
    shots.map(async ({ theme, width }) =>
      captureShot(browser, appServerUrl, storageState, directory, width, theme),
    ),
  );
}

function cardFor(page: Page, roleTitle: string) {
  return page.locator('section[aria-label="Applications ready to send"] article').filter({
    has: page.getByRole("heading", { level: 2, name: roleTitle }),
  });
}

const dwellBodySchema = z.object({ dwellMs: z.number().int().min(0).max(86_400_000) });

const optionalDwellBodySchema = z.object({
  dwellMs: z.number().int().min(0).max(86_400_000).optional(),
});

test("drafted prose expands, saved answers collapse, and A, E and S triage one card", async ({
  browser,
  readyServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: readyServer.url });
  const userId = await seedReady(request, readyServer.url);

  await seedSavedOnlyPosting(request, userId);

  const storageState = await request.storageState();
  const captureDir = process.env.READY_CAPTURE_DIR;

  if (captureDir !== undefined) {
    await captureReady(browser, readyServer.url, storageState, captureDir);
  }

  const context = await browser.newContext({
    storageState,
    timezoneId: "America/Toronto",
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${readyServer.url}/ready`);

  const queue = page.locator('section[aria-label="Applications ready to send"]');
  const northwind = cardFor(page, "Platform Engineer");
  const drawer = page.getByRole("dialog", { name: "Inspect prepared application" });

  await queue.getByRole("button", { name: "Inspect Northwind Labs" }).click();
  await expect(drawer.getByText("Saved answer").first()).toBeVisible();
  await expect(drawer.getByText("maya-okafor-2026.pdf")).toHaveCount(0);

  await drawer.getByRole("button", { name: /Show more/u }).click();
  await expect(drawer.getByText("maya-okafor-2026.pdf")).toBeVisible();

  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await queue.getByRole("button", { name: "Inspect Cobalt Freight" }).click();
  await expect(drawer.getByText("Saved answers only")).toBeVisible();
  await expect(drawer.getByText("maya-okafor-2026.pdf")).toBeVisible();
  await expect(drawer.getByRole("button", { name: /Show more/u })).toHaveCount(0);

  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("e");

  const textbox = drawer.getByRole("textbox", {
    name: "Your answer to Are you comfortable with a weekly on-call rotation?",
  });

  await expect(textbox).toBeVisible();
  await textbox.fill("typed here");
  await textbox.press("a");
  await expect(page.getByRole("button", { name: "Approve & schedule" })).toHaveCount(0);
  await expect(textbox).toHaveValue("typed herea");
  await drawer.getByRole("button", { name: "Cancel" }).click();
  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("heading", { level: 1 }).click();
  await page.keyboard.press("s");
  await expect(northwind).toHaveCount(0);

  const skipToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Skipped Northwind Labs." });

  await skipToast.getByRole("button", { name: "Undo" }).click();
  await expect(northwind).toBeVisible();

  await page.getByRole("heading", { level: 1 }).click();

  const approvalRequest = page.waitForRequest((candidate) => {
    if (
      candidate.method() !== "POST" ||
      !/\/api\/applications\/[^/]+\/approve$/u.test(candidate.url())
    ) {
      return false;
    }

    return optionalDwellBodySchema.safeParse(candidate.postDataJSON()).success;
  });

  await page.keyboard.press("a");
  await page.getByRole("button", { name: "Approve & schedule" }).click();
  const sent = await approvalRequest;
  const sentBody = dwellBodySchema.parse(sent.postDataJSON());

  expect(Number.isInteger(sentBody.dwellMs)).toBe(true);
  expect(sentBody.dwellMs).toBeGreaterThanOrEqual(0);
  expect(sentBody.dwellMs).toBeLessThanOrEqual(86_400_000);
  await expect(page.getByText("Scheduled to send to Northwind Labs.")).toBeVisible();

  const approvalToast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Scheduled to send to Northwind Labs." });

  await expect(approvalToast.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(
    page
      .locator('section[aria-label="Scheduled applications"]')
      .getByText("Northwind Labs", { exact: true })
      .first(),
  ).toBeVisible();

  await context.close();
  await request.dispose();
});

test("a batch approval is refused while any card carries newly drafted prose", async ({
  readyServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: readyServer.url });
  const userId = await seedReady(request, readyServer.url);

  await seedSavedOnlyPosting(request, userId);

  const ready = await readyOf(request);
  const northwind = ready.cards.find((card) => card.company === "Northwind Labs");
  const halden = ready.cards.find((card) => card.company === "Halden Systems");

  expect(northwind?.plan?.hasGeneratedProse).toBe(true);
  expect(halden?.plan?.hasGeneratedProse).toBe(false);

  const refused = await request.post("/api/ready/approve", {
    data: {
      items: [
        { id: northwind?.id ?? "", planSha256: northwind?.plan?.planSha256 ?? "" },
        { id: halden?.id ?? "", planSha256: halden?.plan?.planSha256 ?? "" },
      ],
    },
  });

  expect(refused.status()).toBe(422);
  expect(z.object({ error: z.string() }).parse(await refused.json()).error).toBe(
    "requires_individual_review",
  );

  const after = await readyOf(request);

  expect(after.cards.filter((card) => card.status === "ready")).toHaveLength(3);

  await request.dispose();
});

test("only drafted cards leaves no batch button, and individual approval still works", async ({
  browser,
  readyServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: readyServer.url });
  const userId = await seedReady(request, readyServer.url);

  await seedSavedOnlyPosting(request, userId);
  await approveByCompany(request, "Halden Systems");
  await approveByCompany(request, "Cobalt Freight");

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 900, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${readyServer.url}/ready`);

  await expect(page.getByRole("button", { name: /saved-only/u })).toHaveCount(0);

  const northwind = cardFor(page, "Platform Engineer");

  await northwind.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Approve & schedule" }).click();
  await expect(page.getByText("Scheduled to send to Northwind Labs.")).toBeVisible();

  await context.close();
  await request.dispose();
});
