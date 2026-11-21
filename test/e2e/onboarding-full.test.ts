import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingTargetsFlow } from "./onboarding-targets-harness.ts";

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

const factsSchema = z.object({
  facts: z.array(z.object({ key: z.string(), scope: z.string(), value: z.string() })),
});

const targetsSchema = z.object({
  targets: z.object({ locations: z.array(z.string()), roles: z.array(z.string()) }),
});

async function actInTurn<Item>(items: readonly Item[], act: (item: Item) => Promise<void>) {
  const first = items.at(0);

  if (first === undefined) {
    return;
  }

  await act(first);
  await actInTurn(items.slice(1), act);
}

test("a brand-new user answers every onboarding step through the UI", async ({
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

  await page.goto(`${onboardingServer.url}/onboarding`);
  await expect(page.getByRole("heading", { level: 2, name: /Welcome to Overture/u })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/facts$/u);
  await expect(page.getByLabel("Current job title")).toBeVisible();
  await expect(page.getByText("0 of 0 answered")).toHaveCount(0);

  const workAuth = page.getByLabel(/^Work authorisation in /u);
  const salary = page.getByLabel(/^Salary expectation in /u);

  await expect(workAuth.first()).toBeVisible();
  await expect(salary.first()).toBeVisible();

  await page.getByLabel("Current job title").fill("Staff Platform Engineer");

  await actInTurn(await workAuth.all(), async (field) => {
    await field.selectOption("Citizen");
  });
  await actInTurn(await salary.all(), async (field) => {
    await field.fill("140,000");
  });
  await actInTurn(await page.getByLabel(/^Period for /u).all(), async (field) => {
    await field.selectOption("a year");
  });

  await page.getByRole("switch").click();
  await expect(page.getByLabel("Gender")).toBeEnabled();
  await page.getByLabel("Gender").selectOption("Woman");
  await page.getByLabel("How did you hear about us?").fill("A friend");

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /What do you want/u })).toBeVisible();
  await page.getByRole("button", { name: "Platform Engineer" }).click();
  await page.getByRole("button", { name: "London" }).click();
  await page.getByRole("button", { exact: true, name: "Remote" }).click();
  await page.getByRole("button", { name: "Senior" }).click();
  await expect(page.getByTestId("targets-match-count")).not.toHaveText("0");

  await page.getByLabel("Salary floor").fill("120,000");
  await page.getByLabel("Salary floor").blur();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/profile#profile-targets$/u);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(5);

  const { facts } = factsSchema.parse(await (await request.get("/api/profile/facts")).json());

  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "current_job_title", value: "Staff Platform Engineer" }),
      expect.objectContaining({ key: "work_auth", value: "Citizen" }),
      expect.objectContaining({ key: "salary_expectation" }),
      expect.objectContaining({ key: "eeo_gender", value: "Woman" }),
    ]),
  );

  const saved = targetsSchema.parse(await (await request.get("/api/profile/targets")).json());

  expect(saved.targets.roles).toEqual(["Platform Engineer"]);
  expect(saved.targets.locations).toEqual(["London"]);

  await context.close();
  await request.dispose();
});
