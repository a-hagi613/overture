import { readFileSync } from "node:fs";

import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Page } from "@playwright/test";
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

const settingsSchema = z.object({
  languages: z.array(z.string()),
  pendingTimezone: z.string().nullable(),
  timezone: z.string().nullable(),
});

const targetsSchema = z.object({
  targets: z.object({
    employmentTypes: z.array(z.string()),
    locations: z.array(z.string()),
    roles: z.array(z.string()),
    salaryCurrency: z.string().nullable(),
    salaryFloorMinor: z.number().nullable(),
    seniorities: z.array(z.string()),
    workplaces: z.array(z.string()),
  }),
});

async function countText(page: Page) {
  return page.getByTestId("targets-match-count").textContent();
}

async function storageStateFor(request: APIRequestContext, appServerUrl: string) {
  await seedOnboardingTargetsFlow(request, appServerUrl);

  return request.storageState();
}

test("choices come from open Postings, the count follows them, and the browser zone is saved", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState,
    timezoneId: "Europe/Berlin",
    viewport: { height: 1400, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/targets`);

  await expect(page.getByRole("heading", { level: 2, name: /Job preferences/u })).toBeVisible();

  await expect(page.getByRole("button", { name: "Platform Engineer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Product Manager" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghost Role" })).toHaveCount(0);

  expect(await countText(page)).toBe("0");

  await page.getByRole("button", { name: "Platform Engineer" }).click();
  await page.getByRole("button", { name: "London" }).click();
  await page.getByRole("button", { exact: true, name: "Remote" }).click();
  await page.getByRole("button", { name: "Senior" }).click();

  await expect(page.getByTestId("targets-match-count")).toHaveText("3");

  await page.getByRole("button", { name: "Product Manager" }).click();

  await expect(page.getByTestId("targets-match-count")).toHaveText("3");

  await page.getByRole("button", { name: "Berlin" }).click();
  await page.getByRole("button", { name: "Hybrid" }).click();

  await expect(page.getByTestId("targets-match-count")).toHaveText("5");

  const platformChip = page.getByRole("button", { name: "Platform Engineer" });

  await platformChip.click();
  await expect(platformChip).toHaveAttribute("aria-pressed", "false");

  await expect(page.getByTestId("targets-match-count")).toHaveText("2");

  await page.getByLabel("Minimum salary").fill("120,000");
  await page.getByLabel("Minimum salary").blur();

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

  expect(saved.targets.roles).toEqual(["Product Manager"]);
  expect(saved.targets.locations).toEqual(["London", "Berlin"]);
  expect(saved.targets.workplaces).toEqual(["remote", "hybrid"]);
  expect(saved.targets.seniorities).toEqual(["senior"]);
  expect(saved.targets.employmentTypes).toEqual(["full_time"]);
  expect(saved.targets.salaryFloorMinor).toBe(12_000_000);
  expect(saved.targets.salaryCurrency).toBe("CAD");

  await page.reload();

  await expect(page.getByTestId("targets-match-count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Product Manager" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Minimum salary")).toHaveValue("120,000");

  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/matches$/u);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(3);

  await context.close();
  await request.dispose();
});
