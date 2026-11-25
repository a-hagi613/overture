import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
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

async function storageStateFor(request: APIRequestContext, appServerUrl: string) {
  await seedOnboardingTargetsFlow(request, appServerUrl);

  return request.storageState();
}

test("the category-first role chips, multi-select locations, and optional settings save cleanly", async ({
  browser,
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });
  const storageState = await storageStateFor(request, onboardingServer.url);

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1100, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/targets`);

  const backend = page.getByRole("button", { exact: true, name: "Backend Engineer" });
  const remote = page.getByRole("button", { exact: true, name: "Remote" });
  const hybrid = page.getByRole("button", { exact: true, name: "Hybrid" });
  const senior = page.getByRole("button", { name: "Senior" });

  await backend.click();
  await expect(backend).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Locations").click();
  await page.getByRole("option", { exact: true, name: "London" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "London" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await remote.click();
  await expect(remote).toHaveAttribute("aria-pressed", "true");
  await hybrid.click();
  await expect(hybrid).toHaveAttribute("aria-pressed", "true");
  await senior.click();
  await expect(senior).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Category").click();
  await page.getByRole("option", { exact: true, name: "Healthcare" }).click();

  await page.getByRole("button", { name: "Registered Nurse" }).click();
  await expect(page.getByRole("button", { name: "Registered Nurse" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Also selected (1)")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 1000 });

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.getByRole("button", { name: "Registered Nurse" }).click();
  await expect(page.getByRole("button", { name: "Registered Nurse" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await context.close();
  await request.dispose();
});

test("choices persist across reload, optional salary saves, and browser zone is captured", async ({
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
  await expect(page.getByRole("button", { exact: true, name: "Backend Engineer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ghost Role" })).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "Backend Engineer" }).click();

  await page.getByLabel("Category").click();
  await page.getByRole("option", { exact: true, name: "Product & Design" }).click();
  await page.getByRole("button", { exact: true, name: "Product Manager" }).click();

  await page.getByLabel("Locations").click();
  await page.getByRole("option", { exact: true, name: "London" }).click();
  await page.getByRole("option", { exact: true, name: "Berlin" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { exact: true, name: "Remote" }).click();
  await page.getByRole("button", { name: "Hybrid" }).click();
  await page.getByRole("button", { name: "Senior" }).click();

  await page.getByRole("button", { exact: true, name: "Backend Engineer" }).click();

  await page.getByRole("button", { name: /Optional: minimum salary/u }).click();
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

  await expect(page.getByRole("button", { exact: true, name: "Product Manager" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "London" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Berlin" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /Optional: minimum salary/u }).click();
  await expect(page.getByLabel("Minimum salary")).toHaveValue("120,000");

  await page.getByRole("button", { name: "See my matches" }).click();

  await expect(page).toHaveURL(/\/onboarding\/matches$/u);

  const state = stateSchema.parse(await (await request.get("/api/onboarding")).json());

  expect(state.step).toBe(3);

  await context.close();
  await request.dispose();
});
