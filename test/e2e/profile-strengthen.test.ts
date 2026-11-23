import { AxeBuilder } from "@axe-core/playwright";
import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext, Browser } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { authTestIdentity } from "./auth.fixture.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import { seedApplication, seedBoard, seedCompany, seedPosting } from "./matching-harness.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const test = appTest.extend<{ strengthenServer: AppServer }>({
  strengthenServer: [
    async ({ identityServer }, provide) => {
      const greenhouse = startGreenhouseFixture();

      const server = await startFreshAppServer(identityServer, {
        GREENHOUSE_BOARD_BASE_URL: greenhouse.url,
        GREENHOUSE_FEED_BASE_URL: greenhouse.url,
      });

      await provide(server);
      await server.stop();
      greenhouse.close();
    },
    { scope: "test" },
  ],
});

const createdSchema = z.object({ reviewId: z.string(), questionId: z.string() });

const strengthenSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      prompt: z.string(),
      fieldType: z.string(),
      options: z.array(z.string()),
      unlocked: z.number(),
    }),
  ),
  unlocks: z.number(),
});

const factsResponseSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      source: z.string(),
      confirmed: z.boolean(),
      revision: z.number(),
    }),
  ),
});

const reviewsResponseSchema = z.object({
  reviews: z.array(z.object({ factKey: z.string().nullable(), status: z.string() })),
});

const applicationsResponseSchema = z.object({
  applications: z.array(z.object({ id: z.string(), status: z.string() })),
});

const jobsResponseSchema = z.object({
  jobs: z.array(z.object({ id: z.string(), kind: z.string(), payload: z.string() })),
});

const targets = {
  roles: ["Platform Engineer", "DevOps Engineer"],
  seniorities: ["senior"],
  workplaces: ["remote"],
  locations: ["Toronto, ON"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: null,
  salaryCurrency: null,
  salaryPeriod: "year",
};

const applications = [
  { company: "Northwind Labs", domain: "northwind.example", token: "northwind" },
  { company: "Ferro Cloud", domain: "ferro.example", token: "ferro" },
  { company: "Halden Systems", domain: "halden.example", token: "halden" },
] as const;

interface SeededBoard {
  applicationIds: string[];
  userId: string;
}

async function seedOwner(request: APIRequestContext, appServerUrl: string) {
  await requestMagicLink(appServerUrl, request, authTestIdentity.ownerEmail);

  const link = await latestMailLink(appServerUrl, request, authTestIdentity.ownerEmail);

  await request.get(link);
  await request.post(`${appServerUrl}/__test__/user/name`, {
    data: { email: authTestIdentity.ownerEmail, name: authTestIdentity.ownerName },
  });
  await request.post("/api/running", { data: { running: true } });
  await request.put("/api/profile/languages", { data: { languages: ["en"] } });
  await request.put("/api/profile/targets", { data: targets });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  return owner.id;
}

async function seedStrengthenBoard(request: APIRequestContext, appServerUrl: string) {
  const userId = await seedOwner(request, appServerUrl);

  const applicationIds = await Promise.all(
    applications.map(async (entry, index) => {
      const companyId = await seedCompany(request, entry.company, entry.domain);
      const boardId = await seedBoard(request, companyId, "greenhouse", entry.token);

      const postingId = await seedPosting(request, {
        atsJobId: `strengthen-${String(index)}`,
        boardId,
        companyId,
        tags: [{ dimension: "seniority", value: "senior" }],
        title: "Senior Platform Engineer",
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
      applicationIds: applicationIds.slice(0, 2),
      answerKind: "fact",
      factKey: "security_clearance",
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Security clearance status",
    },
    {
      applicationIds: applicationIds.slice(2),
      answerKind: "fact",
      factKey: "drivers_license",
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Do you hold a driver's licence?",
    },
    {
      applicationIds: applicationIds.slice(1, 2),
      answerKind: "fact",
      factKey: "notice_period",
      fieldType: "text",
      options: [],
      prompt: "What is your notice period?",
    },
    {
      applicationIds: applicationIds.slice(2),
      answerKind: "unknown",
      factKey: null,
      fieldType: "text",
      options: [],
      prompt: "Which team would you like to join?",
    },
  ];

  await Promise.all(
    reviews.map(async (review) => {
      const response = await request.post("/__test__/reviews/seed", {
        data: { ...review, userId },
      });

      createdSchema.parse(await response.json());
    }),
  );

  return { applicationIds, userId } satisfies SeededBoard;
}

async function openStrengthen(
  browser: Browser,
  appServerUrl: string,
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>,
) {
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  await page.goto(`${appServerUrl}/profile/details`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: /Tier 2/u }).click();
  await expect(page.getByTestId("strengthen-security_clearance")).toBeVisible();

  return { context, page };
}

test("answering a Tier 2 Fact saves it, resolves its Reviews and drops the unlock counts", async ({
  browser,
  strengthenServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: strengthenServer.url });

  const { applicationIds, userId } = await seedStrengthenBoard(request, strengthenServer.url);

  const before = strengthenSchema.parse(
    await (await request.get("/api/profile/strengthen")).json(),
  );

  expect(before.unlocks).toBe(3);
  expect(before.facts).toEqual([
    {
      fieldType: "select",
      key: "security_clearance",
      label: "Security clearance",
      options: ["Yes", "No"],
      prompt: "Security clearance status",
      unlocked: 2,
    },
    {
      fieldType: "select",
      key: "drivers_license",
      label: "Driver's licence",
      options: ["Yes", "No"],
      prompt: "Do you hold a driver's licence?",
      unlocked: 1,
    },
  ]);

  const storageState = await request.storageState();

  const { context, page } = await openStrengthen(browser, strengthenServer.url, storageState);

  await expect(page.getByTestId("strengthen-security_clearance")).toContainText(
    "Unlocks 2 queued applications",
  );
  await expect(page.getByTestId("strengthen-drivers_license")).toContainText(
    "Unlocks 1 queued application",
  );
  await expect(page.getByTestId("strengthen-notice_period")).toHaveCount(0);
  await expect(page.getByText("Which team would you like to join?")).toHaveCount(0);

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);

  const security = page.getByTestId("strengthen-security_clearance");

  await security.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Save fact: Security clearance" }).click();

  await expect(page.getByTestId("strengthen-security_clearance")).toHaveCount(0);
  await expect(page.getByTestId("strengthen-drivers_license")).toContainText(
    "Unlocks 1 queued application",
  );

  const after = strengthenSchema.parse(await (await request.get("/api/profile/strengthen")).json());

  expect(after).toEqual({
    facts: [
      {
        fieldType: "select",
        key: "drivers_license",
        label: "Driver's licence",
        options: ["Yes", "No"],
        prompt: "Do you hold a driver's licence?",
        unlocked: 1,
      },
    ],
    unlocks: 1,
  });

  const savedFacts = factsResponseSchema.parse(
    await (await request.get("/api/profile/facts")).json(),
  );

  const clearance = savedFacts.facts.find((fact) => fact.key === "security_clearance");

  expect(clearance?.value).toBe("Yes");
  expect(clearance?.source).toBe("user");

  const jobs = jobsResponseSchema.parse(await (await request.get("/__test__/jobs")).json());

  const prepared = jobs.jobs
    .filter((job) => job.kind === "application.prepare")
    .flatMap((job) => {
      const payload = z.object({ applicationId: z.string() }).parse(JSON.parse(job.payload));

      return [payload.applicationId];
    });

  expect(prepared).toEqual(expect.arrayContaining(applicationIds.slice(0, 2)));

  await expect
    .poll(
      async () => {
        const rows = applicationsResponseSchema.parse(
          await (await request.get(`/__test__/applications?userId=${userId}`)).json(),
        ).applications;

        return rows
          .map((application) => application.status)
          .toSorted()
          .join(",");
      },
      { timeout: 30_000 },
    )
    .toBe("needs_review,ready,ready");

  await expect
    .poll(
      async () => {
        const rows = reviewsResponseSchema.parse(
          await (await request.get(`/__test__/reviews?userId=${userId}`)).json(),
        ).reviews;

        return rows
          .filter((review) => review.status === "open")
          .map((review) => review.factKey ?? "none")
          .toSorted((left, right) => left.localeCompare(right))
          .join(",");
      },
      { timeout: 30_000 },
    )
    .toBe("drivers_license,none");

  await page.goto(`${strengthenServer.url}/profile/details#profile-strengthen`);
  await expect(page.getByRole("tab", { name: /Tier 2/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("strengthen-security_clearance")).toHaveCount(0);
  await expect(page.getByTestId("strengthen-drivers_license")).toBeVisible();

  await context.close();
  await request.dispose();
});
