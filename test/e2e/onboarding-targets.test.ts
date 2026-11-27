import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";
import { completeOnboardingGaps } from "./onboarding-walk.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const stateSchema = z.object({ step: z.number() });

const settingsSchema = z.object({
  languages: z.array(z.string()),
  pendingTimezone: z.string().nullable(),
  timezone: z.string().nullable(),
});

const targetsSchema = z.object({
  targets: z.object({
    roles: z.array(z.string()),
    unresolvedRoles: z.array(z.string()),
    locations: z.array(z.string()),
    unresolvedLocations: z.array(z.string()),
  }),
});

async function storageStateFor(request: APIRequestContext, appServerUrl: string) {
  await seedOnboardingTargetsFlow(request, appServerUrl);

  return request.storageState();
}

async function seedJobs(request: APIRequestContext) {
  const response = await request.post("/__test__/jobs/seed", {
    data: {
      jobs: [
        {
          category: "healthcare",
          cities: ["London"],
          company: "Oak Clinic",
          countries: ["gb"],
          public_slug: "registered-nurse-london",
          title: "Registered Nurse",
        },
        {
          category: "healthcare",
          cities: ["London"],
          company: "Oak Clinic",
          countries: ["gb"],
          public_slug: "nurse-practitioner-london",
          title: "Nurse Practitioner",
        },
        {
          category: "backend",
          cities: ["London"],
          company: "CloudBridge",
          countries: ["gb"],
          public_slug: "backend-engineer-london",
          title: "Backend Engineer",
        },
      ],
    },
  });

  expect(response.status()).toBe(200);
}

async function addCategory(page: Page, name: string) {
  await page.getByRole("button", { name: /^Add a role category/u }).click();
  await page.getByRole("option", { exact: true, name }).click();
}

async function addTitleWord(page: Page, word: string) {
  await page.getByRole("textbox", { name: "Title words" }).fill(word);
  await page.getByRole("button", { name: "Add word" }).click();
}

async function addPlace(page: Page, search: string, label: RegExp) {
  await page.getByRole("button", { name: "Locations" }).click();
  await page.getByPlaceholder("Search cities or remote regions...").fill(search);
  await page.getByRole("option", { name: label }).first().click();
}

test("a fresh user picks a role category and a place, sees a real count, and removing the last title word widens it", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  await seedJobs(request);

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1100, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/targets`);

  const status = page.getByTestId("onboarding-targets-status");
  const seeMatches = page.getByRole("button", { name: "See my matches" });

  await expect(status).toHaveText("Pick at least one role and one location to see your matches.");
  await expect(seeMatches).toBeDisabled();

  await addCategory(page, "Backend");
  await expect(page.getByRole("button", { name: "Remove Backend" })).toBeVisible();

  await addTitleWord(page, "registered");
  await addPlace(page, "London", /^London/u);

  await expect(status).toHaveText("2 open roles match");
  await expect(seeMatches).toBeEnabled();

  await page.getByRole("button", { name: "Remove registered" }).click();

  await expect(status).toHaveText("1 open role match");
  await expect(page.getByText("All roles in this category")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 1000 });

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Remove Backend" }).click();
  await expect(status).toHaveText("Pick at least one role and one location to see your matches.");

  await context.close();
  await request.dispose();
});

test("choices persist across reload, the browser zone is captured, and an employer can be excluded", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  await seedJobs(request);

  const context = await browser.newContext({
    storageState,
    timezoneId: "Europe/Berlin",
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/targets`);

  await expect(page.getByRole("heading", { level: 2, name: /Job preferences/u })).toBeVisible();

  await addCategory(page, "Healthcare");
  await addTitleWord(page, "nurse");
  await addPlace(page, "London", /^London/u);
  await expect(page.getByRole("button", { name: "Remove London" })).toBeVisible();
  await addPlace(page, "Berlin", /^Berlin/u);
  await expect(page.getByRole("button", { name: "Remove Berlin" })).toBeVisible();

  await page.getByLabel("Add an employer to exclude").fill("Harbor Clinic Group");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Remove Harbor Clinic Group" })).toBeVisible();

  const uploaded = await request.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(uploaded.status()).toBe(201);

  await expect
    .poll(async () =>
      settingsSchema.parse(await (await request.get("/api/profile/settings")).json()),
    )
    .toMatchObject({ timezone: "Europe/Berlin", pendingTimezone: null });

  const saved = targetsSchema.parse(await (await request.get("/api/profile/targets")).json());

  expect(saved.targets.roles).toEqual(["healthcare", "nurse"]);
  expect([...saved.targets.locations].toSorted()).toEqual(["city:de:berlin", "city:gb:london"]);

  await page.reload();

  await expect(page.getByRole("button", { name: "Remove Healthcare" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove nurse" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove London" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Berlin" })).toBeVisible();

  await page.getByRole("button", { name: "See my matches" }).click();

  await expect(page).toHaveURL(/\/onboarding\/matches$/u);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(5);

  await context.close();
  await request.dispose();
});

test("a brand-new user sees matches only once a role category and a place are picked", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  await seedJobs(request);

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();
  const seeMatches = page.getByRole("button", { name: "See my matches" });
  const status = page.getByTestId("onboarding-targets-status");

  await page.goto(`${onboardingServer.url}/onboarding`);
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await completeOnboardingGaps(page);
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  await expect(seeMatches).toBeDisabled();
  await expect(status).toHaveText("Pick at least one role and one location to see your matches.");

  await addCategory(page, "Healthcare");
  await expect(seeMatches).toBeDisabled();

  await addPlace(page, "London", /^London/u);
  await expect(seeMatches).toBeEnabled();
  await expect(status).toHaveText("2 open roles match");

  await context.close();
  await request.dispose();
});
