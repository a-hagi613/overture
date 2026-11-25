import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { AxeBuilder } from "@axe-core/playwright";
import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedApplication, seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { seedUnreadNotifications } from "./notification-seed.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const test = appTest.extend<{ reviewServer: AppServer }>({
  reviewServer: [
    async ({ identityServer }, provide) => {
      const server = await startFreshAppServer(identityServer);

      await provide(server);
      await server.stop();
    },
    { scope: "test" },
  ],
});

const reviewCreatedSchema = z.object({ reviewId: z.string(), questionId: z.string() });

const targets = {
  roles: ["Platform Engineer", "DevOps Engineer", "Site Reliability Engineer"],
  seniorities: ["senior", "staff"],
  workplaces: ["remote", "hybrid"],
  locations: ["Toronto, ON"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
};

const applications: {
  company: string;
  domain: string;
  token: string;
  title: string;
}[] = [
  {
    company: "Northwind Labs",
    domain: "northwind.example",
    token: "northwind",
    title: "Platform Engineer",
  },
  {
    company: "Ferro Cloud",
    domain: "ferro.example",
    token: "ferro",
    title: "Senior DevOps Engineer",
  },
  {
    company: "Halden Systems",
    domain: "halden.example",
    token: "halden",
    title: "Site Reliability Engineer",
  },
  {
    company: "Larkspur Health",
    domain: "larkspur.example",
    token: "larkspur",
    title: "Platform Engineer",
  },
  {
    company: "Halden Systems",
    domain: "halden-staff.example",
    token: "halden-staff",
    title: "Staff Platform Engineer",
  },
  {
    company: "Tideline Software",
    domain: "tideline.example",
    token: "tideline",
    title: "Backend Engineer",
  },
  {
    company: "Brightwave Analytics",
    domain: "brightwave.example",
    token: "brightwave",
    title: "Infrastructure Engineer",
  },
  {
    company: "Larkspur Health",
    domain: "larkspur-senior.example",
    token: "larkspur-senior",
    title: "Senior Platform Engineer",
  },
  {
    company: "Ferro Cloud",
    domain: "ferro-cloud.example",
    token: "ferro-cloud",
    title: "Cloud Engineer",
  },
  {
    company: "Ferro Cloud",
    domain: "ferro-platform.example",
    token: "ferro-platform",
    title: "Platform Engineer",
  },
];

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await seedUnreadNotifications(request, appServerUrl);
  await request.post("/api/running", { data: { running: true } });
  await request.post(`${appServerUrl}/__test__/ledger/sample`, {
    data: { email: authTestIdentity.ownerEmail },
  });
  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: targets });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  return owner.id;
}

async function seedReviewBoard(request: APIRequestContext, userId: string) {
  const applicationIds = await Promise.all(
    applications.map(async (entry, index) => {
      const companyId = await seedCompany(request, entry.company, entry.domain);
      const boardId = await seedBoard(request, companyId, "greenhouse", entry.token);

      const postingId = await seedPosting(request, {
        atsJobId: `review-${String(index)}`,
        boardId,
        companyId,
        tags: [
          { dimension: "subrole", value: "Platform" },
          { dimension: "seniority", value: "senior" },
        ],
        title: entry.title,
        url: `https://${entry.domain}/${String(index)}`,
      });

      return seedApplication(request, {
        createdAt: index + 1,
        postingId,
        status: "needs_review",
        userId,
      });
    }),
  );

  const reviews = [
    {
      applicationIds: applicationIds.slice(0, 4),
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Are you comfortable with a weekly on-call rotation?",
    },
    {
      applicationIds: applicationIds.slice(4, 7),
      fieldType: "text",
      options: [],
      prompt: "How many years have you run Kubernetes in production?",
    },
    {
      applicationIds: applicationIds.slice(7, 9),
      fieldType: "text",
      options: [],
      prompt: "Security clearance status",
    },
    {
      applicationIds: applicationIds.slice(9),
      fieldType: "url",
      options: [],
      prompt: "Link to your portfolio",
    },
  ];

  await Promise.all(
    reviews.map(async (review) => {
      const response = await request.post("/__test__/reviews/seed", {
        data: { ...review, userId },
      });

      reviewCreatedSchema.parse(await response.json());
    }),
  );
}

async function expectReviewMatchesBoard(
  browser: Browser,
  appServerUrl: string,
  width: number,
  theme: string,
) {
  const request = await apiRequest.newContext({ baseURL: appServerUrl });

  const userId = await seedOwner(request, appServerUrl);

  await seedReviewBoard(request, userId);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });

  if (theme === "dark") {
    await page.addInitScript(() => {
      globalThis.localStorage.setItem("overture.theme", "dark");
    });
  }

  await page.goto(`${appServerUrl}/review`);

  await expect(page.getByRole("heading", { level: 1, name: "Review Queue" })).toBeVisible();

  const summary = page.getByRole("region", { name: "Review summary" });

  await expect(summary.getByText("Open questions")).toBeVisible();
  await expect(summary.getByText("4", { exact: true })).toBeVisible();
  await expect(summary.getByText("Blocked applications")).toBeVisible();
  await expect(summary.getByText("10", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Are you comfortable with a weekly on-call rotation?",
    }),
  ).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations, `${String(width)}px ${theme}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow, `${String(width)}px ${theme}`).toBe(false);

  await context.close();
}

for (const width of [1280, 390]) {
  for (const theme of ["light", "dark"]) {
    test(`the Review page matches the board at ${String(width)}px in ${theme}`, async ({
      browser,
      reviewServer,
    }) => {
      await expectReviewMatchesBoard(browser, reviewServer.url, width, theme);
    });
  }
}

test("mobile Review drawer opens from the list and Close returns without hiding the active question", async ({
  browser,
  reviewServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: reviewServer.url });
  const userId = await seedOwner(request, reviewServer.url);

  await seedReviewBoard(request, userId);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${reviewServer.url}/review`);

  const firstPrompt = "Are you comfortable with a weekly on-call rotation?";

  const firstPromptButton = page.getByRole("button", {
    name: /Are you comfortable with a weekly on-call rotation\?/u,
  });

  await expect(page.getByRole("heading", { level: 2, name: firstPrompt })).toBeVisible();
  await expect(page.getByRole("region", { name: "Review summary" })).toBeVisible();
  await expect(firstPromptButton).toBeVisible();

  await firstPromptButton.click();

  const dialog = page.getByRole("dialog");

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: firstPrompt })).toBeVisible();
  await expect(page).toHaveURL(/[?&]question=/u);

  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(firstPromptButton).toBeVisible();

  await firstPromptButton.click();

  await expect(dialog.getByRole("heading", { name: firstPrompt })).toBeVisible();

  await context.close();
});
