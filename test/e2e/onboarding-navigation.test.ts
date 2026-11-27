import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { completeOnboardingGaps } from "./onboarding-walk.ts";
import { latestMailLink, requestMagicLink } from "./sign-in.ts";

const USER_EMAIL = "jordan.taylor@example.com";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer, {
        ALLOWED_SIGNUP_EMAILS: USER_EMAIL,
        INBOUND_HMAC_SECRET: "e2e-nav-hmac-secret-0123456789",
      });

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const idSchema = z.object({ id: z.string() });

const onboardingSchema = z.object({
  applicationsLeft: z.number(),
  currentEmployer: z.string().nullable(),
  onboardedAt: z.string().nullable(),
  step: z.number(),
});

function escapePdfText(text: string) {
  return text
    .replaceAll("\\", String.raw`\\`)
    .replaceAll("(", String.raw`\(`)
    .replaceAll(")", String.raw`\)`);
}

function buildFakeResumePdf(lines: readonly string[]) {
  const stream = lines
    .map(
      (line, index) =>
        `BT /F1 11 Tf 48 ${String(740 - index * 16)} Td (${escapePdfText(line)}) Tj ET`,
    )
    .join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${String(Buffer.byteLength(stream, "utf8"))} >> stream\n${stream}\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const objectBody of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${objectBody}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");

  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer << /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

async function createEntity(
  request: APIRequestContext,
  path: string,
  data: Record<string, string | null>,
) {
  const response = await request.post(path, { data });

  expect(response.ok(), `${path} ${String(response.status())}`).toBe(true);

  return idSchema.parse(await response.json()).id;
}

async function seedCatalog(request: APIRequestContext) {
  const companyMain = await createEntity(request, "/__test__/catalog/companies", {
    domain: "oakclinic.example",
    name: "Oak Clinic",
  });

  const companyCloud = await createEntity(request, "/__test__/catalog/companies", {
    domain: "cloudbridge.example",
    name: "CloudBridge",
  });

  const companyCurrent = await createEntity(request, "/__test__/catalog/companies", {
    domain: "northstarlogistics.example",
    name: "Northstar Logistics",
  });

  const boardMain = await createEntity(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "oakclinic",
    companyId: companyMain,
  });

  const boardCloud = await createEntity(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "cloudbridge",
    companyId: companyCloud,
  });

  const boardCurrent = await createEntity(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "northstar",
    companyId: companyCurrent,
  });

  await request.post("/__test__/catalog/postings/close-all");

  const postings = [
    ...Array.from({ length: 4 }, (_, index) => ({
      ats: "greenhouse" as const,
      atsJobId: `nav-pt-${String(index)}`,
      boardId: boardMain,
      city: "Toronto",
      companyId: companyMain,
      countryCode: "CA",
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Toronto, ON, Canada",
      salaryCurrency: "CAD",
      salaryMinMinor: 11_000_000,
      salaryPeriod: "year" as const,
      tags: [
        { dimension: "role" as const, value: "healthcare" },
        { dimension: "granular_role" as const, value: "health.pt" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: `Physical Therapist ${String(index + 1)}`,
      url: `https://oakclinic.example/pt/${String(index)}`,
      workplace: "hybrid" as const,
    })),
    {
      ats: "greenhouse" as const,
      atsJobId: "nav-rn-1",
      boardId: boardMain,
      city: "Toronto",
      companyId: companyMain,
      countryCode: "CA",
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Toronto, ON, Canada",
      tags: [
        { dimension: "role" as const, value: "healthcare" },
        { dimension: "granular_role" as const, value: "health.rn" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: "Registered Nurse",
      url: "https://oakclinic.example/rn/1",
      workplace: "hybrid" as const,
    },
    {
      ats: "greenhouse" as const,
      atsJobId: "nav-remote-world",
      boardId: boardCloud,
      city: null,
      companyId: companyCloud,
      countryCode: null,
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Remote",
      salaryCurrency: "USD",
      salaryMinMinor: 15_000_000,
      salaryPeriod: "year" as const,
      tags: [
        { dimension: "role" as const, value: "software-it" },
        { dimension: "granular_role" as const, value: "infra.devops" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: "Remote Platform Engineer (Global)",
      url: "https://cloudbridge.example/remote-world",
      workplace: "remote" as const,
    },
    {
      ats: "greenhouse" as const,
      atsJobId: "nav-remote-us",
      boardId: boardCloud,
      city: null,
      companyId: companyCloud,
      countryCode: "US",
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Remote, United States",
      salaryCurrency: "USD",
      salaryMinMinor: 16_000_000,
      salaryPeriod: "year" as const,
      tags: [
        { dimension: "role" as const, value: "software-it" },
        { dimension: "granular_role" as const, value: "infra.devops" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: "Remote SRE (US)",
      url: "https://cloudbridge.example/remote-us",
      workplace: "remote" as const,
    },
    {
      ats: "greenhouse" as const,
      atsJobId: "nav-remote-eu",
      boardId: boardCloud,
      city: null,
      companyId: companyCloud,
      countryCode: null,
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Remote, Europe",
      salaryCurrency: "EUR",
      salaryMinMinor: 13_000_000,
      salaryPeriod: "year" as const,
      tags: [
        { dimension: "role" as const, value: "software-it" },
        { dimension: "granular_role" as const, value: "infra.devops" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: "Remote Infrastructure Engineer (EU)",
      url: "https://cloudbridge.example/remote-eu",
      workplace: "remote" as const,
    },
    {
      ats: "greenhouse" as const,
      atsJobId: "nav-current-employer",
      boardId: boardCurrent,
      city: null,
      companyId: companyCurrent,
      countryCode: null,
      employmentType: "full_time" as const,
      language: "en",
      locationRaw: "Remote",
      salaryCurrency: "USD",
      salaryMinMinor: 18_000_000,
      salaryPeriod: "year" as const,
      tags: [
        { dimension: "role" as const, value: "software-it" },
        { dimension: "granular_role" as const, value: "infra.devops" },
        { dimension: "seniority" as const, value: "senior" },
      ],
      title: "Current Employer Platform Role",
      url: "https://northstarlogistics.example/platform",
      workplace: "remote" as const,
    },
  ];

  const bulk = await request.post("/__test__/catalog/postings/bulk", { data: { postings } });

  expect(bulk.ok(), `bulk seed ${String(bulk.status())}`).toBe(true);
}

test("new user navigates forward and back across steps 1-4 with fake PDF and real matches", async ({
  browser,
  onboardingServer,
}) => {
  const api = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seedCatalog(api);

  const linkRequest = await requestMagicLink(onboardingServer.url, api, USER_EMAIL);

  expect(linkRequest.ok()).toBe(true);
  await api.get(await latestMailLink(onboardingServer.url, api, USER_EMAIL));
  await api.post("/__test__/user/name", { data: { email: USER_EMAIL, name: "Jordan Taylor" } });

  const storageState = await api.storageState();

  const context = await browser.newContext({
    deviceScaleFactor: 1,
    storageState,
    viewport: { height: 844, width: 390 },
  });

  const page = await context.newPage();

  const fakePdf = buildFakeResumePdf([
    "Jordan Taylor",
    "jordan.taylor.example@invalid.test | +1 (416) 555-0148 | Toronto, ON",
    "Current employer: Northstar Logistics",
    "SUMMARY",
    "Senior Platform Engineer and Healthcare Infrastructure Specialist with 8 years building",
    "resilient cloud platforms, automated CI/CD workflows, and hospital clinical systems.",
    "EXPERIENCE",
    "Northstar Logistics — Senior Platform Engineer | 2022 - Present",
    "Led Kubernetes clusters, Terraform deployments, and production incident automation.",
    "Harbor Clinic Group — Systems Specialist | 2018 - 2022",
    "Managed clinical rehab platforms, SQL clusters, and HIPAA audit tooling.",
  ]);

  await page.goto(`${onboardingServer.url}/onboarding`);
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);

  const continueBtn = page.getByRole("button", { name: "Continue" });

  await expect(continueBtn).toBeDisabled();

  await page.locator('input[type="file"]').setInputFiles({
    buffer: fakePdf,
    mimeType: "application/pdf",
    name: "jordan-taylor-resume.pdf",
  });

  await expect(page.getByText("Scanning your resume")).toBeVisible();
  await expect(page.getByText("PDF verified", { exact: true })).toHaveCount(0);

  await expect(page.getByText("PDF verified", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("jordan-taylor-resume.pdf").first()).toBeVisible();

  const skipped = await api.put("/api/profile/skip-companies", {
    data: { companies: [{ name: "Northstar Logistics", domain: null }] },
  });

  expect(skipped.ok()).toBe(true);

  await continueBtn.click();
  await expect(page).toHaveURL(/\/onboarding\/gaps$/u);
  await completeOnboardingGaps(page);
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  await page.getByRole("button", { name: /^Add a role category/u }).click();
  await page.getByRole("option", { exact: true, name: "Software engineering" }).click();

  await page.getByRole("textbox", { name: "Title words" }).fill("Platform");
  await page.getByRole("button", { name: "Add word" }).click();
  await page.getByRole("textbox", { name: "Title words" }).fill("SRE");
  await page.getByRole("button", { name: "Add word" }).click();
  await page.getByRole("textbox", { name: "Title words" }).fill("Infrastructure");
  await page.getByRole("button", { name: "Add word" }).click();

  await expect(page.getByRole("button", { name: "Remove Software engineering" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Platform" })).toBeVisible();

  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(mobileOverflow).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Locations" }).click();
  await page.getByPlaceholder("Search cities or remote regions...").fill("Worldwide");
  await page
    .getByRole("option", { name: /Worldwide/u })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^Remove Remote/u })).toBeVisible();

  const status = page.getByTestId("onboarding-targets-status");

  await expect(status).toContainText("open roles match");

  await page.getByRole("button", { name: "See my matches" }).click();
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);
  await expect(page.getByRole("heading", { level: 2, name: /Your matches/u })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Remote Platform Engineer (Global)")).toBeVisible();
  await expect(page.getByText("Remote SRE (US)")).toBeVisible();
  await expect(page.getByText("Remote Infrastructure Engineer (EU)")).toBeVisible();
  await expect(page.getByText("Current Employer Platform Role")).toHaveCount(0);

  await page.getByRole("link", { name: /Back to preferences/u }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/onboarding\/gaps$/u);

  await page.getByRole("link", { name: /Back to resume/u }).click();
  await expect(page).toHaveURL(/\/onboarding\/resume$/u);
  await expect(page.getByText("PDF verified", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/gaps$/u);

  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(status).toContainText("open roles match");

  await page.getByRole("button", { name: "Remove Platform" }).click();
  await page.getByRole("button", { name: "Remove SRE" }).click();
  await page.getByRole("button", { name: "Remove Infrastructure" }).click();

  await page.getByRole("button", { name: "Remove Software engineering" }).click();

  const remoteChip = page.getByRole("button", { name: /^Remove Remote/u });

  if ((await remoteChip.count()) > 0) {
    await remoteChip.click();
  }

  await page.getByRole("button", { name: /^Add a role category/u }).click();
  await page.getByRole("option", { exact: true, name: "Healthcare" }).click();
  await page.getByRole("textbox", { name: "Title words" }).fill("Physical Therapist");
  await page.getByRole("button", { name: "Add word" }).click();

  await page.getByRole("button", { name: "Locations" }).click();
  await page.getByPlaceholder("Search cities or remote regions...").fill("Toronto");
  await page
    .getByRole("option", { name: /^Toronto/u })
    .first()
    .click();

  await expect(status).toContainText("open roles match");

  await page.getByRole("button", { name: "See my matches" }).click();
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Physical Therapist/u).first()).toBeVisible();
  await expect(page.getByText("Remote Platform Engineer (Global)")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("3 of 3 selected");

  await page.getByRole("button", { name: /Apply to these 3 roles for free/u }).click();
  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();

  expect(dialogBox).not.toBeNull();
  expect(dialogBox?.height ?? 0).toBeLessThanOrEqual(844 * 0.92);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);

  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("link", { name: /Back to preferences/u }).click();
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/onboarding\/targets$/u);

  await page.getByRole("button", { name: "See my matches" }).click();
  await expect(page).toHaveURL(/\/onboarding\/matches$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const granted = await api.post("/__test__/ledger/grant", {
    data: {
      email: USER_EMAIL,
      idempotencyKey: "nav-test-grant",
      quantity: 3,
      source: "trial",
    },
  });

  expect(granted.ok()).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: /Apply to these 3 roles for free/u }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox").check();

  const startBtn = dialog.getByRole("button", { name: "Start preparing applications" });

  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect(page).toHaveURL(/\/ready$/u, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: /Approval Queue/u })).toBeVisible();

  const finalState = onboardingSchema.parse(await (await api.get("/api/onboarding")).json());

  expect(finalState.onboardedAt).not.toBeNull();
  expect(finalState.step).toBe(5);

  await context.close();
  await api.dispose();
});
