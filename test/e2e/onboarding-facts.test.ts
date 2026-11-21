import { request as apiRequest } from "@playwright/test";
import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { seedOnboardingBoard, startAtsStub } from "./onboarding-harness.ts";

const test = appTest.extend<{ onboardingServer: AppServer }>({
  onboardingServer: [
    async ({ identityServer }, provide) => {
      const ats = startAtsStub();

      const server = await startFreshAppServer(identityServer, {
        GREENHOUSE_BOARD_BASE_URL: ats.url,
        GREENHOUSE_FEED_BASE_URL: ats.url,
      });

      await provide(server);
      await server.stop();
      ats.close();
    },
    { scope: "test" },
  ],
});

const factsSchema = z.object({
  facts: z.array(z.object({ key: z.string(), scope: z.string(), value: z.string() })),
});

const reviewsSchema = z.object({
  reviews: z.array(
    z.object({
      factKey: z.string().nullable(),
      prompt: z.string(),
      scope: z.string(),
      status: z.string(),
    }),
  ),
});

const viewSchema = z.object({
  answers: z.object({
    jobTitle: z.string(),
    salary: z.array(z.object({ amount: z.string(), currency: z.string(), period: z.string() })),
    workAuth: z.record(z.string(), z.string()),
  }),
  currencies: z.array(z.string()),
  unlocks: z.object({
    eeo: z.number(),
    hear: z.number(),
    jobTitle: z.number(),
    salary: z.number(),
    workAuth: z.number(),
  }),
});

async function seeded(request: APIRequestContext, appServerUrl: string) {
  return seedOnboardingBoard(request, appServerUrl);
}

test("each question counts the queued Applications its answer would resolve", async ({
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  const owner = await seeded(request, onboardingServer.url);
  const view = viewSchema.parse(await (await request.get("/api/onboarding/facts")).json());

  expect(owner.userId.length).toBeGreaterThan(0);
  expect(view.unlocks).toEqual({ eeo: 9, hear: 14, jobTitle: 14, salary: 9, workAuth: 31 });
  expect(view.currencies).toEqual(["CAD", "USD"]);
  expect(view.answers.workAuth).toEqual({ CA: "Permanent resident" });
  expect(view.answers.salary).toEqual([{ amount: "140,000", currency: "CAD", period: "a year" }]);

  await request.dispose();
});

test("a work-authorisation answer saves that country's Fact and resolves that country's Reviews", async ({
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  const owner = await seeded(request, onboardingServer.url);

  const saved = viewSchema.parse(
    await (
      await request.put("/api/onboarding/facts", {
        data: { workAuth: [{ code: "US", value: "Citizen" }] },
      })
    ).json(),
  );

  expect(saved.answers.workAuth).toEqual({ CA: "Permanent resident", US: "Citizen" });
  expect(saved.unlocks.workAuth).toBe(23);

  const facts = factsSchema
    .parse(await (await request.get("/api/profile/facts")).json())
    .facts.filter((fact) => fact.key === "work_auth");

  expect(facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ scope: "CA", value: "Permanent resident" }),
      expect.objectContaining({ scope: "US", value: "Citizen" }),
    ]),
  );

  const reviews = reviewsSchema
    .parse(
      await (
        await request.get(`/__test__/reviews?userId=${encodeURIComponent(owner.userId)}`)
      ).json(),
    )
    .reviews.filter((review) => review.factKey === "work_auth");

  expect(reviews).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ scope: "CA", status: "open" }),
      expect.objectContaining({ scope: "GB", status: "open" }),
      expect.objectContaining({ scope: "US", status: "answered" }),
    ]),
  );

  await request.dispose();
});

test("the salary answer is kept once per currency and resolves only that currency's Reviews", async ({
  onboardingServer,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  const owner = await seeded(request, onboardingServer.url);

  const saved = viewSchema.parse(
    await (
      await request.put("/api/onboarding/facts", {
        data: {
          salary: [
            { amount: "140,000", currency: "CAD", period: "a year" },
            { amount: "95,000", currency: "USD", period: "a year" },
          ],
        },
      })
    ).json(),
  );

  expect(saved.answers.salary).toEqual([
    { amount: "140,000", currency: "CAD", period: "a year" },
    { amount: "95,000", currency: "USD", period: "a year" },
  ]);
  expect(saved.unlocks.salary).toBe(6);

  const salaryFacts = factsSchema
    .parse(await (await request.get("/api/profile/facts")).json())
    .facts.filter((fact) => fact.key === "salary_expectation");

  expect(salaryFacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ scope: "CAD", value: "CAD 140,000 a year" }),
      expect.objectContaining({ scope: "USD", value: "USD 95,000 a year" }),
    ]),
  );

  const salaryReviews = reviewsSchema
    .parse(
      await (
        await request.get(`/__test__/reviews?userId=${encodeURIComponent(owner.userId)}`)
      ).json(),
    )
    .reviews.filter((review) => review.factKey === "salary_expectation");

  expect(salaryReviews).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        prompt: "What is your expected salary in USD?",
        status: "answered",
      }),
      expect.objectContaining({ prompt: "What is your expected salary in CAD?", status: "open" }),
    ]),
  );

  await request.dispose();
});

test("EEO answers are written only while the switch is on", async ({ onboardingServer }) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seeded(request, onboardingServer.url);

  const eeoFacts = async () =>
    factsSchema
      .parse(await (await request.get("/api/profile/facts")).json())
      .facts.filter((fact) => fact.key.startsWith("eeo_"));

  expect(await eeoFacts()).toEqual([]);

  await request.put("/api/onboarding/facts", {
    data: {
      eeo: {
        disability: "Prefer not to say",
        enabled: true,
        ethnicity: "Prefer not to say",
        gender: "Prefer not to say",
        veteran: "Prefer not to say",
      },
    },
  });

  expect(await eeoFacts()).toHaveLength(4);

  await request.put("/api/onboarding/facts", {
    data: {
      eeo: {
        disability: "Prefer not to say",
        enabled: false,
        ethnicity: "Prefer not to say",
        gender: "Prefer not to say",
        veteran: "Prefer not to say",
      },
    },
  });

  expect(await eeoFacts()).toEqual([]);

  await request.dispose();
});

test("the page saves as the answers change and hides a pill with nothing waiting", async ({
  onboardingServer,
  browser,
}) => {
  const request = await apiRequest.newContext({ baseURL: onboardingServer.url });

  await seeded(request, onboardingServer.url);

  const storageState = await request.storageState();

  await request.dispose();

  const context = await browser.newContext({
    storageState,
    viewport: { height: 1200, width: 1280 },
  });

  const page = await context.newPage();

  await page.goto(`${onboardingServer.url}/onboarding/facts`);

  await expect(page.getByText("Unlocks 31 queued jobs")).toBeVisible();

  await page.getByLabel("Work authorisation in United States").selectOption("Citizen");

  await expect(page.getByText("Unlocks 23 queued jobs")).toBeVisible();
  await expect(page.getByText("2 of 3 answered")).toBeVisible();

  await page.getByLabel("Work authorisation in Canada").selectOption("Citizen");
  await page.getByLabel("Work authorisation in United Kingdom").selectOption("Citizen");

  await expect(page.getByText("Unlocks 31 queued jobs")).toHaveCount(0);
  await expect(page.getByText("3 of 3 answered")).toBeVisible();

  await page.getByLabel("Current job title").fill("Staff Platform Engineer");
  await page.getByLabel("How did you hear about us? Optional").fill("A friend");
  await page.getByLabel("Salary expectation in USD").fill("95,000");

  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/onboarding\/targets$/u);
  await expect(page.getByRole("heading", { level: 2, name: /What do you want/u })).toBeVisible();

  await context.close();
});
