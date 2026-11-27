import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { AppServer } from "./app-server.ts";
import type { BrowserUseFixture } from "./browser-use-server.fixture.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startBrowserUseFixture } from "./browser-use-server.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

test.setTimeout(180_000);

const fixtureToken = (...parts: string[]) => parts.join("_");
const CARD_SECRET = "e2e-durable-tracker-card-secret-0123456789";
const SECRET_KEY = fixtureToken("sk", "test", "durabletracker");
const WEBHOOK_SECRET = fixtureToken("whsec", "durabletracker");
const SHOT_DIR = process.env.DURABLE_SHOT_DIR ?? join(process.cwd(), "docs/screenshots/687");

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const setupSchema = z.object({ url: z.url() });

const boardSchema = z.object({
  columns: z.array(
    z.object({
      cards: z.array(
        z.object({
          company: z.string(),
          id: z.string(),
          status: z.string(),
          title: z.string(),
        }),
      ),
      stage: z.string(),
    }),
  ),
  total: z.number(),
});

const detailSchema = z.object({ application: z.object({ status: z.string() }) });

const questions = [
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "first_name",
    fieldType: "text" as const,
    required: true,
    text: "First Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "last_name",
    fieldType: "text" as const,
    required: true,
    text: "Last Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "email",
    fieldName: "email",
    fieldType: "email" as const,
    required: true,
    text: "Email",
  },
  {
    answerKind: "skip" as const,
    fieldName: "resume",
    fieldType: "file" as const,
    required: true,
    text: "Resume/CV",
  },
];

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
];

async function screenshot(page: Page, width: number, theme: "dark" | "light") {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: join(SHOT_DIR, `tracker-${String(width)}-${theme}.png`),
  });
}

async function captureSendAllAt(page: Page, width: number, theme: "dark" | "light") {
  await page.setViewportSize({ height: 1000, width });
  await page.evaluate((value) => {
    globalThis.localStorage.setItem("overture.theme", value);
  }, theme);
  await page.reload();
  await expect(page.getByRole("button", { name: /Send all/u })).toBeVisible();
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    fullPage: true,
    path: join(SHOT_DIR, `send-all-${String(width)}-${theme}.png`),
  });
}

async function captureSendAll(page: Page) {
  await captureSendAllAt(page, 390, "light");
  await captureSendAllAt(page, 390, "dark");
  await captureSendAllAt(page, 1280, "light");
  await captureSendAllAt(page, 1280, "dark");
  await page.setViewportSize({ height: 1000, width: 1280 });
  await page.reload();
}

async function captureTrackerWidth(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  width: number,
) {
  const context = await browser.newContext({ storageState, viewport: { height: 900, width } });
  const page = await context.newPage();

  await page.goto(`${appServerUrl}/tracker`);
  await expect(page.getByRole("heading", { level: 1, name: /Application Tracker/u })).toBeVisible({
    timeout: 15_000,
  });

  await page.evaluate(() => {
    globalThis.localStorage.setItem("overture.theme", "light");
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Application Tracker/u })).toBeVisible({
    timeout: 15_000,
  });
  await screenshot(page, width, "light");

  await page.evaluate(() => {
    globalThis.localStorage.setItem("overture.theme", "dark");
  });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: /Application Tracker/u })).toBeVisible({
    timeout: 15_000,
  });
  await screenshot(page, width, "dark");

  await context.close();
}

async function captureTracker(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  await captureTrackerWidth(browser, appServerUrl, storageState, 390);
  await captureTrackerWidth(browser, appServerUrl, storageState, 1280);
}

interface SendHarness {
  anthropic: AnthropicFixtureServer;
  fixture: BrowserUseFixture;
  greenhouse: GreenhouseFixture;
  server: AppServer;
}

async function startSendHarness(identityServer: IdentityServer) {
  const anthropic = await startAnthropicFixtureServer();
  const fixture = startBrowserUseFixture({});
  const greenhouse = startGreenhouseFixture();

  const server = await startFreshAppServer(identityServer, {
    ANTHROPIC_API_KEY: "test-anthropic-key",
    ANTHROPIC_BASE_URL: anthropic.url,
    BROWSER_PROVIDER: "browser_use",
    BROWSER_PROXY_COUNTRY: "ca",
    BROWSER_USE_API_BASE_URL: fixture.url,
    BROWSER_USE_API_KEY: "browser-use-durable-test-key",
    BROWSER_USE_USAGE_SETTLE_MS: "30000",
    GREENHOUSE_BOARD_BASE_URL: greenhouse.url,
    OBJECT_STORE_ROOT: join("/tmp", `overture-durable-${String(process.pid)}`),
    SEND_HARD_TIMEOUT_MS: "30000",
  });

  return { anthropic, fixture, greenhouse, server };
}

async function runSends(owner: APIRequestContext, ids: readonly string[], index: number) {
  const id = ids[index];

  if (id === undefined) {
    return;
  }

  const run = await owner.post("/__test__/jobs/run-now", {
    data: {
      applicationId: id,
      kind: "application.send",
      payload: JSON.stringify({ applicationId: id }),
    },
  });

  expect(run.ok(), `running the send for ${id}`).toBe(true);
  await runSends(owner, ids, index + 1);
}

async function seedReadyPicks(harness: SendHarness) {
  const { owner, userId } = await ownerContextFor(harness.server.url);

  await owner.post("/api/running", { data: { running: true } });
  await owner.put("/api/profile/facts", { data: { facts } });
  await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const applicationIds = await Promise.all(
    ["8004209003", "8004209004", "8004209005"].map(async (jobId, index) => {
      const postingId = await seedPosting(owner, {
        atsJobId: jobId,
        boardId,
        companyId,
        questions,
        tags: [{ dimension: "subrole", value: "Operations" }],
        title: `Assistant General Manager ${String(index + 1)}`,
        url: `${harness.greenhouse.url}/blankstreet/jobs/${jobId}`,
      });

      return seedApplication(owner, { postingId, status: "ready", userId });
    }),
  );

  await grantApplications(owner, 3);

  return { applicationIds, owner };
}

test("a fresh user comes back from Stripe to the Tracker with exactly the same three picks", async ({
  browser,
  identityServer,
}) => {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  const request = await apiRequest.newContext({ baseURL: server.url });

  try {
    const { userId } = await seedOnboardingTargetsFlow(request, server.url);

    const context = await browser.newContext({
      storageState: await request.storageState(),
      viewport: { height: 1400, width: 1280 },
    });

    const page = await context.newPage();

    await walkOnboardingSteps1To4(page, server.url);

    const setup = setupSchema.parse(await (await request.post("/api/billing/trial/setup")).json());
    const sessionId = /cs_(?:test|live)_[A-Za-z0-9]+/u.exec(setup.url)?.at(0) ?? "";

    stripe.stubVerifiedSetupSession({
      fingerprint: "fp_fresh_user_tracker",
      id: sessionId,
      userId,
    });

    const matches = z
      .object({
        picks: z.object({
          picks: z.array(z.object({ company: z.string(), title: z.string() })),
        }),
      })
      .parse(await (await request.get("/api/onboarding/matches")).json());

    const { picks } = matches.picks;

    expect(picks).toHaveLength(3);

    await page.goto(`${server.url}/tracker?card=verified&session=${encodeURIComponent(sessionId)}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Application Tracker/u }),
    ).toBeVisible();
    await expect(page.locator("[data-card]")).toHaveCount(3);

    await Promise.all(
      picks.map(async (pick) =>
        expect(page.getByText(pick.title, { exact: false }).first()).toBeVisible(),
      ),
    );

    expect(page.url()).toContain("/tracker");
    expect(page.url()).not.toContain("onboarding");

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    const board = boardSchema.parse(await (await request.get("/api/board")).json());

    expect(board.total).toBe(3);

    const returned = board.columns
      .flatMap((column) => column.cards)
      .map((card) => `${card.title} · ${card.company}`)
      .toSorted();

    expect(returned).toEqual(picks.map((pick) => `${pick.title} · ${pick.company}`).toSorted());

    await context.close();
    await captureTracker(browser, server.url, await request.storageState());
  } finally {
    await request.dispose();
    await server.stop();
    await stripe.stop();
  }
});

test("Send all on the Tracker sends all three prepared applications through the Browser Use fixture", async ({
  browser,
  identityServer,
}) => {
  const harness = await startSendHarness(identityServer);

  try {
    const { applicationIds, owner } = await seedReadyPicks(harness);

    const context = await browser.newContext({
      storageState: await owner.storageState(),
      viewport: { height: 1000, width: 1280 },
    });

    const page = await context.newPage();

    await page.goto(`${harness.server.url}/tracker`);
    await expect(page.locator("[data-card]")).toHaveCount(3);

    const results = await new AxeBuilder({ page }).analyze();

    expect(results.violations).toEqual([]);

    await captureSendAll(page);

    await page.getByRole("button", { name: /Send all/u }).click();
    await expect(page.getByText("3 applications scheduled to send.")).toBeVisible();

    const board = boardSchema.parse(await (await owner.get("/api/board")).json());
    const { columns } = board;

    const approvedIds = columns
      .flatMap((column) => column.cards)
      .filter((card) => card.status === "approved")
      .map((card) => card.id);

    expect(approvedIds).toHaveLength(3);

    await runSends(owner, approvedIds, 0);

    await Promise.all(
      applicationIds.map(async (id) =>
        expect
          .poll(
            async () => {
              const response = await owner.get(`/api/applications/${encodeURIComponent(id)}`);

              return detailSchema.parse(await response.json()).application.status;
            },
            { timeout: 30_000 },
          )
          .toBe("sent"),
      ),
    );

    expect(harness.greenhouse.state.submissions).toBe(3);

    await context.close();
  } finally {
    await harness.server.stop();
    harness.anthropic.stop();
    harness.fixture.close();
    harness.greenhouse.close();
  }
});
