import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";

const test = appTest.extend<{ demoServer: AppServer; onboardingServer: AppServer }>({
  demoServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, { DEMO_LOGIN_ENABLED: "true" });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        INBOUND_HMAC_SECRET: "e2e-onboarding-hmac-secret-0123456789",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const sessionSchema = z.object({ user: z.object({ id: z.string() }) });

const stateSchema = z.object({
  onboardedAt: z.string().nullable(),
  pauseReason: z.string().nullable(),
  step: z.number(),
});

const consentSchema = z.object({
  accepted: z.object({ at: z.string(), version: z.string() }).nullable(),
  current: z.object({ version: z.string() }),
});

const jobsSchema = z.object({
  jobs: z.array(z.object({ kind: z.string(), payload: z.string(), runAt: z.number() })),
});

const errorSchema = z.object({ error: z.string() });

const demoLockedSchema = z.object({ error: z.literal("demo_locked") });

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

async function signedInAtStepFive(
  browser: Parameters<Parameters<typeof test>[2]>[0]["browser"],
  server: AppServer,
  viewport?: { height: number; width: number },
) {
  const request = await apiRequest.newContext({ baseURL: server.url });

  await seedOnboardingTargetsFlow(request, server.url);

  const context = await browser.newContext({
    storageState: await request.storageState(),
    viewport: viewport ?? { height: 1400, width: 1280 },
  });

  const page = await context.newPage();

  await walkOnboardingSteps1To4(page, server.url);

  const session = sessionSchema.parse(await (await request.get("/api/auth/get-session")).json());

  return { context, page, request, userId: session.user.id };
}

async function expectStartedWithoutRunning(request: APIRequestContext, userId: string) {
  const consent = consentSchema.parse(await (await request.get("/api/consent")).json());

  expect(consent.accepted?.version).toBe(consent.current.version);
  expect(consent.accepted?.at).toBeTruthy();

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.onboardedAt).not.toBeNull();
  expect(state.pauseReason).toBeNull();

  const { now } = clockSchema.parse(await (await request.get("/__test__/clock")).json());
  const { jobs } = jobsSchema.parse(await (await request.get("/__test__/jobs")).json());
  const prep = jobs.filter((job) => job.kind === "prep.daily" && job.payload.includes(userId));

  expect(prep.length).toBeGreaterThan(0);
  expect(prep.every((job) => job.runAt > now)).toBe(true);
}

async function tickAndStart(page: Page) {
  const start = page.getByRole("button", { name: "Start" });

  await expect(start).toBeDisabled();
  await expect(page.getByText("Tick the box to start.")).toBeVisible();
  await page.getByLabel(/I agree to the/u).check();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(/\/home$/u);
}

test("forwarded mail arrives, consent gates Start, and the first run waits for the staggered morning slot", async ({
  browser,
  onboardingServer,
}) => {
  const { context, page, request, userId } = await signedInAtStepFive(browser, onboardingServer);

  await expect(page.getByRole("heading", { level: 2, name: /Mail forwarding/u })).toBeVisible();
  await expect(page.getByLabel("Your forwarding address")).toHaveValue(/^in-.+@.+/u);
  await expect(page.getByText(/Waiting for a test email/u)).toBeVisible();
  await expect(page.getByText("How to set up forwarding in Gmail")).toBeVisible();

  const early = await request.post("/api/onboarding/start");

  expect(early.status()).toBe(409);
  expect(errorSchema.parse(await early.json()).error).toBe("consent_required");
  expect((await request.post("/api/onboarding/5")).status()).toBe(409);

  const forwarded = await request.post("/__test__/mailboxes/first-forwarded", { data: { userId } });

  expect(forwarded.ok()).toBe(true);
  await expect(page.getByText(/Received\. Your filter works/u)).toBeVisible({ timeout: 15_000 });

  await tickAndStart(page);
  await expectStartedWithoutRunning(request, userId);

  await context.close();
  await request.dispose();
});

test("skipping the filter never blocks Start", async ({ browser, onboardingServer }) => {
  const { context, page, request, userId } = await signedInAtStepFive(browser, onboardingServer);

  await expect(page.getByText(/Cannot set up a filter\?/u)).toBeVisible();
  await expect(page.getByText(/Waiting for a test email/u)).toBeVisible();

  await tickAndStart(page);
  await expectStartedWithoutRunning(request, userId);

  await context.close();
  await request.dispose();
});

test("a restart after Start past the morning slot queues no same-day catch-up run", async ({
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seedOnboardingTargetsFlow(request, onboardingServer.url);

  const session = sessionSchema.parse(await (await request.get("/api/auth/get-session")).json());
  const { now, offsetMs } = clockSchema.parse(await (await request.get("/__test__/clock")).json());
  const noon = new Date(now);

  noon.setUTCHours(12, 0, 0, 0);

  expect((await request.put("/api/onboarding/timezone", { data: { timezone: "UTC" } })).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post("/__test__/clock/offset", {
        data: { offsetMs: noon.getTime() - (now - offsetMs) },
      })
    ).ok(),
  ).toBe(true);

  const consent = consentSchema.parse(await (await request.get("/api/consent")).json());

  expect(
    (
      await request.post("/api/consent/accept", { data: { version: consent.current.version } })
    ).ok(),
  ).toBe(true);
  expect((await request.post("/api/onboarding/start")).ok()).toBe(true);
  expect((await request.post("/__test__/jobs/ensure-prep")).ok()).toBe(true);

  await expectStartedWithoutRunning(request, session.user.id);
  await request.dispose();
});

test("the demo account cannot Start onboarding", async ({ demoServer }) => {
  const request = await apiRequest.newContext({ baseURL: demoServer.url });

  const headers = {
    "x-captcha-response": authTestIdentity.turnstilePassToken,
    "x-turnstile-action": "magiclink",
    origin: demoServer.url,
  };

  const signedIn = await request.post("/api/auth/demo/sign-in", {
    data: { email: "test@email.com" },
    headers,
  });

  expect(signedIn.ok()).toBe(true);

  const response = await request.post("/api/onboarding/start", { headers });

  expect(response.status()).toBe(403);
  expect(demoLockedSchema.parse(await response.json()).error).toBe("demo_locked");
  await request.dispose();
});

for (const width of [390, 1280]) {
  for (const theme of ["light", "dark"]) {
    test(`step 5 has no axe violations or sideways scroll at ${String(width)} ${theme}`, async ({
      browser,
      onboardingServer,
    }) => {
      const { context, page, request } = await signedInAtStepFive(browser, onboardingServer, {
        height: 900,
        width,
      });

      await page.evaluate((value) => {
        globalThis.localStorage.setItem("overture.theme", value);
      }, theme);
      await page.goto(`${onboardingServer.url}/onboarding/forward`);
      await expect(page.getByRole("heading", { level: 2, name: /Mail forwarding/u })).toBeVisible();
      await expect(page.getByLabel("Your forwarding address")).toHaveValue(/^in-/u);

      const results = await new AxeBuilder({ page }).analyze();

      expect(results.violations).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow).toBeLessThanOrEqual(0);

      await context.close();
      await request.dispose();
    });
  }
}
