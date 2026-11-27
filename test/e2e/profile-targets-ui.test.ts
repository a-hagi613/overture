import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const test = appTest.extend<{ resumeServer: AppServer }>({
  resumeServer: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
      });

      await provide(server);
      await server.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
});

const createdSchema = z.object({ id: z.string() });
const countSchema = z.object({ matchedCount: z.number() });
const languagesSchema = z.object({ languages: z.array(z.string()) });

const profileSettingsSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
  pendingTimezone: z.string().nullable(),
  pendingTimezoneAt: z.string().nullable(),
});

const baseTargets = {
  roles: ["Backend"],
  seniorities: ["senior"],
  workplaces: ["remote"],
  locations: ["city:ca:ottawa"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
};

async function ownerStorage(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const storageState = await request.storageState();

  return { request, storageState };
}

async function seedPostings(appServerUrl: string) {
  const company = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ui Target Co", domain: "ui-target.example" }),
      })
    ).json(),
  );

  const board = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: company.id, ats: "greenhouse", boardToken: "ui-target" }),
      })
    ).json(),
  );

  const common = {
    boardId: board.id,
    companyId: company.id,
    ats: "greenhouse",
    employmentType: "full_time",
    language: "en",
    countryCode: "CA",
    region: "Ontario",
    city: "Ottawa",
    tags: [
      { dimension: "subrole", value: "Backend" },
      { dimension: "seniority", value: "senior" },
    ],
  };

  const response = await fetch(`${appServerUrl}/__test__/catalog/postings/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      postings: [
        {
          ...common,
          atsJobId: "ui-1",
          url: "https://ui-target.example/1",
          title: "Senior Backend Engineer",
          workplace: "remote",
        },
        {
          ...common,
          atsJobId: "ui-2",
          url: "https://ui-target.example/2",
          title: "Senior Backend Engineer",
          workplace: "hybrid",
        },
      ],
    }),
  });

  expect(response.ok).toBe(true);
}

test("the live count updates as targets are edited, and Save stores them", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  await seedPostings(appServerUrl);

  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: baseTargets });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");
  await expect(page.getByTestId("targets-matched-count")).toHaveText("1");

  await page.getByRole("button", { name: "Hybrid" }).click();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("button", { name: "Remote" }).click();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("1");

  await page.getByRole("button", { name: "Remote" }).click();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("button", { name: "Save targets" }).click();

  await page.reload();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Hybrid" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const saved = countSchema.parse(
    await (await request.post("/api/profile/targets/match-count", { data: baseTargets })).json(),
  );

  expect(saved.matchedCount).toBe(1);

  await context.close();
  await request.dispose();
});

async function seedGranularPosting(appServerUrl: string) {
  const company = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Granular Target Co", domain: "granular-target.example" }),
      })
    ).json(),
  );

  const board = createdSchema.parse(
    await (
      await fetch(`${appServerUrl}/__test__/catalog/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          ats: "greenhouse",
          boardToken: "granular-target",
        }),
      })
    ).json(),
  );

  const response = await fetch(`${appServerUrl}/__test__/catalog/postings/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      postings: [
        {
          ats: "greenhouse",
          atsJobId: "granular-1",
          boardId: board.id,
          city: "Ottawa",
          companyId: company.id,
          countryCode: "CA",
          employmentType: "full_time",
          language: "en",
          locationRaw: "Ottawa, ON",
          region: "Ontario",
          tags: [
            { dimension: "role", value: "Healthcare" },
            { dimension: "granular_role", value: "Registered Nurse" },
            { dimension: "seniority", value: "senior" },
          ],
          title: "Registered Nurse",
          url: "https://granular-target.example/1",
          workplace: "remote",
        },
      ],
    }),
  });

  expect(response.ok).toBe(true);
}

test("a granular Level-2 role can be searched and added from Profile targets, and the count follows", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  await seedPostings(appServerUrl);
  await seedGranularPosting(appServerUrl);

  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: baseTargets });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");
  await expect(page.getByTestId("targets-matched-count")).toHaveText("1");

  await page.getByLabel("Category", { exact: true }).selectOption("Healthcare");

  const role = page.getByLabel("Add a specific role", { exact: true });

  await role.fill("Registered Nurse");
  await role.press("Enter");

  await expect(page.getByRole("button", { name: "Registered Nurse" })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("button", { name: "Save targets" }).click();

  await page.reload();

  await expect(page.getByRole("button", { name: "Registered Nurse" })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  const results = await new AxeBuilder({ page }).include("#profile-targets").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("only a picked suggestion becomes a place pill, and an unresolved place can be resolved or dismissed", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  await seedPostings(appServerUrl);

  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", {
    data: { ...baseTargets, locations: [], unresolvedLocations: ["Victoria"] },
  });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");

  await expect(page.getByText("Places we couldn't match exactly")).toBeVisible();
  await expect(page.getByText("Victoria", { exact: true })).toBeVisible();

  const add = page
    .getByRole("list", { name: "Locations" })
    .getByRole("button", { name: "Add location" });

  await add.click();

  const search = page.getByLabel("Search a city, country, or remote scope");

  await search.fill("Nowhereville");
  await expect(page.getByText("No matching places. Pick a suggestion to save it.")).toBeVisible();
  await search.press("Enter");
  await expect(page.getByRole("button", { name: "Remove Nowhereville" })).toHaveCount(0);

  await search.press("Escape");
  await expect(search).toHaveCount(0);

  await add.click();

  await search.fill("Ottawa");
  await expect(search).toHaveValue("Ottawa");
  await expect(page.getByRole("option", { name: /^Ottawa/u }).first()).toBeVisible();

  await search.press("ArrowDown");
  await search.press("Enter");

  await expect(page.getByRole("button", { name: "Remove Ottawa" })).toBeVisible();

  await page.getByRole("button", { name: "Save targets" }).click();

  await page.reload();

  await expect(page.getByRole("button", { name: "Remove Ottawa" })).toBeVisible();
  await expect(page.getByText("Victoria", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss Victoria" }).click();
  await page.getByRole("button", { name: "Save targets" }).click();

  await page.reload();

  await expect(page.getByText("Victoria", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Ottawa" })).toBeVisible();

  const results = await new AxeBuilder({ page }).include("#profile-targets").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("the skip list is prefilled from the resume, and companies add and remove", async ({
  resumeServer: { url: appServerUrl },
  browser,
}) => {
  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.post("/api/profile/resume", {
    multipart: {
      file: {
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
      },
    },
  });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");

  const skip = page.locator("#profile-skip");

  await expect(skip.getByText("Brightwave Analytics")).toBeVisible();
  await expect(skip.getByText("Current employer", { exact: true })).toBeVisible();

  await page.getByLabel("Add a company to skip").fill("Quillon Payments");
  await page.getByLabel("Add a company to skip").press("Enter");

  await expect(skip.getByText("Quillon Payments")).toBeVisible();

  await page.reload();
  await expect(skip.getByText("Quillon Payments")).toBeVisible();

  await page.getByRole("button", { name: "Remove Quillon Payments" }).click();

  await expect(skip.getByText("Quillon Payments")).toHaveCount(0);
  await expect(skip.getByText("Brightwave Analytics")).toBeVisible();

  await page.reload();
  await expect(skip.getByText("Quillon Payments")).toHaveCount(0);
  await expect(skip.getByText("Current employer", { exact: true })).toBeVisible();

  await context.close();
  await request.dispose();
});

test("posting languages and the time zone save from Settings", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  const { request, storageState } = await ownerStorage(appServerUrl);

  const context = await browser.newContext({
    baseURL: appServerUrl,
    storageState,
    timezoneId: "America/Vancouver",
  });

  const page = await context.newPage();

  await page.goto("/profile/account");

  const french = page.getByRole("button", { name: "French" });
  const timezone = page.getByLabel("Time zone");

  await expect(timezone).toHaveValue("America/Vancouver");
  await expect(french).toHaveAttribute("aria-pressed", "false");
  await french.click();
  await expect(french).toHaveAttribute("aria-pressed", "true");

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  const firstSave = profileSettingsSchema.parse(
    await (await request.get("/api/profile/settings")).json(),
  );

  expect(firstSave.languages).toEqual(["fr"]);
  expect(firstSave.timezone).toBe("America/Vancouver");

  await page.reload();
  await expect(page.getByRole("button", { name: "French" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await timezone.selectOption("America/Toronto");
  await expect(timezone).toHaveValue("America/Toronto");

  await expect
    .poll(
      async () =>
        profileSettingsSchema.parse(await (await request.get("/api/profile/settings")).json())
          .pendingTimezone,
    )
    .toBe("America/Toronto");

  const withZone = profileSettingsSchema.parse(
    await (await request.get("/api/profile/settings")).json(),
  );

  expect(withZone.timezone).toBe("America/Vancouver");

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const both = languagesSchema.parse(await (await request.get("/api/profile/languages")).json());

  expect(both.languages.toSorted()).toEqual(["en", "fr"]);

  await page.reload();
  await expect(page.getByLabel("Time zone")).toHaveValue("America/Toronto");

  await context.close();
  await request.dispose();
});
