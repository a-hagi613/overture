import { readFileSync } from "node:fs";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { FeedFixtureServer } from "./feed-fixture-server.ts";
import type { SeedQuestion } from "./recorded-questions.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
import { recordedQuestions } from "./recorded-questions.ts";
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
  readyAt: z.number().nullable(),
  stage: z.string().nullable(),
  status: z.string(),
  statusReason: z.string().nullable(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const reviewRowSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  prompt: z.string(),
  scope: z.string(),
  reason: z.string(),
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
      saveForFutureDefault: z.boolean(),
    }),
  ),
  totalApplications: z.number(),
});

const answerResultSchema = z.object({
  applicationIds: z.array(z.string()),
  readyCount: z.number(),
  saveForFuture: z.boolean(),
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
      required: z.boolean(),
      resolved: z.boolean(),
      source: z.string().nullable(),
      answer: z.string().nullable(),
      file: z.string().nullable(),
      unit: z.object({ currency: z.string().nullable(), period: z.string().nullable() }).nullable(),
      factRevision: z.number().nullable(),
      block: z.string().nullable(),
      reason: z.string().nullable(),
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
    companyId?: string;
    boardId?: string;
    countryCode?: string | null;
    region?: string | null;
    city?: string | null;
    locationRaw?: string;
    workplace?: "remote" | "hybrid" | "onsite" | "unknown";
    questions?: SeedQuestion[];
  },
) {
  const companyId = input.companyId ?? (await seedCompany(owner, input.companyName, input.domain));

  const boardId =
    input.boardId ?? (await seedBoard(owner, companyId, "greenhouse", input.boardToken));

  return seedPosting(owner, {
    atsJobId: input.atsJobId,
    boardId,
    city: input.city ?? null,
    companyId,
    countryCode: input.countryCode === undefined ? "CA" : input.countryCode,
    locationRaw: input.locationRaw ?? "Remote, Canada",
    questions: input.questions ?? [],
    region: input.region ?? null,
    tags: [{ dimension: "subrole", value: "Backend" }],
    title: input.title,
    url: `https://${input.domain}/${input.atsJobId}`,
    workplace: input.workplace ?? "remote",
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
  expect(application?.stage).toBe("ready");
  expect(application?.readyAt).not.toBeNull();
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
  expect(rows.find((row) => row.id === firstApplication)?.stage).toBe("queued");
  expect(rows.find((row) => row.id === firstApplication)?.readyAt).toBeNull();
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

test("an answer saved for these Applications only leaves global facts untouched", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const question = {
    answerKind: "unknown" as const,
    fieldType: "text" as const,
    required: true,
    text: "Why do you want to work at this company?",
  };

  const firstPosting = await seedQuestions(owner, {
    atsJobId: "scoped-1",
    boardToken: "northwind",
    companyName: "Northwind Labs",
    domain: "northwind.example",
    questions: [question],
    title: "Platform Engineer",
  });

  const secondPosting = await seedQuestions(owner, {
    atsJobId: "scoped-2",
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

  const [review] = (await reviewsFor(owner, userId)).reviews;

  if (review === undefined) {
    throw new Error("no Review was opened");
  }

  expect(review.prompt).toBe(question.text);

  const answered = await owner.post(`/api/reviews/${review.id}/answer`, {
    data: { saveForFuture: false, value: "I have used your platform for years." },
  });

  expect(answered.ok()).toBe(true);

  const result = answerResultSchema.parse(await answered.json());

  expect(result).toMatchObject({ readyCount: 2, saveForFuture: false });

  const rows = await applicationsFor(owner, userId);

  expect(rows.find((row) => row.id === firstApplication)?.status).toBe("ready");
  expect(rows.find((row) => row.id === secondApplication)?.status).toBe("ready");

  const facts = await factsFor(owner);

  expect(facts.find((fact) => fact.key === `q:${review.questionId}`)).toBeUndefined();

  const thirdPosting = await seedQuestions(owner, {
    atsJobId: "scoped-3",
    boardToken: "larkspur",
    companyName: "Larkspur Health",
    domain: "larkspur.example",
    questions: [question],
    title: "Infrastructure Engineer",
  });

  const thirdApplication = await seedApplication(owner, {
    postingId: thirdPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, thirdApplication);

  const reopened = await reviewsFor(owner, userId);

  expect(
    reopened.reviews.filter(
      (candidate) => candidate.prompt === question.text && candidate.status === "open",
    ),
  ).toHaveLength(1);
  expect(reopened.applications.some((row) => row.applicationId === thirdApplication)).toBe(true);
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

  const portfolio = (await answersFor(owner, applicationId)).find(
    (answer) => answer.text === "Portfolio PDF",
  );

  expect(portfolio).toMatchObject({
    answer: null,
    block: "unsupported_field",
    file: null,
    resolved: false,
  });
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
  expect(
    (await answersFor(owner, missing)).find((answer) => answer.text === "Resume/CV"),
  ).toMatchObject({ answer: null, block: "file_unavailable", file: "resume", resolved: false });

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
  expect(
    (await answersFor(owner, readyApplication)).find((answer) => answer.text === "Resume/CV"),
  ).toMatchObject({ answer: null, file: "resume", resolved: true, source: "file" });
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

test("the rules answer the recorded job title, so Haiku is not asked", async ({ preparation }) => {
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
    candidate.text.startsWith("What is your current or previous job title?"),
  );

  expect(question).toMatchObject({
    answerKind: "fact",
    factKey: "current_job_title",
    mappedBy: "rules",
  });

  expect(
    preparation.anthropic
      .requests()
      .some((request) => request.title.includes("current or previous job title")),
  ).toBe(false);
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

test("a question that names the company but no country uses the posting's country", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_country", value: "Canada" },
    { key: "sponsorship_required", scope: "CA", value: "No" },
    { key: "sponsorship_required", scope: "US", value: "Yes" },
  ]);

  const postingId = await seedRecordedPosting(owner, {
    atsJobId: "8097321",
    boardToken: "cloudflare",
    companyName: "Cloudflare",
    countryCode: "US",
    domain: "cloudflare.example",
    locationRaw: "Austin, TX",
    title: "AI Security Research & Red Team Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  const question =
    "Do you now or will you in the future require immigration sponsorship to work at Cloudflare?";

  const answer = (await answersFor(owner, applicationId)).find(
    (candidate) => candidate.text === question,
  );

  expect(answer).toMatchObject({ answer: "Yes", resolved: true, scope: "US" });

  const review = (await reviewsFor(owner, userId)).reviews.find((candidate) =>
    candidate.prompt.startsWith(question),
  );

  expect(review).toBeUndefined();
});

test("a recorded five-option work-authorisation select resolves from the scoped Fact", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_country", value: "UK" },
    { key: "work_auth", scope: "GB", value: "Citizen" },
    { key: "sponsorship_required", scope: "GB", value: "No" },
  ]);

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

  const answers = await answersFor(owner, applicationId);

  expect(
    answers.find((answer) => answer.text === "Are you authorized to work in the UK?"),
  ).toMatchObject({
    resolved: true,
    answer: "I am authorized to work in the country due to my nationality",
    scope: "GB",
  });

  expect(
    answers.find((answer) =>
      answer.text.startsWith("Are you currently based in any of these countries"),
    ),
  ).toMatchObject({ resolved: true, answer: "United Kingdom" });
});

test("a scoped Fact with no matching option opens a Review with the option_missing reason", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_country", value: "UK" },
    { key: "work_auth", scope: "GB", value: "Permanent resident" },
    { key: "sponsorship_required", scope: "GB", value: "No" },
  ]);

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

  const review = (await reviewsFor(owner, userId)).reviews.find((candidate) =>
    candidate.prompt.startsWith("Are you authorized to work in the UK?"),
  );

  expect(review).toMatchObject({ status: "open", reason: "option_missing", scope: "GB" });
});

test("the recorded Greenhouse forms lose the derivable Review families", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);

  await saveFacts(owner, [
    { key: "legal_name", value: "Maya Okafor" },
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "phone", value: "+1 416 555 0199" },
    { key: "current_city", value: "Toronto" },
    { key: "current_country", value: "Canada" },
    { key: "work_auth", scope: "CA", value: "Citizen" },
    { key: "sponsorship_required", scope: "CA", value: "No" },
    { key: "willing_relocate", value: "Yes" },
    { key: "employment_history", value: "Brightwave Analytics, 2020-2024" },
    { key: "current_employer", value: "Brightwave Analytics" },
  ]);

  const targets = await owner.put("/api/profile/targets", {
    data: {
      employmentTypes: ["full_time"],
      locations: ["city:ca:toronto", "country:us", "country:gb", "country:de", "country:au"],
      roles: ["Backend"],
      salaryCurrency: null,
      salaryFloorMinor: null,
      salaryPeriod: "year",
      seniorities: ["senior"],
      workplaces: ["remote", "hybrid", "onsite"],
    },
  });

  expect(targets.ok()).toBe(true);

  const cloudflare = {
    boardToken: "cloudflare",
    companyName: "Cloudflare",
    domain: "cloudflare.example",
  };

  const stripe = { boardToken: "stripe", companyName: "Stripe", domain: "stripe.example" };

  const vercel = { boardToken: "vercel", companyName: "Vercel", domain: "vercel.example" };

  const cloudflareId = await seedCompany(owner, cloudflare.companyName, cloudflare.domain);
  const stripeId = await seedCompany(owner, stripe.companyName, stripe.domain);
  const vercelId = await seedCompany(owner, vercel.companyName, vercel.domain);

  const cloudflareBoard = await seedBoard(owner, cloudflareId, "greenhouse", "cloudflare");
  const stripeBoard = await seedBoard(owner, stripeId, "greenhouse", "stripe");
  const vercelBoard = await seedBoard(owner, vercelId, "greenhouse", "vercel");

  const postings = [
    {
      ...cloudflare,
      atsJobId: "8097321",
      boardId: cloudflareBoard,
      city: null,
      companyId: cloudflareId,
      countryCode: null,
      locationRaw: "Hybrid",
      title: "AI Security Research & Red Team Engineer",
      workplace: "hybrid" as const,
    },
    {
      ...cloudflare,
      atsJobId: "8287256",
      boardId: cloudflareBoard,
      city: null,
      companyId: cloudflareId,
      countryCode: null,
      locationRaw: "Hybrid",
      title: "Associate, Strategic Finance & Investor Relations",
      workplace: "hybrid" as const,
    },
    {
      ...cloudflare,
      atsJobId: "8392878",
      boardId: cloudflareBoard,
      city: null,
      companyId: cloudflareId,
      countryCode: null,
      locationRaw: "Hybrid",
      title: "Account Executive, Start Ups",
      workplace: "hybrid" as const,
    },
    {
      ...cloudflare,
      atsJobId: "7695702",
      boardId: cloudflareBoard,
      city: null,
      companyId: cloudflareId,
      countryCode: null,
      locationRaw: "Hybrid",
      title: "Account Executive, FedCiv",
      workplace: "hybrid" as const,
    },
    {
      ...stripe,
      atsJobId: "8138044",
      boardId: stripeBoard,
      city: "San Francisco",
      companyId: stripeId,
      countryCode: "US",
      locationRaw: "San Francisco, CA",
      region: "California",
      title: "Account Executive, AI Sales",
      workplace: "onsite" as const,
    },
    {
      ...stripe,
      atsJobId: "8332467",
      boardId: stripeBoard,
      city: "San Francisco",
      companyId: stripeId,
      countryCode: "US",
      locationRaw: "San Francisco, CA",
      region: "California",
      title: "Account Executive, AI Sales",
      workplace: "onsite" as const,
    },
    {
      ...stripe,
      atsJobId: "8172510",
      boardId: stripeBoard,
      city: "Seattle",
      companyId: stripeId,
      countryCode: "US",
      locationRaw: "Seattle, San Francisco, New York City",
      region: "Washington",
      title: "Abuse Investigator",
      workplace: "hybrid" as const,
    },
    {
      ...stripe,
      atsJobId: "8238731",
      boardId: stripeBoard,
      city: "San Francisco",
      companyId: stripeId,
      countryCode: "US",
      locationRaw: "San Francisco, CA",
      region: "California",
      title: "Account Executive, AI Startups - Grower",
      workplace: "onsite" as const,
    },
    {
      ...vercel,
      atsJobId: "5841911004",
      boardId: vercelBoard,
      city: "Sydney",
      companyId: vercelId,
      countryCode: "AU",
      locationRaw: "Hybrid - Sydney",
      region: "New South Wales",
      title: "Account Executive, Majors (APAC)",
      workplace: "hybrid" as const,
    },
    {
      ...vercel,
      atsJobId: "6100103004",
      boardId: vercelBoard,
      city: "Sydney",
      companyId: vercelId,
      countryCode: "AU",
      locationRaw: "Hybrid - Sydney",
      region: "New South Wales",
      title: "Account Executive, Majors- Install Base (APAC)",
      workplace: "hybrid" as const,
    },
    {
      ...vercel,
      atsJobId: "5999792004",
      boardId: vercelBoard,
      city: "London",
      companyId: vercelId,
      countryCode: "GB",
      locationRaw: "Hybrid - London",
      region: "England",
      title: "Account Executive, Majors",
      workplace: "hybrid" as const,
    },
    {
      ...vercel,
      atsJobId: "6231864004",
      boardId: vercelBoard,
      city: null,
      companyId: vercelId,
      countryCode: "DE",
      locationRaw: "Remote - Germany",
      region: null,
      title: "Account Executive, Commercial",
      workplace: "remote" as const,
    },
  ];

  const seeded = await Promise.all(
    postings.map(async (posting) => {
      const postingId = await seedRecordedPosting(owner, {
        ...posting,
        questions: recordedQuestions(posting.boardToken, posting.atsJobId),
      });

      const applicationId = await seedApplication(owner, {
        postingId,
        status: "preparing",
        userId,
      });

      return [posting.atsJobId, applicationId] as const;
    }),
  );

  const applications = new Map(seeded);

  await Promise.all(
    [...applications.values()].map(async (applicationId) => prepare(owner, applicationId)),
  );

  const rows = await applicationsFor(owner, userId);

  const statusFor = (atsJobId: string) =>
    rows.find((row) => row.id === applications.get(atsJobId))?.status;

  expect(statusFor("8172510")).toBe("skipped");
  expect(statusFor("8238731")).toBe("skipped");

  for (const atsJobId of [
    "8097321",
    "8287256",
    "8392878",
    "7695702",
    "8138044",
    "8332467",
    "5841911004",
    "6100103004",
    "5999792004",
    "6231864004",
  ]) {
    expect(statusFor(atsJobId)).toBe("needs_review");
  }

  const prompts = [
    ...new Set(
      (await reviewsFor(owner, userId)).reviews
        .filter((review) => review.status === "open")
        .map((review) => review.prompt.trim()),
    ),
  ].toSorted();

  expect(prompts).toEqual([
    "Are you authorized to work in the UK?",
    "How did you hear about this job?",
    "What is your current or previous job title?",
    "Where did you first hear about this role?",
  ]);

  const removedFamilies = [
    "country or countries you anticipate working in",
    "work from a remote location",
    "South San Francisco office",
    "Sydney office",
    "live in one of the following states",
    "employed by Stripe",
    "Legal Name (if different than above)",
    "currently located in one of the hub locations",
  ];

  for (const family of removedFamilies) {
    expect(prompts.some((prompt) => prompt.includes(family))).toBe(false);
  }

  const stripeAnswers = await answersFor(owner, applications.get("8138044") ?? "");

  const stripeAnswer = (prefix: string) =>
    stripeAnswers.find((answer) => answer.text.startsWith(prefix))?.answer;

  expect(stripeAnswer("Please select the country or countries you anticipate working in")).toBe(
    "US",
  );
  expect(stripeAnswer("If this role offers the option to work from a remote location")).toBe(
    "Yes, I intend to work remotely.",
  );
  expect(stripeAnswer("Have you ever been employed by Stripe")).toBe("No");
  expect(stripeAnswer("If located in the US, in what city and state do you reside?")).toBe(
    "Toronto, Ontario",
  );

  const officeAnswers = await answersFor(owner, applications.get("8238731") ?? "");

  expect(
    officeAnswers.find((answer) =>
      answer.text.startsWith("Are you open to working from the South San Francisco office"),
    )?.answer,
  ).toBe("Yes");

  const cloudflareAnswers = await answersFor(owner, applications.get("8097321") ?? "");

  const cloudflareAnswer = (prefix: string) =>
    cloudflareAnswers.find((answer) => answer.text.startsWith(prefix))?.answer;

  expect(cloudflareAnswer("Legal Name (if different than above)")).toBe("Maya Okafor");
  expect(cloudflareAnswer("This role requires that you live in one of the following hubs")).toBe(
    "I am willing to relocate to this job's location.",
  );
  expect(cloudflareAnswer("Please indicate your current city, state, and country.")).toBe(
    "Toronto, Ontario, Canada",
  );

  const sydneyAnswers = await answersFor(owner, applications.get("6100103004") ?? "");

  const sydneyAnswer = (prefix: string) =>
    sydneyAnswers.find((answer) => answer.text.startsWith(prefix))?.answer;

  expect(sydneyAnswer("This role is Sydney based.")).toBe("Yes");
  expect(sydneyAnswer("Do you live in one of the following states?")).toBe("No");
});

test("ready means every required field has a built value that passed validation", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);
  await saveFacts(owner, [
    { key: "email", value: "maya.okafor@mail.overture.test" },
    { key: "salary_expectation", value: "USD 110,000 to 128,000 per year" },
    { key: "notice_period", value: "Four weeks" },
    { key: "earliest_start", value: "31 December 2026" },
  ]);

  const postingId = await seedQuestions(owner, {
    atsJobId: "validated-1",
    boardToken: "validated-co",
    companyName: "Validated Co",
    domain: "validated.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      {
        answerKind: "fact",
        factKey: "salary_expectation",
        fieldType: "text",
        required: true,
        text: "What is your salary expectation?",
      },
      {
        answerKind: "fact",
        factKey: "notice_period",
        fieldType: "number",
        required: true,
        text: "How many weeks' notice can you give?",
      },
      {
        answerKind: "fact",
        factKey: "earliest_start",
        fieldType: "date",
        required: true,
        text: "Earliest start date",
      },
      {
        answerKind: "unknown",
        fieldType: "file",
        required: true,
        text: "Resume/CV",
      },
      {
        answerKind: "consent",
        fieldType: "select",
        options: ["Acknowledge/Confirm"],
        required: true,
        text: "Please review and acknowledge our privacy notice.",
      },
      {
        answerKind: "consent",
        fieldType: "checkbox",
        required: true,
        text: "I acknowledge that I have read the privacy notice.",
      },
    ],
    title: "Staff Platform Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("ready");

  const answers = await answersFor(owner, applicationId);

  expect(answers).toHaveLength(7);

  for (const answer of answers) {
    expect(answer.block).toBeNull();

    if (answer.required) {
      expect(answer.resolved).toBe(true);
    }
  }

  const byText = new Map(answers.map((answer) => [answer.text, answer]));

  expect(byText.get("What is your salary expectation?")).toMatchObject({
    answer: "USD 110,000 to 128,000 per year",
    resolved: true,
    source: "fact",
    unit: { currency: "USD", period: "year" },
  });
  expect(byText.get("How many weeks' notice can you give?")).toMatchObject({
    answer: "4",
    resolved: true,
    unit: { currency: null, period: "week" },
  });
  expect(byText.get("Earliest start date")).toMatchObject({
    answer: "2026-12-31",
    resolved: true,
  });
  expect(byText.get("Resume/CV")).toMatchObject({
    answer: null,
    file: "resume",
    resolved: true,
    source: "file",
  });
  expect(byText.get("Please review and acknowledge our privacy notice.")).toMatchObject({
    answer: "Acknowledge/Confirm",
    resolved: true,
    source: "consent",
  });
  expect(byText.get("I acknowledge that I have read the privacy notice.")).toMatchObject({
    answer: "Yes",
    resolved: true,
    source: "consent",
  });
});

test("a required value that fails its field type never reaches ready", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [{ key: "email", value: "not an email address" }]);

  const postingId = await seedQuestions(owner, {
    atsJobId: "invalid-email-1",
    boardToken: "invalid-email",
    companyName: "Invalid Email Co",
    domain: "invalid-email.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
    ],
    title: "Backend Engineer",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("needs_review");

  const email = (await answersFor(owner, applicationId)).find((answer) => answer.text === "Email");

  expect(email).toMatchObject({
    answer: null,
    block: "type_mismatch",
    resolved: false,
    source: null,
  });
  expect(
    (await reviewsFor(owner, userId)).reviews.filter((review) => review.status === "open"),
  ).toHaveLength(1);
});

test("a marketing opt-in is never checked, and a required one skips", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const question = {
    answerKind: "skip" as const,
    fieldType: "select" as const,
    options: ["Yes", "No"],
    text: "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?",
  };

  const optionalPosting = await seedQuestions(owner, {
    atsJobId: "marketing-optional-1",
    boardToken: "marketing-optional",
    companyName: "Marketing Optional Co",
    domain: "marketing-optional.example",
    questions: [{ ...question, required: false }],
    title: "Backend Engineer",
  });

  const optionalApplication = await seedApplication(owner, {
    postingId: optionalPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, optionalApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === optionalApplication)?.status,
  ).toBe("ready");

  const marketing = (await answersFor(owner, optionalApplication)).find((answer) =>
    answer.text.startsWith("Do you opt-in"),
  );

  expect(marketing).toMatchObject({
    answer: null,
    block: "marketing_opt_in",
    resolved: false,
    source: null,
  });
  expect(["Yes", "No"]).not.toContain(marketing?.answer);

  const requiredPosting = await seedQuestions(owner, {
    atsJobId: "marketing-required-1",
    boardToken: "marketing-required",
    companyName: "Marketing Required Co",
    domain: "marketing-required.example",
    questions: [{ ...question, required: true }],
    title: "Backend Engineer",
  });

  const requiredApplication = await seedApplication(owner, {
    postingId: requiredPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, requiredApplication);

  const required = (await applicationsFor(owner, userId)).find(
    (row) => row.id === requiredApplication,
  );

  expect(required?.status).toBe("skipped");
  expect(required?.statusReason).toBe("form_unsupported");
});

test("a privacy consent that only offers a refusal is never accepted", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedQuestions(owner, {
    atsJobId: "consent-refusal-1",
    boardToken: "consent-refusal",
    companyName: "Consent Refusal Co",
    domain: "consent-refusal.example",
    questions: [
      {
        answerKind: "consent",
        fieldType: "select",
        options: ["I do not consent"],
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

  expect(application?.status).toBe("skipped");
  expect(application?.statusReason).toBe("form_unsupported");

  const consent = (await answersFor(owner, applicationId)).find((answer) =>
    answer.text.startsWith("Please review and acknowledge"),
  );

  expect(consent).toMatchObject({ answer: null, block: "unsupported_field", resolved: false });
});

test("a cover-letter file slot maps to the cover-letter Fact and never the resume", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await uploadResume(owner);
  await saveFacts(owner, [{ key: "email", value: "maya.okafor@mail.overture.test" }]);

  const optionalPosting = await seedQuestions(owner, {
    atsJobId: "cover-letter-optional-1",
    boardToken: "cover-letter-optional",
    companyName: "Cover Letter Optional Co",
    domain: "cover-letter-optional.example",
    questions: [
      { answerKind: "fact", factKey: "email", fieldType: "email", required: true, text: "Email" },
      { answerKind: "open_text", fieldType: "file", required: false, text: "Cover Letter" },
    ],
    title: "Backend Engineer",
  });

  const optionalApplication = await seedApplication(owner, {
    postingId: optionalPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, optionalApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === optionalApplication)?.status,
  ).toBe("ready");

  const coverLetter = (await answersFor(owner, optionalApplication)).find(
    (answer) => answer.text === "Cover Letter",
  );

  expect(coverLetter).toMatchObject({
    answer: null,
    block: "file_unavailable",
    file: "cover_letter",
    resolved: false,
  });
  expect(coverLetter?.file).not.toBe("resume");

  const requiredPosting = await seedQuestions(owner, {
    atsJobId: "cover-letter-required-1",
    boardToken: "cover-letter-required",
    companyName: "Cover Letter Required Co",
    domain: "cover-letter-required.example",
    questions: [
      { answerKind: "open_text", fieldType: "file", required: true, text: "Cover Letter" },
    ],
    title: "Backend Engineer",
  });

  const requiredApplication = await seedApplication(owner, {
    postingId: requiredPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, requiredApplication);

  const required = (await applicationsFor(owner, userId)).find(
    (row) => row.id === requiredApplication,
  );

  expect(required?.status).toBe("skipped");
  expect(required?.statusReason).toBe("form_unsupported");
});

test("a salary keeps its currency and period in text and number fields", async ({
  preparation,
}) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [{ key: "salary_expectation", value: "140,000 CAD a year" }]);

  const postingId = await seedQuestions(owner, {
    atsJobId: "salary-kept-1",
    boardToken: "salary-kept",
    companyName: "Salary Kept Co",
    domain: "salary-kept.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "salary_expectation",
        fieldType: "text",
        required: true,
        text: "What is your salary expectation?",
      },
      {
        answerKind: "fact",
        factKey: "salary_expectation",
        fieldType: "number",
        required: true,
        text: "Expected annual salary in CAD",
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

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("ready");

  const answers = await answersFor(owner, applicationId);
  const byText = new Map(answers.map((answer) => [answer.text, answer]));

  expect(byText.get("What is your salary expectation?")).toMatchObject({
    answer: "140,000 CAD a year",
    unit: { currency: "CAD", period: "year" },
  });
  expect(byText.get("Expected annual salary in CAD")).toMatchObject({
    answer: "140000",
    unit: { currency: "CAD", period: "year" },
  });
});

test("a salary range is never silently truncated to one number", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [{ key: "salary_expectation", value: "USD 110,000 to 128,000 per year" }]);

  const postingId = await seedQuestions(owner, {
    atsJobId: "salary-range-1",
    boardToken: "salary-range",
    companyName: "Salary Range Co",
    domain: "salary-range.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "salary_expectation",
        fieldType: "number",
        required: true,
        text: "What is your expected annual salary?",
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

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("needs_review");

  const answer = (await answersFor(owner, applicationId)).find((row) =>
    row.text.startsWith("What is your expected annual salary"),
  );

  expect(answer).toMatchObject({
    answer: null,
    block: "type_mismatch",
    resolved: false,
  });
});

test("a notice period keeps its unit and never becomes a bare number", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [{ key: "notice_period", value: "Four weeks" }]);

  const withUnit = await seedQuestions(owner, {
    atsJobId: "notice-weeks-1",
    boardToken: "notice-weeks",
    companyName: "Notice Weeks Co",
    domain: "notice-weeks.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "notice_period",
        fieldType: "number",
        required: true,
        text: "How many weeks' notice can you give?",
      },
    ],
    title: "Backend Engineer",
  });

  const withUnitApplication = await seedApplication(owner, {
    postingId: withUnit,
    status: "preparing",
    userId,
  });

  await prepare(owner, withUnitApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === withUnitApplication)?.status,
  ).toBe("ready");

  expect(
    (await answersFor(owner, withUnitApplication)).find((answer) =>
      answer.text.startsWith("How many weeks"),
    ),
  ).toMatchObject({ answer: "4", unit: { currency: null, period: "week" } });

  const withoutUnit = await seedQuestions(owner, {
    atsJobId: "notice-bare-1",
    boardToken: "notice-bare",
    companyName: "Notice Bare Co",
    domain: "notice-bare.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "notice_period",
        fieldType: "number",
        required: true,
        text: "Notice period",
      },
    ],
    title: "Backend Engineer",
  });

  const withoutUnitApplication = await seedApplication(owner, {
    postingId: withoutUnit,
    status: "preparing",
    userId,
  });

  await prepare(owner, withoutUnitApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === withoutUnitApplication)?.status,
  ).toBe("needs_review");

  expect(
    (await answersFor(owner, withoutUnitApplication)).find(
      (answer) => answer.text === "Notice period",
    ),
  ).toMatchObject({ answer: null, block: "type_mismatch", resolved: false });
});

test("a date is formatted from the Fact, not the server's time zone", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  const postingId = await seedQuestions(owner, {
    atsJobId: "date-last-day-1",
    boardToken: "date-last-day",
    companyName: "Date Last Day Co",
    domain: "date-last-day.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "earliest_start",
        fieldType: "date",
        required: true,
        text: "Earliest start date",
      },
    ],
    title: "Backend Engineer",
  });

  await saveFacts(owner, [{ key: "earliest_start", value: "31 December 2026" }]);

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("ready");
  expect(
    (await answersFor(owner, applicationId)).find(
      (answer) => answer.text === "Earliest start date",
    ),
  ).toMatchObject({ answer: "2026-12-31", resolved: true });

  const vaguePosting = await seedQuestions(owner, {
    atsJobId: "date-vague-1",
    boardToken: "date-vague",
    companyName: "Date Vague Co",
    domain: "date-vague.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "earliest_start",
        fieldType: "date",
        required: true,
        text: "Earliest start date",
      },
    ],
    title: "Backend Engineer",
  });

  await saveFacts(owner, [{ key: "earliest_start", value: "ASAP" }]);

  const vagueApplication = await seedApplication(owner, {
    postingId: vaguePosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, vagueApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === vagueApplication)?.status,
  ).toBe("needs_review");
  expect(
    (await answersFor(owner, vagueApplication)).find(
      (answer) => answer.text === "Earliest start date",
    ),
  ).toMatchObject({ answer: null, block: "type_mismatch", resolved: false });
});

test("a salary in another currency never fills a field that names one", async ({ preparation }) => {
  const { owner, userId } = await ownerContextFor(preparation.server.url);

  await saveFacts(owner, [{ key: "salary_expectation", value: "140,000 CAD a year" }]);

  const postingId = await seedQuestions(owner, {
    atsJobId: "salary-currency-1",
    boardToken: "salary-currency",
    companyName: "Salary Currency Co",
    domain: "salary-currency.example",
    questions: [
      {
        answerKind: "fact",
        factKey: "salary_expectation",
        fieldType: "number",
        required: true,
        text: "Expected annual salary in EUR",
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

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status,
  ).toBe("needs_review");

  expect(
    (await answersFor(owner, applicationId)).find(
      (answer) => answer.text === "Expected annual salary in EUR",
    ),
  ).toMatchObject({ answer: null, block: "type_mismatch", resolved: false });
});
