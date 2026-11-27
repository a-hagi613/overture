import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { StripeMock } from "./stripe-mock.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import {
  BILLING_PRICE_MONTH,
  BILLING_PRICE_WEEK,
  BILLING_WEBHOOK_SECRET,
  appNowSeconds,
  deliverInvoice,
  invoicePayload,
} from "./billing-harness.ts";
import { boardTargets, seedOnboardingTargetsBoard } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";
import { startStripeMock } from "./stripe-mock.fixture.ts";

const fixtureToken = (...parts: string[]) => parts.join("_");
const WEBHOOK_SECRET = BILLING_WEBHOOK_SECRET;
const SECRET_KEY = fixtureToken("sk", "test", "planchoice");
const CARD_SECRET = "e2e-709-plan-choice-card-secret-0123456789";
const SHOT_DIR = process.env.PLAN_SHOT_DIR ?? join(process.cwd(), "docs/screenshots/709");
const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const consentSchema = z.object({ current: z.object({ version: z.string() }) });

const matchesSchema = z.object({
  matches: z.array(z.object({ id: z.string(), title: z.string() })),
  pickLimit: z.number(),
  planKind: z.enum(["free_trial", "week", "month"]).nullable(),
  selected: z.array(z.string()),
  trialAvailable: z.boolean(),
});

const billingSchema = z.object({
  applicationsLeft: z.number(),
  balance: z.object({ paid: z.object({ granted: z.number() }) }),
  planKind: z.enum(["month", "none", "trial", "week"]),
  planApplications: z.number(),
});

const boardSchema = z.object({
  columns: z.array(z.object({ cards: z.array(z.object({ id: z.string() })) })),
  total: z.number(),
});

interface Harness {
  request: APIRequestContext;
  server: AppServer;
  stripe: StripeMock;
  userId: string;
}

async function startHarness(identityServer: IdentityServer) {
  const stripe = await startStripeMock();

  const server = await startFreshAppServer(identityServer, {
    CARD_FINGERPRINT_SECRET: CARD_SECRET,
    STRIPE_API_BASE_URL: stripe.url,
    STRIPE_PRICE_MONTH: BILLING_PRICE_MONTH,
    STRIPE_PRICE_WEEK: BILLING_PRICE_WEEK,
    STRIPE_SECRET_KEY: SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  });

  const request = await apiRequest.newContext({ baseURL: server.url });
  const { userId } = await seedOnboardingTargetsBoard(request, server.url);

  const consent = consentSchema.parse(await (await request.get("/api/consent")).json());

  const accepted = await request.post("/api/consent/accept", {
    data: { version: consent.current.version },
  });

  expect(accepted.ok()).toBe(true);

  return { request, server, stripe, userId };
}

async function seedTargets(request: APIRequestContext) {
  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: boardTargets });
}

async function advanceToMatches(request: APIRequestContext) {
  await request.post("/api/onboarding/1");
  await request.post("/api/profile/resume", {
    multipart: {
      file: { buffer: Buffer.from(resumeBytes), mimeType: "application/pdf", name: "resume.pdf" },
    },
  });
  await request.post("/api/onboarding/2");
}

async function stopHarness(harness: Harness) {
  await harness.request.dispose();
  await harness.server.stop();
  await harness.stripe.stop();
}

async function screenshot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ fullPage: true, path: join(SHOT_DIR, `${name}.png`) });
}

const PLAN_SHOTS = (["free_trial", "week", "month"] as const).flatMap((plan) =>
  [390, 1280].flatMap((width) =>
    (["light", "dark"] as const).map((theme) => ({ plan, theme, width })),
  ),
);

const PLAN_PICK_LIMIT = { free_trial: 3, month: 10, week: 10 } as const;

async function selectPlan(page: Page, plan: "free_trial" | "week" | "month") {
  await page.locator(`input[value="${plan}"]`).check();
  await expect(page.locator(`input[value="${plan}"]`)).toBeChecked();
  await expect(
    page.getByText(
      `${String(PLAN_PICK_LIMIT[plan])} of ${String(PLAN_PICK_LIMIT[plan])} selected`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10_000 });
}

async function capturePlanShots(page: Page, index: number) {
  const shot = PLAN_SHOTS[index];

  if (shot === undefined) {
    return;
  }

  await page.setViewportSize({ height: 1000, width: shot.width });
  await page.evaluate((theme) => {
    globalThis.localStorage.setItem("overture.theme", theme);
  }, shot.theme);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: /Your matches/u })).toBeVisible();
  await selectPlan(page, shot.plan);
  await screenshot(page, `plan-${shot.plan}-${String(shot.width)}-${shot.theme}`);

  await capturePlanShots(page, index + 1);
}

const TRACKER_SHOTS = [390, 1280].flatMap((width) =>
  (["light", "dark"] as const).map((theme) => ({ theme, width })),
);

async function captureTrackerShots(page: Page, url: string, name: string, index: number) {
  const shot = TRACKER_SHOTS[index];

  if (shot === undefined) {
    return;
  }

  await page.setViewportSize({ height: 1000, width: shot.width });
  await page.evaluate((theme) => {
    globalThis.localStorage.setItem("overture.theme", theme);
  }, shot.theme);
  await page.goto(url);
  await expect(page.getByTestId("tracker-plan-banner")).toBeVisible({ timeout: 15_000 });
  await screenshot(page, `tracker-${name}-${String(shot.width)}-${shot.theme}`);

  await captureTrackerShots(page, url, name, index + 1);
}

async function grantPlan(
  request: APIRequestContext,
  serverUrl: string,
  userId: string,
  plan: "week" | "month",
) {
  const now = await appNowSeconds(request, serverUrl);
  const days = plan === "week" ? 7 : 30;

  const response = await deliverInvoice(
    request,
    serverUrl,
    invoicePayload({
      eventId: `evt_709_${plan}_${userId}`,
      invoiceId: `in_709_${plan}_${userId}`,
      periodEnd: now + days * 24 * 60 * 60,
      periodStart: now,
      plan,
      priceId: plan === "week" ? BILLING_PRICE_WEEK : BILLING_PRICE_MONTH,
      userId,
    }),
  );

  expect(response.ok(), `invoice.paid: ${String(response.status())}`).toBe(true);
}

async function billingOf(request: APIRequestContext) {
  return billingSchema.parse(await (await request.get("/api/billing")).json());
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("the plan step offers all three plans and the trial reaches the Tracker with three", async ({
  browser,
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    const context = await browser.newContext({
      storageState: await harness.request.storageState(),
      viewport: { height: 1400, width: 1280 },
    });

    const page = await context.newPage();

    await walkOnboardingSteps1To4(page, harness.server.url);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    await capturePlanShots(page, 0);
    await page.setViewportSize({ height: 1000, width: 1280 });
    await page.reload();
    await selectPlan(page, "free_trial");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ height: 1000, width: 390 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ height: 1000, width: 1280 });
    await expect(
      page.getByRole("button", { name: "Start my 3 free applications" }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Start my 3 free applications" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Continue for free" }),
    ).toBeEnabled();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    const setup = z
      .object({ url: z.url() })
      .parse(await (await harness.request.post("/api/billing/trial/setup")).json());

    const sessionId = /cs_(?:test|live)_[A-Za-z0-9]+/u.exec(setup.url)?.at(0);

    expect(sessionId, `setup session in ${setup.url}`).toBeDefined();

    harness.stripe.stubVerifiedSetupSession({
      fingerprint: "fp_709_trial",
      id: sessionId ?? "",
      userId: harness.userId,
    });

    await page.goto(
      `${harness.server.url}/tracker?card=verified&session=${encodeURIComponent(sessionId ?? "")}`,
    );
    await expect(page.locator("[data-card]")).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByTestId("tracker-plan-banner")).toContainText(
      "Free trial · 3 applications",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await captureTrackerShots(page, `${harness.server.url}/tracker`, "free_trial", 0);

    const matches = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(matches.planKind).toBe("free_trial");

    await context.close();
  } finally {
    await stopHarness(harness);
  }
});

async function paidPath(
  browser: Browser,
  identityServer: IdentityServer,
  plan: "week" | "month",
  expectedBalance: number,
) {
  const harness = await startHarness(identityServer);

  try {
    const context = await browser.newContext({
      storageState: await harness.request.storageState(),
      viewport: { height: 1400, width: 1280 },
    });

    const page = await context.newPage();

    await walkOnboardingSteps1To4(page, harness.server.url);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await selectPlan(page, plan);

    const cta =
      plan === "week" ? "Start Weekly and apply to 10 jobs" : "Start Monthly and apply to 10 jobs";

    await page.getByRole("button", { name: cta }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: cta })).toBeEnabled();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

    const checkout = await harness.request.post("/api/onboarding/checkout", {
      data: { plan },
    });

    expect(checkout.ok(), `checkout: ${String(checkout.status())}`).toBe(true);

    const checkoutRequest = harness.stripe.requests.find(
      (entry) => entry.method === "POST" && entry.path === "/v1/checkout/sessions",
    );

    expect(checkoutRequest?.body).toContain("mode=subscription");

    await grantPlan(harness.request, harness.server.url, harness.userId, plan);

    await expect
      .poll(async () => (await billingOf(harness.request)).applicationsLeft, { timeout: 15_000 })
      .toBe(expectedBalance);

    const trackerUrl = `${harness.server.url}/tracker?billing=success&plan=${plan}`;

    await page.goto(trackerUrl);
    await expect(page.locator("[data-card]")).toHaveCount(10, { timeout: 30_000 });

    const billing = await billingOf(harness.request);

    expect(billing.planKind).toBe(plan);
    expect(billing.balance.paid.granted).toBe(expectedBalance);

    const banner =
      plan === "week"
        ? "Weekly · 50 applications this week · 10 a day"
        : "Monthly · 250 applications this month · 10 a day";

    await expect(page.getByTestId("tracker-plan-banner")).toContainText(banner);

    const board = boardSchema.parse(await (await harness.request.get("/api/board")).json());

    expect(board.total).toBe(10);

    await page.reload();
    await expect(page.locator("[data-card]")).toHaveCount(10, { timeout: 30_000 });
    await grantPlan(harness.request, harness.server.url, harness.userId, plan);

    const afterDouble = await billingOf(harness.request);

    expect(afterDouble.balance.paid.granted).toBe(expectedBalance);
    expect(boardSchema.parse(await (await harness.request.get("/api/board")).json()).total).toBe(
      10,
    );

    await captureTrackerShots(page, `${harness.server.url}/tracker`, plan, 0);

    await context.close();
  } finally {
    await stopHarness(harness);
  }
}

test("Weekly: ten picks, Checkout and a double return give one set and a 50 balance", async ({
  browser,
  identityServer,
}) => {
  await paidPath(browser, identityServer, "week", 50);
});

test("Monthly: ten picks, Checkout and a double return give one set and a 250 balance", async ({
  browser,
  identityServer,
}) => {
  await paidPath(browser, identityServer, "month", 250);
});

test("a cancelled Checkout keeps every pick on the plan step", async ({
  browser,
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    await seedTargets(harness.request);
    await advanceToMatches(harness.request);

    const listed = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    const plan = await harness.request.put("/api/onboarding/plan", { data: { planKind: "week" } });

    expect(plan.ok()).toBe(true);

    const postingIds = listed.matches.slice(0, 10).map((match) => match.id);
    const saved = await harness.request.put("/api/onboarding/matches", { data: { postingIds } });

    expect(saved.ok(), `saving picks: ${String(saved.status())}`).toBe(true);

    const checkout = await harness.request.post("/api/onboarding/checkout", {
      data: { plan: "week" },
    });

    expect(checkout.ok(), `checkout: ${String(checkout.status())}`).toBe(true);

    const context = await browser.newContext({
      storageState: await harness.request.storageState(),
      viewport: { height: 1000, width: 1280 },
    });

    const page = await context.newPage();

    await page.goto(`${harness.server.url}/onboarding/matches?card=cancelled`);
    await expect(page.getByText("No card was checked and nothing was charged.")).toBeVisible();
    await expect(page.getByText("10 of 10 selected", { exact: true })).toBeVisible();

    const kept = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(kept.selected).toHaveLength(10);
    expect(kept.planKind).toBe("week");

    await context.close();
  } finally {
    await stopHarness(harness);
  }
});

test("a card that already used the trial is told and offered Weekly and Monthly", async ({
  browser,
  identityServer,
}) => {
  const harness = await startHarness(identityServer);

  try {
    await seedTargets(harness.request);
    await advanceToMatches(harness.request);

    await harness.request.post("/__test__/ledger/grant", {
      data: {
        email: authTestIdentity.ownerEmail,
        idempotencyKey: "plan-choice-trial-used",
        quantity: 3,
        source: "trial",
      },
    });

    await Promise.all(
      [0, 1, 2].map(async (index) =>
        harness.request.post("/__test__/ledger/application", {
          data: {
            applicationId: `plan-choice-consumed-${String(index)}`,
            commit: true,
            email: authTestIdentity.ownerEmail,
          },
        }),
      ),
    );

    const context = await browser.newContext({
      storageState: await harness.request.storageState(),
      viewport: { height: 1000, width: 1280 },
    });

    const page = await context.newPage();

    await page.goto(`${harness.server.url}/onboarding/matches`);
    await expect(
      page.getByText("This card has already used the free trial.", { exact: false }),
    ).toBeVisible();
    await expect(page.locator('input[value="free_trial"]')).toBeDisabled();
    await expect(page.locator('input[value="week"]')).toBeChecked();
    await expect(page.getByRole("button", { name: /Start Weekly and apply/u })).toBeVisible();

    const listed = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    expect(listed.trialAvailable).toBe(false);

    await context.close();
  } finally {
    await stopHarness(harness);
  }
});

test("the server enforces each plan's pick limit", async ({ identityServer }) => {
  const harness = await startHarness(identityServer);

  try {
    await seedTargets(harness.request);

    const trial = await harness.request.put("/api/onboarding/plan", {
      data: { planKind: "free_trial" },
    });

    expect(trial.ok()).toBe(true);

    const listed = matchesSchema.parse(
      await (await harness.request.get("/api/onboarding/matches")).json(),
    );

    const ids = listed.matches.map((match) => match.id);

    const fourth = await harness.request.put("/api/onboarding/matches", {
      data: { postingIds: ids.slice(0, 4) },
    });

    expect(fourth.status()).toBe(409);
    expect(await fourth.json()).toMatchObject({ error: "pick_limit", limit: 3 });

    const paid = await harness.request.put("/api/onboarding/plan", { data: { planKind: "week" } });

    expect(paid.ok()).toBe(true);

    const ten = await harness.request.put("/api/onboarding/matches", {
      data: { postingIds: ids.slice(0, 10) },
    });

    expect(ten.ok(), `ten picks: ${String(ten.status())}`).toBe(true);

    const eleven = Array.from({ length: 11 }, (_, index) => `posting-${String(index)}`);

    const eleventh = await harness.request.put("/api/onboarding/matches", {
      data: { postingIds: eleven },
    });

    expect(eleventh.ok()).toBe(false);

    const backToTrial = await harness.request.put("/api/onboarding/plan", {
      data: { planKind: "free_trial" },
    });

    expect(backToTrial.status()).toBe(409);

    const prepare = await harness.request.post("/api/onboarding/prepare", {
      data: { postingIds: ids.slice(0, 10) },
    });

    expect(prepare.status()).toBe(402);
    expect(await prepare.json()).toMatchObject({ error: "trial_required" });
  } finally {
    await stopHarness(harness);
  }
});
