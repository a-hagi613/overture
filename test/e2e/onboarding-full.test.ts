import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { walkOnboardingSteps1To4 } from "./onboarding-walk.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
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

const stateSchema = z.object({ onboardedAt: z.string().nullable(), step: z.number() });

const matchesSchema = z.object({ selected: z.array(z.string()) });

const consentSchema = z.object({ current: z.object({ version: z.string() }) });

const prepareSchema = z.object({ prepared: z.number() });

const targetsSchema = z.object({
  targets: z.object({ locations: z.array(z.string()), roles: z.array(z.string()) }),
});

test("a brand-new user picks three matches and the trial prepares them", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  await seedOnboardingTargetsFlow(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState: await request.storageState(),
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();

  await walkOnboardingSteps1To4(page, onboardingServer.url);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(5);
  expect(state.onboardedAt).toBeNull();

  const dialog = page.getByRole("dialog");

  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByRole("button", { name: "Continue for free" })).toBeEnabled();

  const matches = matchesSchema.parse(await (await request.get("/api/onboarding/matches")).json());
  const { selected } = matches;

  expect(selected).toHaveLength(3);

  const consent = consentSchema.parse(await (await request.get("/api/consent")).json());

  await request.post("/api/consent/accept", { data: { version: consent.current.version } });
  await request.post("/__test__/ledger/grant", {
    data: {
      email: authTestIdentity.ownerEmail,
      idempotencyKey: "onboarding-full-trial",
      quantity: 3,
      source: "trial",
    },
  });

  const prepared = await request.post("/api/onboarding/prepare", {
    data: { postingIds: selected },
  });

  expect(prepared.ok(), `${String(prepared.status())} ${await prepared.text()}`).toBe(true);
  expect(prepareSchema.parse(await prepared.json()).prepared).toBeGreaterThan(0);

  const started = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(started.onboardedAt).not.toBeNull();

  const saved = targetsSchema.parse(await (await request.get("/api/profile/targets")).json());

  expect(saved.targets.roles).toEqual(["DevOps / SRE / Platform Engineer"]);
  expect(saved.targets.locations).toEqual(["London"]);

  await context.close();
  await request.dispose();
});

const emptyChoices = {
  choices: {
    employmentTypes: [],
    locations: [],
    roleCounts: {},
    roles: [],
    seniorities: [],
    workplaces: [],
  },
  currencies: [],
  matchedCount: 0,
  targets: {
    employmentTypes: [],
    locations: [],
    roles: [],
    salaryCurrency: null,
    salaryFloorMinor: null,
    salaryPeriod: "year",
    seniorities: [],
    workplaces: [],
  },
};

test("the What you want step shows a loading, error or empty state, never nothing", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seedOnboardingTargetsFlow(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState: await request.storageState(),
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();
  const heading = page.getByRole("heading", { level: 2, name: /Job preferences/u });

  const gate = Promise.withResolvers<undefined>();

  await page.route("**/api/onboarding/targets", async (route) => {
    await gate.promise;
    await route.fallback();
  });

  await page.goto(`${onboardingServer.url}/onboarding/targets`);
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toBeVisible();
  await expect(page.getByRole("main")).not.toHaveText(/^\s*$/u);

  gate.resolve(undefined);
  await expect(heading).toBeVisible();
  await page.unroute("**/api/onboarding/targets");

  await page.route("**/api/onboarding/targets", async (route) => {
    await route.fulfill({ body: "{}", status: 500 });
  });

  await page.reload();
  await expect(page.getByRole("alert")).toContainText("That did not load");

  await page.unroute("**/api/onboarding/targets");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(heading).toBeVisible();

  await page.route("**/api/onboarding/targets", async (route) => {
    await route.fulfill({ json: emptyChoices });
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Nothing to choose from yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await page.unroute("**/api/onboarding/targets");
  await page.route("**/api/onboarding", async (route) => {
    await route.fulfill({ body: "{}", status: 500 });
  });

  await page.goto(`${onboardingServer.url}/onboarding/resume`);
  await expect(page.getByRole("alert")).toContainText("That did not load");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  await context.close();
  await request.dispose();
});
