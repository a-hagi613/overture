import { readFileSync } from "node:fs";

import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, test } from "./app.fixture.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const createdSchema = z.object({ id: z.string() });
const countSchema = z.object({ matchedCount: z.number() });
const languagesSchema = z.object({ languages: z.array(z.string()) });

const baseTargets = {
  roles: ["Backend"],
  seniorities: ["senior"],
  workplaces: ["remote"],
  locations: ["Toronto, ON"],
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
    city: "Toronto",
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

  await page.goto("/profile");
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

test("the skip list is prefilled from the resume, and companies add and remove", async ({
  isolatedAppServer: { url: appServerUrl },
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

  await page.goto("/profile");

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

test("posting languages save from Settings", async ({
  isolatedAppServer: { url: appServerUrl },
  browser,
}) => {
  const { request, storageState } = await ownerStorage(appServerUrl);

  const context = await browser.newContext({ baseURL: appServerUrl, storageState });
  const page = await context.newPage();

  await page.goto("/settings");

  const french = page.getByRole("button", { name: "French" });

  await expect(french).toHaveAttribute("aria-pressed", "false");
  await french.click();
  await expect(french).toHaveAttribute("aria-pressed", "true");

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  await page.reload();
  await expect(page.getByRole("button", { name: "French" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const saved = languagesSchema.parse(await (await request.get("/api/profile/languages")).json());

  expect(saved.languages).toEqual(["fr"]);

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const both = languagesSchema.parse(await (await request.get("/api/profile/languages")).json());

  expect(both.languages.toSorted()).toEqual(["en", "fr"]);

  await context.close();
  await request.dispose();
});
