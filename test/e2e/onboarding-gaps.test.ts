import { z } from "zod";

import { request as apiRequest } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const KEY_DETAIL_LABELS = [
  "First and last name",
  "Email",
  "Phone",
  "City",
  "Country",
  "Legally allowed to work in the country",
  "Needs sponsorship",
  "LinkedIn",
  "Current employer",
  "Salary expectation",
  "Notice period or earliest start",
  "Willing to relocate",
  "Languages and proficiency level",
] as const;

const factsSchema = z.object({
  facts: z.array(
    z.object({
      confirmed: z.boolean(),
      key: z.string(),
      scope: z.string(),
      source: z.string(),
      value: z.string(),
    }),
  ),
});

const test = appTest.extend<{ gapsServer: AppServer }>({
  gapsServer: [
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

async function signInOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
}

async function uploadResume(page: Page, appServerUrl: string) {
  await page.goto(`${appServerUrl}/onboarding`);
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await page.locator('input[type="file"]').setInputFiles("test/e2e/fixtures/resume-text.pdf");
  await expect(page.getByText("resume-text.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/gaps$/u);
}

async function expectGapsFromResume(page: Page) {
  await expect(page.getByRole("heading", { level: 2, name: "Fill the gaps" })).toBeVisible();
  await expect(
    page.getByText("We use these on every application so you aren't asked again."),
  ).toBeVisible();

  await expect(page.getByLabel("First and last name", { exact: true })).toHaveValue("Maya Okafor");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("maya.okafor@example.com");
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue("+1 416 555 0199");
  await expect(page.getByLabel("City", { exact: true })).toHaveValue("Toronto");
  await expect(page.getByLabel("Country", { exact: true })).toHaveValue("Canada");
  await expect(
    page.getByLabel("Legally allowed to work in the country", { exact: true }),
  ).toHaveValue("Yes");
  await expect(page.getByLabel("Current employer", { exact: true })).toHaveValue(
    "Brightwave Analytics",
  );
  await expect(page.getByLabel("Languages and proficiency level", { exact: true })).toHaveValue(
    "English, French",
  );

  await expect(page.getByLabel("Salary expectation", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Notice period or earliest start", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("LinkedIn", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Needs sponsorship", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Willing to relocate", { exact: true })).toHaveValue("");

  await expect(page.getByText("From your resume").first()).toBeVisible();
}

async function fillMissing(page: Page) {
  await page.getByLabel("Needs sponsorship", { exact: true }).selectOption("No");
  await page.getByLabel("Willing to relocate", { exact: true }).selectOption("Yes");
  await page.getByLabel("Salary expectation", { exact: true }).fill("CAD 120,000 a year");
  await page.getByLabel("Notice period or earliest start", { exact: true }).fill("Two weeks");
  await page
    .getByLabel("LinkedIn", { exact: true })
    .fill("https://www.linkedin.com/in/maya-okafor");
}

function fieldsOn(page: Page) {
  return page.locator("#onboarding-gaps label");
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`a fresh user confirms the resume details and fills only the gaps at ${String(width)}px in ${theme}`, async ({
      browser,
      gapsServer,
    }) => {
      const request = await apiRequest.newContext({ baseURL: gapsServer.url });

      await signInOwner(request, gapsServer.url);

      const storageState = await request.storageState();

      const context = await browser.newContext({
        deviceScaleFactor: 1,
        storageState,
        viewport: { height: width === 1280 ? 960 : 844, width },
      });

      const page = await context.newPage();

      if (theme === "dark") {
        await page.addInitScript(() => {
          globalThis.localStorage.setItem("overture.theme", "dark");
        });
      }

      await uploadResume(page, gapsServer.url);
      await expectGapsFromResume(page);

      await expect(fieldsOn(page)).toHaveText([...KEY_DETAIL_LABELS]);

      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(overflow, `${String(width)}px ${theme}`).toBe(false);

      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      await page.screenshot({
        path: `test-results/onboarding-gaps-${String(width)}-${theme}.png`,
        fullPage: true,
      });

      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page.getByLabel("Needs sponsorship", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.getByText("Needs sponsorship is needed to continue.")).toBeVisible();
      await expect(page.getByLabel("Salary expectation", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );

      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await fillMissing(page);
      await page.getByRole("button", { name: "Save and continue" }).click();
      await expect(page).toHaveURL(/\/onboarding\/targets$/u);

      const saved = factsSchema.parse(await (await request.get("/api/profile/facts")).json()).facts;

      for (const key of [
        "legal_name",
        "email",
        "phone",
        "current_city",
        "current_country",
        "current_employer",
        "languages",
        "sponsorship_required",
        "willing_relocate",
        "salary_expectation",
        "notice_period",
        "linkedin_url",
      ]) {
        const fact = saved.find((entry) => entry.key === key);

        expect(fact?.confirmed, key).toBe(true);
      }

      expect(saved.find((entry) => entry.key === "legal_name")?.source).toBe("resume");
      expect(saved.find((entry) => entry.key === "notice_period")?.value).toBe("Two weeks");

      await page.goto(`${gapsServer.url}/onboarding/gaps`);
      await expect(page.getByRole("heading", { level: 2, name: "Fill the gaps" })).toBeVisible();
      await expect(page.getByLabel("Salary expectation", { exact: true })).toHaveValue(
        "CAD 120,000 a year",
      );
      await expect(page.getByLabel("Needs sponsorship", { exact: true })).toHaveValue("No");

      await context.close();
      await request.dispose();
    });
  }
}

test("Profile → Saved answers lists the same key details in the same order", async ({
  browser,
  gapsServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: gapsServer.url });

  await signInOwner(request, gapsServer.url);

  const fields = [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@example.com" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_city", value: "Toronto" },
    { key: "current_country", value: "Canada" },
    { key: "work_auth", value: "Yes" },
    { key: "sponsorship_required", value: "No" },
    { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
    { key: "current_employer", value: "Brightwave Analytics" },
    { key: "salary_expectation", value: "CAD 120,000 a year" },
    { key: "notice_period", value: "Two weeks" },
    { key: "willing_relocate", value: "Yes" },
    { key: "languages", value: "English, French" },
  ];

  const saved = await request.put("/api/profile/facts", { data: { facts: fields } });

  expect(saved.ok(), await saved.text()).toBe(true);

  const storageState = await request.storageState();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1000, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${gapsServer.url}/profile/details`);
  await expect(page.getByRole("heading", { level: 1, name: "Saved answers" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Key details" })).toBeVisible();

  const labels = page.locator("#profile-key-details-list > div > div > div > p").first();
  const rows = page.locator("#profile-key-details-list > div");

  await expect(rows).toHaveCount(KEY_DETAIL_LABELS.length);
  await expect(labels).toBeVisible();

  const rendered = await Promise.all(
    KEY_DETAIL_LABELS.map(async (_label, index) => {
      const text = await rows.nth(index).locator("p").first().textContent();

      return (text ?? "").trim();
    }),
  );

  expect(rendered).toEqual([...KEY_DETAIL_LABELS]);

  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await page.screenshot({
    path: "test-results/onboarding-gaps-profile-1280-light.png",
    fullPage: true,
  });

  await context.close();
  await request.dispose();
});
