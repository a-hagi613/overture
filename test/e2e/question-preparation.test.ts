import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { FeedFixtureServer } from "./feed-fixture-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
import {
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{
  preparation: { anthropic: AnthropicFixtureServer; server: AppServer; feed: FeedFixtureServer };
}>({
  preparation: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();
      const feed = await startFeedFixtureServer();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        GREENHOUSE_FEED_BASE_URL: feed.url,
      });

      await provide({ anthropic, feed, server });
      await server.stop();
      feed.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
});

const applicationRowSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const reviewRowSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  prompt: z.string(),
  status: z.string(),
});

const reviewsSchema = z.object({
  reviews: z.array(reviewRowSchema),
  applications: z.array(z.object({ reviewId: z.string(), applicationId: z.string() })),
});

const reviewViewSchema = z.object({
  reviews: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      unlocked: z.number(),
    }),
  ),
  totalApplications: z.number(),
});

const factRowSchema = z.object({
  key: z.string(),
  value: z.string(),
  source: z.string(),
});

const factsSchema = z.object({ facts: z.array(factRowSchema) });

const questionsSchema = z.object({
  questions: z.array(
    z.object({
      questionId: z.string(),
      text: z.string(),
      fieldType: z.string(),
      factKey: z.string().nullable(),
      answerKind: z.string(),
      mappedBy: z.string().nullable(),
      required: z.boolean(),
    }),
  ),
});

async function seedQuestions(
  owner: APIRequestContext,
  input: {
    companyName: string;
    domain: string;
    boardToken: string;
    atsJobId: string;
    title: string;
    questions: {
      text: string;
      fieldType:
        | "text"
        | "textarea"
        | "select"
        | "multiselect"
        | "radio"
        | "checkbox"
        | "file"
        | "date"
        | "number"
        | "email"
        | "phone"
        | "url";
      options?: string[];
      required?: boolean;
      factKey?: string | null;
      answerKind?: "fact" | "open_text" | "consent" | "skip" | "unknown";
      mappedBy?: "rules" | "llm" | "owner" | null;
    }[];
  },
) {
  const companyId = await seedCompany(owner, input.companyName, input.domain);
  const boardId = await seedBoard(owner, companyId, "greenhouse", input.boardToken);

  return seedPosting(owner, {
    atsJobId: input.atsJobId,
    boardId,
    companyId,
    questions: input.questions,
    tags: [{ dimension: "subrole", value: "Backend" }],
    title: input.title,
    url: `https://${input.domain}/${input.atsJobId}`,
  });
}

async function seedRecordedPosting(
  owner: APIRequestContext,
  input: {
    companyName: string;
    domain: string;
    boardToken: string;
    atsJobId: string;
    title: string;
  },
) {
  const companyId = await seedCompany(owner, input.companyName, input.domain);
  const boardId = await seedBoard(owner, companyId, "greenhouse", input.boardToken);

  return seedPosting(owner, {
    atsJobId: input.atsJobId,
    boardId,
    companyId,
    tags: [{ dimension: "subrole", value: "Backend" }],
    title: input.title,
    url: `https://${input.domain}/${input.atsJobId}`,
  });
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

async function prepare(owner: APIRequestContext, applicationId: string) {
  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`);

  return applicationsSchema.parse(await response.json()).applications;
}

async function reviewsFor(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/reviews?userId=${encodeURIComponent(userId)}`);

  return reviewsSchema.parse(await response.json());
}

async function questionsFor(owner: APIRequestContext, userId: string, postingId: string) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  return questionsSchema.parse(await response.json()).questions;
}

async function factsFor(owner: APIRequestContext) {
  return factsSchema.parse(await (await owner.get("/api/profile/facts")).json()).facts;
}

test("an Application whose Facts answer every required question reaches ready", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await owner.put("/api/profile/facts", {
    data: {
      facts: [
        { key: "legal_name", value: "Maya Okafor" },
        { key: "email", value: "maya.okafor@mail.overture.test" },
        { key: "phone", value: "+1 416 555 0199" },
        { key: "work_auth", value: "Yes" },
      ],
    },
  });

  const postingId = await seedQuestions(owner, {
    atsJobId: "ready-1",
    boardToken: "ready-co",
    companyName: "Ready Co",
    domain: "ready.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "legal_name",
        fieldType: "text",
        required: true,
        text: "First Name",
      },
      {
        answerKind: "fact",
        factKey: "legal_name",
        fieldType: "text",
        required: true,
        text: "Last Name",
      },
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      { answerKind: "fact", factKey: "phone", fieldType: "phone", required: true, text: "Phone" },
      {
        answerKind: "fact",
        factKey: "work_auth",
        fieldType: "select",
        options: ["Yes", "No"],
        required: true,
        text: "Are you authorized to work in Canada?",
      },
    ],
    title: "Senior Backend Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const application = (await applicationsFor(owner, userId)).find(
    (row) => row.id === applicationId,
  );

  expect(application?.status).toBe("ready");
  expect(
    (await reviewsFor(owner, userId)).reviews.filter((candidate) => candidate.status === "open"),
  ).toEqual([]);
});

test("one Review unlocks every Application waiting on its question", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const question = {
    answerKind: "unknown" as const,
    fieldType: "text" as const,
    required: true,
    text: "What is your notice period with your current employer?",
  };

  const firstPosting = await seedQuestions(owner, {
    atsJobId: "unlock-1",
    boardToken: "northwind",
    companyName: "Northwind Labs",
    domain: "northwind.example",
    questions: [question],
    title: "Platform Engineer",
  });

  const secondPosting = await seedQuestions(owner, {
    atsJobId: "unlock-2",
    boardToken: "ferro",
    companyName: "Ferro Cloud",
    domain: "ferro.example",
    questions: [question],
    title: "Senior DevOps Engineer",
  });

  const firstApplication = await seedApplication(owner, {
    postingId: firstPosting,
    status: "preparing",
    userId,
  });

  const secondApplication = await seedApplication(owner, {
    postingId: secondPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, firstApplication);
  await prepare(owner, secondApplication);

  let rows = await applicationsFor(owner, userId);

  expect(rows.find((row) => row.id === firstApplication)?.status).toBe("needs_review");
  expect(rows.find((row) => row.id === secondApplication)?.status).toBe("needs_review");

  const open = await reviewsFor(owner, userId);

  expect(open.reviews).toHaveLength(1);

  const [review] = open.reviews;

  if (review === undefined) {
    throw new Error("no Review was opened");
  }

  expect(open.applications.filter((attachment) => attachment.reviewId === review.id)).toHaveLength(
    2,
  );

  const answered = await owner.post(`/api/reviews/${review.id}/answer`, {
    data: { value: "Four weeks" },
  });

  expect(answered.ok()).toBe(true);

  rows = await applicationsFor(owner, userId);

  expect(rows.find((row) => row.id === firstApplication)?.status).toBe("ready");
  expect(rows.find((row) => row.id === secondApplication)?.status).toBe("ready");

  const facts = await factsFor(owner);

  expect(facts.find((fact) => fact.key === `q:${review.questionId}`)).toMatchObject({
    source: "review",
    value: "Four weeks",
  });

  const remaining = reviewViewSchema.parse(await (await owner.get("/api/reviews")).json());

  expect(remaining.totalApplications).toBe(0);
});

test("dismissing a Review skips every Application waiting on it", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const question = {
    answerKind: "unknown" as const,
    fieldType: "text" as const,
    required: true,
    text: "Are you willing to obtain a security clearance?",
  };

  const postings = await Promise.all(
    [
      {
        companyName: "Halden Systems",
        domain: "halden.example",
        token: "halden",
        title: "Site Reliability Engineer",
      },
      {
        companyName: "Larkspur Health",
        domain: "larkspur.example",
        token: "larkspur",
        title: "Platform Engineer",
      },
    ].map(async (company, index) =>
      seedQuestions(owner, {
        atsJobId: `dismiss-${String(index)}`,
        boardToken: company.token,
        companyName: company.companyName,
        domain: company.domain,
        questions: [question],
        title: company.title,
      }),
    ),
  );

  const applicationIds = await Promise.all(
    postings.map(async (postingId) =>
      seedApplication(owner, { postingId, status: "preparing", userId }),
    ),
  );

  await Promise.all(applicationIds.map(async (applicationId) => prepare(owner, applicationId)));

  const open = await reviewsFor(owner, userId);
  const [review] = open.reviews;

  if (review === undefined) {
    throw new Error("no Review was opened");
  }

  const dismissed = await owner.post(`/api/reviews/${review.id}/dismiss`, { data: {} });

  expect(dismissed.ok()).toBe(true);

  const rows = await applicationsFor(owner, userId);

  for (const applicationId of applicationIds) {
    const row = rows.find((candidate) => candidate.id === applicationId);

    expect(row?.status).toBe("skipped");
    expect(row?.statusReason).toBe("review_dismissed");
  }

  expect(
    (await reviewsFor(owner, userId)).reviews.filter((candidate) => candidate.status === "open"),
  ).toEqual([]);
});

test("an unknown optional question stays blank and never blocks", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await owner.put("/api/profile/facts", {
    data: { facts: [{ key: "email", value: "maya.okafor@mail.overture.test" }] },
  });

  const postingId = await seedQuestions(owner, {
    atsJobId: "optional-1",
    boardToken: "optional-co",
    companyName: "Optional Co",
    domain: "optional.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      {
        answerKind: "unknown",
        fieldType: "text",
        required: false,
        text: "Favourite programming language?",
      },
    ],
    title: "Backend Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const application = (await applicationsFor(owner, userId)).find(
    (row) => row.id === applicationId,
  );

  expect(application?.status).toBe("ready");
  expect(
    (await reviewsFor(owner, userId)).reviews.filter((candidate) => candidate.status === "open"),
  ).toEqual([]);
});

test("Greenhouse questions are read only when an Application is prepared", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "5999792004",
    boardToken: "vercel",
    companyName: "Vercel",
    domain: "vercel.example",
    title: "Senior Frontend Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  expect(preparation.feed.stats().questionsRequests).toBe(1);

  const questions = await questionsFor(owner, userId, postingId);
  const byText = new Map(questions.map((question) => [question.text, question]));

  expect(byText.get("Email")).toMatchObject({
    answerKind: "fact",
    factKey: "email",
    mappedBy: "rules",
  });
  expect(byText.get("First Name")).toMatchObject({
    answerKind: "fact",
    factKey: "legal_name",
    mappedBy: "rules",
  });
  expect(byText.get("Will you require Visa Sponsorship now, or in the future?")).toMatchObject({
    answerKind: "fact",
    factKey: "sponsorship_required",
    mappedBy: "rules",
  });

  const application = (await applicationsFor(owner, userId)).find(
    (row) => row.id === applicationId,
  );

  expect(application?.status).toBe("needs_review");

  await prepare(owner, applicationId);

  expect(preparation.feed.stats().questionsRequests).toBe(1);

  await runJob(owner, "catalog.backfill", "{}");

  expect(preparation.feed.stats().questionsRequests).toBe(1);
});

test("Haiku maps a question that no rule covers", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "8332467",
    boardToken: "stripe",
    companyName: "Stripe",
    domain: "stripe.example",
    title: "Backend Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const question = (await questionsFor(owner, userId, postingId)).find((candidate) =>
    candidate.text.startsWith("Please select the country or countries you anticipate working in"),
  );

  expect(question).toMatchObject({
    answerKind: "fact",
    factKey: "current_country",
    mappedBy: "llm",
  });

  expect(
    preparation.anthropic
      .requests()
      .some((request) => request.title.includes("country or countries you anticipate working in")),
  ).toBe(true);
});
