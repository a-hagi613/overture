import { readFileSync } from "node:fs";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

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

const stateSchema = z.object({
  currentEmployer: z.string().nullable(),
  needsOnboarding: z.boolean(),
  onboardedAt: z.string().nullable(),
  pauseReason: z.string().nullable(),
  resume: z.object({ filename: z.string(), unreadable: z.boolean() }).nullable(),
  skipCompanies: z.array(z.object({ name: z.string(), reason: z.string() })),
  step: z.number(),
});

const factsSchema = z.object({
  facts: z.array(z.object({ key: z.string(), scope: z.string(), value: z.string() })),
});

const targets = {
  roles: ["Platform Engineer"],
  seniorities: ["senior"],
  workplaces: ["remote", "hybrid"],
  locations: ["Toronto, ON"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 14_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

async function newUser(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await request.put("/api/profile/targets", { data: targets });
}

async function storageStateFor(request: APIRequestContext, appServerUrl: string) {
  await newUser(request, appServerUrl);

  return request.storageState();
}

async function upload(page: Page, fixture: string, name: string) {
  await page.locator('input[type="file"]').setInputFiles({
    buffer: Buffer.from(readFileSync(fixture)),
    mimeType: "application/pdf",
    name,
  });
}

test("a new user uploads a resume, confirms Facts and returns to the step they left", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1200, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding`);
  await expect(page.getByRole("heading", { level: 2, name: /Welcome to Overture/u })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Upload your resume/u })).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Continue" });

  await expect(continueButton).toBeDisabled();

  await upload(page, "test/e2e/fixtures/resume-text.pdf", "resume.pdf");

  await expect(page.getByText("resume.pdf")).toBeVisible();
  await expect(page.getByText("PDF · 1 page · 1 KB")).toBeVisible();
  await expect(page.getByText("Kept exactly as you sent it.")).toBeVisible();

  const skipList = z
    .object({ companies: z.array(z.object({ name: z.string(), reason: z.string() })) })
    .parse(await (await request.get("/api/profile/skip-companies")).json());

  expect(skipList.companies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "Brightwave Analytics",
        reason: "current_employer",
      }),
    ]),
  );

  await page.goto(`${onboardingServer.url}/`);
  await page.goto(`${onboardingServer.url}/onboarding`);

  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await expect(page.getByText("resume.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/facts$/u);

  await page.getByLabel("Current job title").fill("Staff Platform Engineer");
  await page.getByLabel("Work authorisation in Canada").selectOption("Citizen");
  await page.getByLabel("Salary expectation in CAD").fill("140,000");
  await page.getByLabel("Period for CAD").selectOption("a year");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  await page.goto(`${onboardingServer.url}/onboarding`);
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await page.goto(`${onboardingServer.url}/onboarding/facts`);
  await expect(page.getByLabel("Current job title")).toHaveValue("Staff Platform Engineer");
  await expect(page.getByLabel("Work authorisation in Canada")).toHaveValue("Citizen");
  await expect(page.getByLabel("Salary expectation in CAD")).toHaveValue("140,000");

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(4);
  expect(state.onboardedAt).toBeNull();
  expect(state.pauseReason).toBe("onboarding");
  expect(state.currentEmployer).toBe("Brightwave Analytics");

  await context.close();
  await request.dispose();
});

test("the Resume step cannot be finished without a resume", async ({ onboardingServer }) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await newUser(request, onboardingServer.url);

  const refused = await request.post("/api/onboarding/2");

  expect(refused.status()).toBe(409);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(1);
  expect(state.resume).toBeNull();

  const welcome = await request.post("/api/onboarding/1");

  expect(welcome.status()).toBe(200);
  expect(stateSchema.parse(await welcome.json()).step).toBe(2);

  await request.dispose();
});

test("an unreadable PDF leads to manual entry on the Facts step", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await newUser(request, onboardingServer.url);
  await request.put("/__test__/settings/llm.cap_user_day_usd", { data: { value: "0" } });

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1200, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/resume`);
  await upload(page, "test/e2e/fixtures/resume-scanned.pdf", "resume-scanned.pdf");

  await expect(page.getByText("resume-scanned.pdf")).toBeVisible();
  await expect(
    page.getByText(
      "Overture couldn't read this PDF. Replace it, or continue and type your facts yourself on the next step.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/facts$/u);
  await expect(page.getByLabel("Current job title")).toHaveValue("");

  await page.getByLabel("Current job title").fill("Platform Engineer");
  await page.getByLabel("Work authorisation in Canada").selectOption("Permanent resident");
  await page.getByLabel("Salary expectation in CAD").fill("120,000");
  await page.getByLabel("Period for CAD").selectOption("a year");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  const facts = factsSchema
    .parse(await (await request.get("/api/profile/facts")).json())
    .facts.filter((fact) => fact.key === "current_job_title" || fact.key === "salary_expectation");

  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "current_job_title", value: "Platform Engineer" }),
      expect.objectContaining({ key: "salary_expectation", value: "CAD 120,000 a year" }),
    ]),
  );

  await context.close();
  await request.dispose();
});
