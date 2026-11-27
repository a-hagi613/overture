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

const countSchema = z.object({ matchedCount: z.number() });
const languagesSchema = z.object({ languages: z.array(z.string()) });

const profileSettingsSchema = z.object({
  languages: z.array(z.string()),
  timezone: z.string().nullable(),
  pendingTimezone: z.string().nullable(),
  pendingTimezoneAt: z.string().nullable(),
});

const baseTargets = {
  roles: ["backend"],
  unresolvedRoles: [],
  locations: ["city:ca:ottawa"],
  unresolvedLocations: [],
};

async function ownerStorage(appServerUrl: string) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);

  const storageState = await request.storageState();

  return { request, storageState };
}

async function seedJobs(appServerUrl: string) {
  const response = await fetch(`${appServerUrl}/__test__/jobs/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          category: "backend",
          cities: ["Ottawa"],
          company: "Ui Target Co",
          countries: ["ca"],
          public_slug: "ui-senior-backend",
          title: "Senior Backend Engineer",
        },
        {
          category: "backend",
          cities: ["Ottawa"],
          company: "Ui Target Co",
          countries: ["ca"],
          public_slug: "ui-backend",
          title: "Backend Engineer",
        },
        {
          category: "healthcare",
          cities: ["Ottawa"],
          company: "Ui Target Co",
          countries: ["ca"],
          public_slug: "ui-registered-nurse",
          title: "Registered Nurse",
        },
      ],
    }),
  });

  expect(response.status).toBe(200);
}

test("the live count updates as title words are added, and Save stores them", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  await seedJobs(appServerUrl);

  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: baseTargets });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("textbox", { name: "Title words" }).fill("Registered");
  await page.getByRole("button", { name: "Add word" }).click();
  await expect(page.getByRole("button", { name: "Remove Registered" })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("3");

  await page.getByRole("button", { name: "Remove Registered" }).click();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("button", { name: "Save preferences" }).click();

  await page.reload();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Remove Backend" })).toBeVisible();

  const saved = countSchema.parse(
    await (await request.post("/api/profile/targets/match-count", { data: baseTargets })).json(),
  );

  expect(saved.matchedCount).toBe(2);

  await context.close();
  await request.dispose();
});

test("a freehire category can be searched and added from Profile, and the count follows", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  await seedJobs(appServerUrl);

  const { request, storageState } = await ownerStorage(appServerUrl);

  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: baseTargets });

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/profile/preferences");
  await expect(page.getByTestId("targets-matched-count")).toHaveText("2");

  await page.getByRole("button", { name: /^Add a role category/u }).click();
  await page.getByRole("option", { exact: true, name: "Healthcare" }).click();

  await expect(page.getByRole("button", { name: "Remove Healthcare" })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("3");

  await page.getByRole("button", { name: "Save preferences" }).click();

  await page.reload();

  await expect(page.getByRole("button", { name: "Remove Healthcare" })).toBeVisible();
  await expect(page.getByTestId("targets-matched-count")).toHaveText("3");

  const results = await new AxeBuilder({ page }).include("#profile-targets").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("only a picked suggestion becomes a place pill, and an unresolved place can be resolved or dismissed", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
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

  await page.getByRole("button", { name: "Save preferences" }).click();

  await page.reload();

  await expect(page.getByRole("button", { name: "Remove Ottawa" })).toBeVisible();
  await expect(page.getByText("Victoria", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss Victoria" }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();

  await page.reload();

  await expect(page.getByText("Victoria", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Ottawa" })).toBeVisible();

  const results = await new AxeBuilder({ page }).include("#profile-targets").analyze();

  expect(results.violations).toEqual([]);

  await context.close();
  await request.dispose();
});

test("the current employer and excluded employers are in the one Preferences card", async ({
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

  const card = page.locator("#profile-targets");

  await expect(card.getByText("Brightwave Analytics")).toBeVisible();
  await expect(card.getByText("Current employer", { exact: true })).toBeVisible();

  await page.getByLabel("Add an employer to exclude").fill("Quillon Payments");
  await page.getByRole("button", { name: "Add", exact: true }).last().click();

  await expect(card.getByText("Quillon Payments")).toBeVisible();

  await page.reload();
  await expect(card.getByText("Quillon Payments")).toBeVisible();

  await page.getByRole("button", { name: "Remove Quillon Payments" }).click();

  await expect(card.getByText("Quillon Payments")).toHaveCount(0);
  await expect(card.getByText("Brightwave Analytics")).toBeVisible();

  await page.reload();
  await expect(card.getByText("Quillon Payments")).toHaveCount(0);
  await expect(card.getByText("Current employer", { exact: true })).toBeVisible();

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
