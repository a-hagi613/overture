import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";

import { authTestIdentity } from "./auth.fixture.ts";
import { latestMailLink, requestMagicLink, verifyAuthState } from "./sign-in.ts";

const createdSchema = z.object({ id: z.string() });

const targets = {
  roles: ["Platform Engineer", "Senior Backend Engineer", "DevOps Engineer"],
  seniorities: ["senior", "staff"],
  workplaces: ["remote", "hybrid"],
  locations: ["Toronto, ON", "Vancouver, BC", "Austin, TX", "London, UK"],
  employmentTypes: ["full_time"],
  salaryFloorMinor: 14_000_000,
  salaryCurrency: "CAD",
  salaryPeriod: "year",
};

const facts = [
  { key: "current_job_title", scope: "", value: "Platform Engineer" },
  { key: "work_auth", scope: "CA", value: "Permanent resident" },
  { key: "salary_expectation", scope: "CAD", value: "CAD 140,000 a year" },
];

interface ReviewSeed {
  applicationIds: string[];
  factKey: string;
  options?: string[];
  prompt: string;
  scope?: string;
  fieldType?: "select" | "text";
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
  await request.put("/api/profile/facts", { data: { facts } });

  const state = await verifyAuthState(appServerUrl, request);
  const owner = state.users.find((user) => user.email === authTestIdentity.ownerEmail);

  if (owner === undefined) {
    throw new Error("the owner was not created");
  }

  return owner.id;
}

interface SeedRequest {
  [field: string]: string | number | null | SeedRequest | (string | number | SeedRequest)[];
}

async function created(request: APIRequestContext, path: string, data: SeedRequest) {
  const response = await request.post(path, { data });

  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }

  return createdSchema.parse(await response.json()).id;
}

async function seedCompany(request: APIRequestContext) {
  const companyId = await created(request, "/__test__/catalog/companies", {
    domain: "onboarding-seed.example",
    name: "Onboarding Seed Co",
  });

  const boardId = await created(request, "/__test__/catalog/boards", {
    ats: "greenhouse",
    boardToken: "onboarding-seed",
    companyId,
  });

  return { boardId, companyId };
}

async function seedPosting(
  request: APIRequestContext,
  board: { boardId: string; companyId: string },
  index: number,
  salaryCurrency: string | null,
) {
  return created(request, "/__test__/catalog/postings", {
    ats: "greenhouse",
    atsJobId: `onboarding-${String(index)}`,
    boardId: board.boardId,
    companyId: board.companyId,
    city: "Toronto",
    countryCode: "CA",
    employmentType: "full_time",
    language: "en",
    locationRaw: "Toronto, Ontario, Canada",
    salaryCurrency,
    salaryPeriod: salaryCurrency === null ? null : "year",
    title: "Platform Engineer",
    url: `https://onboarding-seed.example/${String(index)}`,
    workplace: "hybrid",
  });
}

export function startAtsStub() {
  const server = Bun.serve({
    fetch: () => new Response("not found", { status: 404 }),
    port: 0,
  });

  return {
    close: () => {
      void server.stop(true);
    },
    url: `http://127.0.0.1:${String(server.port)}`,
  };
}

export async function seedOnboardingBoard(request: APIRequestContext, appServerUrl: string) {
  const userId = await seedOwner(request, appServerUrl);
  const board = await seedCompany(request);

  const currencies: (string | null)[] = [];

  for (let index = 0; index < 77; index += 1) {
    if (index < 6) {
      currencies.push("CAD");
    } else if (index < 9) {
      currencies.push("USD");
    } else {
      currencies.push(null);
    }
  }

  const postingIds = await Promise.all(
    currencies.map(async (currency, index) => seedPosting(request, board, index, currency)),
  );

  const applicationIds = await Promise.all(
    postingIds.map(async (postingId, index) =>
      created(request, "/__test__/applications/seed", {
        boardPosition: index,
        createdAt: index + 1,
        origin: "auto",
        postingId,
        sentAt: null,
        stage: "queued",
        status: "needs_review",
        userId,
      }),
    ),
  );

  let cursor = 0;

  const take = (count: number) => {
    const ids = applicationIds.slice(cursor, cursor + count);

    cursor += count;

    return ids;
  };

  const reviewSeeds: ReviewSeed[] = [
    {
      applicationIds: take(14),
      factKey: "current_job_title",
      prompt: "What is your current or previous job title?",
    },
    {
      applicationIds: take(20),
      factKey: "work_auth",
      options: ["Citizen", "Permanent resident", "Work permit", "Need sponsorship"],
      prompt: "Are you legally authorised to work in Canada?",
      scope: "CA",
    },
    {
      applicationIds: take(8),
      factKey: "work_auth",
      options: ["Citizen", "Permanent resident", "Work permit", "Need sponsorship"],
      prompt: "Are you legally authorised to work in the United States?",
      scope: "US",
    },
    {
      applicationIds: take(3),
      factKey: "work_auth",
      options: ["Citizen", "Permanent resident", "Work permit", "Need sponsorship"],
      prompt: "Are you legally authorised to work in the United Kingdom?",
      scope: "GB",
    },
    {
      applicationIds: take(6),
      factKey: "salary_expectation",
      prompt: "What is your expected salary in CAD?",
    },
    {
      applicationIds: take(3),
      factKey: "salary_expectation",
      prompt: "What is your expected salary in USD?",
    },
    {
      applicationIds: take(14),
      factKey: "how_did_you_hear",
      prompt: "How did you hear about us?",
    },
    { applicationIds: take(3), factKey: "eeo_gender", prompt: "Gender" },
    { applicationIds: take(2), factKey: "eeo_race_ethnicity", prompt: "Race and ethnicity" },
    { applicationIds: take(2), factKey: "eeo_veteran", prompt: "Veteran status" },
    { applicationIds: take(2), factKey: "eeo_disability", prompt: "Disability status" },
  ];

  await Promise.all(
    reviewSeeds.map(async (seed) => {
      const response = await request.post("/__test__/reviews/seed", {
        data: {
          applicationIds: seed.applicationIds,
          fieldType: seed.fieldType ?? "text",
          options: seed.options ?? [],
          factKey: seed.factKey,
          prompt: seed.prompt,
          scope: seed.scope ?? "",
          userId,
        },
      });

      if (!response.ok()) {
        throw new Error(
          `review seed failed: ${String(response.status())} ${await response.text()}`,
        );
      }
    }),
  );

  return { applicationIds, userId };
}
