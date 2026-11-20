import { readFileSync } from "node:fs";

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
  scope: z.string(),
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
      scope: z.string(),
      factLabel: z.string().nullable(),
      unlocked: z.number(),
    }),
  ),
  totalApplications: z.number(),
});

const factRowSchema = z.object({
  key: z.string(),
  scope: z.string(),
  value: z.string(),
  source: z.string(),
});

const factsSchema = z.object({ facts: z.array(factRowSchema) });

const answersSchema = z.object({
  answers: z.array(
    z.object({
      text: z.string(),
      factKey: z.string().nullable(),
      scope: z.string(),
      answerKind: z.string(),
      resolved: z.boolean(),
      answer: z.string().nullable(),
    }),
  ),
});

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

async function answersFor(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/prepared-answers?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return answersSchema.parse(await response.json()).answers;
}

async function uploadResume(owner: APIRequestContext) {
  const response = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(response.ok()).toBe(true);
}

async function factsFor(owner: APIRequestContext) {
  return factsSchema.parse(await (await owner.get("/api/profile/facts")).json()).facts;
}

async function saveFacts(
  owner: APIRequestContext,
  facts: { key: string; value: string; scope?: string }[],
) {
  const response = await owner.put("/api/profile/facts", { data: { facts } });

  expect(response.ok()).toBe(true);
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
        { key: "work_auth", scope: "CA", value: "Yes" },
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

test("a required standard consent resolves with a built answer", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await owner.put("/api/profile/facts", {
    data: { facts: [{ key: "email", value: "maya.okafor@mail.overture.test" }] },
  });

  const postingId = await seedQuestions(owner, {
    atsJobId: "consent-ok-1",
    boardToken: "consent-ok",
    companyName: "Consent Co",
    domain: "consent.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      {
        answerKind: "consent",
        fieldType: "select",
        options: ["Acknowledge/Confirm"],
        required: true,
        text: "Please review and acknowledge our privacy notice.",
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

  const consent = (await answersFor(owner, applicationId)).find((answer) =>
    answer.text.startsWith("Please review and acknowledge"),
  );

  expect(consent).toMatchObject({ answer: "Acknowledge/Confirm", resolved: true });
});

test("a required non-standard consent skips the Application with a reason", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedQuestions(owner, {
    atsJobId: "consent-bad-1",
    boardToken: "consent-bad",
    companyName: "Consent Bad Co",
    domain: "consent-bad.example",
    questions: [
      {
        answerKind: "consent",
        fieldType: "select",
        options: ["Yes", "No"],
        required: true,
        text: "Do you consent to a background check?",
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

  expect(application?.status).toBe("skipped");
  expect(application?.statusReason).toBe("form_unsupported");
  expect((await reviewsFor(owner, userId)).reviews).toEqual([]);
});

test("a required skip-mapped field skips the Application", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedQuestions(owner, {
    atsJobId: "skip-required-1",
    boardToken: "skip-required",
    companyName: "Skip Required Co",
    domain: "skip-required.example",
    questions: [
      {
        answerKind: "skip",
        fieldType: "select",
        options: ["Yes", "No"],
        required: true,
        text: "Would you like to opt in to our newsletter?",
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

  expect(application?.status).toBe("skipped");
  expect(application?.statusReason).toBe("form_unsupported");
});

test("a required non-resume file field skips the Application even with a resume", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);
  await owner.put("/api/profile/facts", {
    data: { facts: [{ key: "email", value: "maya.okafor@mail.overture.test" }] },
  });

  const postingId = await seedQuestions(owner, {
    atsJobId: "file-required-1",
    boardToken: "file-required",
    companyName: "File Required Co",
    domain: "file-required.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      {
        answerKind: "unknown",
        fieldType: "file",
        required: true,
        text: "Portfolio PDF",
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

  expect(application?.status).toBe("skipped");
  expect(application?.statusReason).toBe("form_unsupported");
});

test("a required resume file resolves once a resume is uploaded", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const withoutResume = await seedQuestions(owner, {
    atsJobId: "resume-required-1",
    boardToken: "resume-required",
    companyName: "Resume Required Co",
    domain: "resume-required.example",
    questions: [{ answerKind: "unknown", fieldType: "file", required: true, text: "Resume/CV" }],
    title: "Backend Engineer",
  });

  const missing = await seedApplication(owner, {
    postingId: withoutResume,
    status: "preparing",
    userId,
  });

  await prepare(owner, missing);

  expect((await applicationsFor(owner, userId)).find((row) => row.id === missing)?.status).toBe(
    "skipped",
  );

  await uploadResume(owner);

  const withResume = await seedQuestions(owner, {
    atsJobId: "resume-required-2",
    boardToken: "resume-uploaded",
    companyName: "Resume Uploaded Co",
    domain: "resume-uploaded.example",
    questions: [{ answerKind: "unknown", fieldType: "file", required: true, text: "Resume/CV" }],
    title: "Backend Engineer",
  });

  const readyApplication = await seedApplication(owner, {
    postingId: withResume,
    status: "preparing",
    userId,
  });

  await prepare(owner, readyApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === readyApplication)?.status,
  ).toBe("ready");
});

test("a recorded form with a required file field does not reach ready without a resume", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "8392878",
    boardToken: "cloudflare",
    companyName: "Cloudflare",
    domain: "cloudflare.example",
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

  expect(application?.status).not.toBe("ready");

  const resume = (await answersFor(owner, applicationId)).find((answer) =>
    answer.text.startsWith("Resume/CV"),
  );

  expect(resume).toMatchObject({ answer: null, resolved: false });
});

test("a recorded form's standard consent carries a built value but the form is not ready", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "8392878",
    boardToken: "cloudflare",
    companyName: "Cloudflare",
    domain: "cloudflare.example",
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

  expect(application?.status).not.toBe("ready");

  const answers = await answersFor(owner, applicationId);
  const consent = answers.find((answer) => answer.text.startsWith("Please review and acknowledge"));

  expect(consent).toMatchObject({
    answerKind: "consent",
    resolved: true,
  });
  expect(consent?.answer).not.toBeNull();
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

test("a country's work authorisation never answers another country's question", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_country", value: "Canada" },
    { key: "work_auth", scope: "CA", value: "Yes" },
    { key: "sponsorship_required", scope: "CA", value: "No" },
  ]);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "5999792004",
    boardToken: "vercel",
    companyName: "Vercel",
    domain: "vercel.example",
    title: "Account Executive, Majors",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const question = "Are you authorized to work in the UK?";

  const before = (await answersFor(owner, applicationId)).find((answer) =>
    answer.text.startsWith(question),
  );

  expect(before).toMatchObject({ answer: null, factKey: "work_auth", resolved: false });

  const open = await reviewsFor(owner, userId);
  const review = open.reviews.find((candidate) => candidate.prompt.startsWith(question));

  if (review === undefined) {
    throw new Error("no Review was opened for the UK question");
  }

  expect(review.scope).toBe("GB");

  const views = reviewViewSchema.parse(await (await owner.get("/api/reviews")).json());
  const view = views.reviews.find((candidate) => candidate.id === review.id);

  expect(view).toMatchObject({
    factLabel: "Work authorisation (United Kingdom)",
    scope: "GB",
  });

  const authorised = "I am authorized to work in the country due to my nationality";

  const answered = await owner.post(`/api/reviews/${review.id}/answer`, {
    data: { value: authorised },
  });

  expect(answered.ok()).toBe(true);

  const facts = await factsFor(owner);

  const after = (await answersFor(owner, applicationId)).find((answer) =>
    answer.text.startsWith(question),
  );

  expect(after).toMatchObject({ answer: authorised, resolved: true, scope: "GB" });

  expect(facts.find((fact) => fact.key === "work_auth" && fact.scope === "GB")).toMatchObject({
    source: "review",
    value: authorised,
  });
  expect(facts.find((fact) => fact.key === "work_auth" && fact.scope === "CA")).toMatchObject({
    source: "user",
    value: "Yes",
  });
});

test("an unscoped work authorisation does not answer a question naming a country", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "current_country", value: "Canada" },
    { key: "work_auth", value: "Yes" },
  ]);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "5999792004",
    boardToken: "vercel",
    companyName: "Vercel",
    domain: "vercel.example",
    title: "Account Executive, Majors",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const question = "Are you authorized to work in the UK?";

  const answer = (await answersFor(owner, applicationId)).find((candidate) =>
    candidate.text.startsWith(question),
  );

  expect(answer).toMatchObject({ answer: null, resolved: false });

  const review = (await reviewsFor(owner, userId)).reviews.find((candidate) =>
    candidate.prompt.startsWith(question),
  );

  expect(review?.scope).toBe("GB");
});

test("a question about the country where the user lives uses that country's Fact", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "current_country", value: "Canada" },
    { key: "work_auth", scope: "CA", value: "Yes" },
    { key: "work_auth", scope: "GB", value: "No" },
    { key: "sponsorship_required", scope: "CA", value: "No" },
    { key: "sponsorship_required", scope: "GB", value: "Yes" },
  ]);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "8332467",
    boardToken: "stripe",
    companyName: "Stripe",
    domain: "stripe.example",
    title: "Account Executive, AI Sales",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const answers = await answersFor(owner, applicationId);

  const workAuth = answers.find((answer) =>
    answer.text.startsWith("Are you authorized to work in the location(s)"),
  );

  expect(workAuth).toMatchObject({ answer: "Yes", resolved: true, scope: "CA" });

  const sponsorship = answers.find((answer) =>
    answer.text.startsWith("Will you require Stripe to sponsor you"),
  );

  expect(sponsorship).toMatchObject({ answer: "No", resolved: true, scope: "CA" });
});

test("a question naming no country opens a Review when scoped Facts disagree", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "current_country", value: "Canada" },
    { key: "sponsorship_required", scope: "CA", value: "No" },
    { key: "sponsorship_required", scope: "GB", value: "Yes" },
  ]);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "5999792004",
    boardToken: "vercel",
    companyName: "Vercel",
    domain: "vercel.example",
    title: "Account Executive, Majors",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const question = "Will you require Visa Sponsorship now, or in the future?";

  const answer = (await answersFor(owner, applicationId)).find((candidate) =>
    candidate.text.startsWith(question),
  );

  expect(answer).toMatchObject({ answer: null, resolved: false, scope: "" });

  const review = (await reviewsFor(owner, userId)).reviews.find((candidate) =>
    candidate.prompt.startsWith(question),
  );

  expect(review?.scope).toBe("");
});
