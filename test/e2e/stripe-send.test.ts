import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import type { FeedFixtureServer } from "./feed-fixture-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startFeedFixtureServer } from "./feed-fixture-server.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { recordedQuestions } from "./recorded-questions.ts";

interface StripeHarness {
  anthropic: AnthropicFixtureServer;
  feed: FeedFixtureServer;
  fixture: GreenhouseFixture;
  server: AppServer;
}

const test = appTest.extend<{ stripe: StripeHarness }>({
  stripe: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();
      const feed = await startFeedFixtureServer();
      const fixture = startGreenhouseFixture();
      const directory = mkdtempSync(join(tmpdir(), "overture-stripe-send-"));

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: join(directory, "browsers"),
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        GREENHOUSE_FEED_BASE_URL: feed.url,
      });

      await provide({ anthropic, feed, fixture, server });
      await server.stop();
      fixture.close();
      feed.stop();
      anthropic.stop();
    },
    { scope: "test" },
  ],
});

test.describe.configure({ timeout: 120_000 });

const applicationRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  attempts: z.number(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const reviewsSchema = z.object({
  reviews: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      reason: z.string(),
      status: z.string(),
    }),
  ),
});

const recordedStripeJob = z
  .object({ title: z.string() })
  .parse(JSON.parse(readFileSync("test/e2e/fixtures/greenhouse/stripe/jobs/8172510.json", "utf8")));

const personaFacts = [
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
];

const personaTargets = {
  employmentTypes: ["full_time"],
  locations: ["Toronto, ON", "United States", "United Kingdom", "Germany", "Australia"],
  roles: ["Backend"],
  salaryCurrency: null,
  salaryFloorMinor: null,
  salaryPeriod: "year",
  seniorities: ["senior"],
  workplaces: ["remote", "hybrid", "onsite"],
};

const allQuestions = recordedQuestions("stripe", "8172510");

const JOB_TITLE = "What is your current or previous job title?";
const WHATSAPP = "Do you opt-in to receive WhatsApp messages from Stripe Recruiting?";

const withoutWhatsapp = allQuestions.filter((question) => question.text !== WHATSAPP);

const countryQuestion = {
  text: "Country",
  fieldName: "country",
  fieldType: "select" as const,
  options: ["Canada", "United Kingdom", "United States"],
  factKey: "current_country",
  answerKind: "fact" as const,
  required: true,
};

const withoutTitleOrWhatsapp = [
  ...allQuestions.filter((question) => question.text !== JOB_TITLE && question.text !== WHATSAPP),
  countryQuestion,
];

const STRIPE_PATH = "/embed/stripe/jobs/8172510";

const answersSchema = z.object({
  answers: z.array(
    z.object({
      text: z.string(),
      answer: z.string().nullable(),
      required: z.boolean(),
      resolved: z.boolean(),
    }),
  ),
});

const attemptsSchema = z.object({
  attempts: z.array(
    z.object({
      errorCode: z.string().nullable(),
      outcome: z.string().nullable(),
      submitClickedAt: z.number().nullable(),
      submitResponseStatus: z.number().nullable(),
    }),
  ),
});

const sentDetailSchema = z.object({
  application: applicationRowSchema,
  snapshot: z
    .object({ answers: z.array(z.object({ label: z.string(), answer: z.string().nullable() })) })
    .nullable(),
});

async function setVariant(fixtureUrl: string, mutation: string | null) {
  const response = await fetch(`${fixtureUrl}/__fixture__/mutate`, {
    body: JSON.stringify({ mutation }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  expect(response.ok).toBe(true);
}

async function saveFacts(owner: APIRequestContext) {
  const response = await owner.put("/api/profile/facts", { data: { facts: personaFacts } });

  expect(response.ok()).toBe(true);
}

async function saveTargets(owner: APIRequestContext) {
  const response = await owner.put("/api/profile/targets", { data: personaTargets });

  expect(response.ok()).toBe(true);
}

async function uploadResume(owner: APIRequestContext) {
  const response = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(response.ok()).toBe(true);
}

type PostingQuestions = NonNullable<Parameters<typeof seedPosting>[1]["questions"]>;

async function seedStripePosting(
  owner: APIRequestContext,
  fixtureUrl: string,
  questions: PostingQuestions,
) {
  const companyId = await seedCompany(owner, "Stripe", "stripe.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "stripe");

  return seedPosting(owner, {
    atsJobId: "8172510",
    boardId,
    city: "Seattle",
    companyId,
    countryCode: "US",
    locationRaw: "Seattle, San Francisco, New York City",
    questions,
    region: "Washington",
    tags: [{ dimension: "subrole", value: "Backend" }],
    title: recordedStripeJob.title,
    url: `${fixtureUrl}/stripe/jobs/8172510`,
    workplace: "hybrid",
  });
}

async function prepare(owner: APIRequestContext, applicationId: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: {
      kind: "application.prepare",
      payload: JSON.stringify({ applicationId }),
    },
  });

  expect(response.ok()).toBe(true);
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });

  expect(response.ok()).toBe(true);
}

async function applicationOf(owner: APIRequestContext, userId: string, applicationId: string) {
  const { applications } = applicationsSchema.parse(
    await (await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  );

  const row = applications.find((candidate) => candidate.id === applicationId);

  if (row === undefined) {
    throw new Error(`no Application ${applicationId}`);
  }

  return row;
}

async function openReviewPrompts(owner: APIRequestContext, userId: string) {
  const { reviews } = reviewsSchema.parse(
    await (await owner.get(`/__test__/reviews?userId=${encodeURIComponent(userId)}`)).json(),
  );

  return reviews
    .filter((review) => review.status === "open")
    .map((review) => ({ prompt: review.prompt.trim(), reason: review.reason }));
}

async function answersOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/prepared-answers?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return answersSchema.parse(await response.json()).answers;
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function preparingApplication(
  stripe: StripeHarness,
  questions: PostingQuestions,
  mutation: string | null,
) {
  const { owner, userId } = await ownerContextFor(stripe.server.url);

  await uploadResume(owner);
  await saveFacts(owner);
  await saveTargets(owner);
  await setVariant(stripe.fixture.url, mutation);

  const postingId = await seedStripePosting(owner, stripe.fixture.url, questions);
  const applicationId = await seedApplication(owner, { postingId, status: "preparing", userId });

  await grantApplications(owner, 3);

  return { applicationId, owner, userId };
}

test("with a Fact or Target for every mappable required question, the Stripe send posts JSON to submitPath and completes", async ({
  stripe,
}) => {
  const { applicationId, owner, userId } = await preparingApplication(
    stripe,
    withoutTitleOrWhatsapp,
    "stripe-send",
  );

  await prepare(owner, applicationId);
  await approveApplication(owner, applicationId);

  expect((await applicationOf(owner, userId, applicationId)).status).toBe("approved");
  expect(await openReviewPrompts(owner, userId)).toEqual([]);

  const answers = await answersOf(owner, applicationId);

  expect(answers.filter((answer) => answer.required && !answer.resolved)).toEqual([]);

  const answerFor = (prefix: string) =>
    answers.find((answer) => answer.text.startsWith(prefix))?.answer;

  expect(answerFor("Who is your current or previous employer?")).toBe("Brightwave Analytics");
  expect(answerFor("Please select the country where you currently reside.")).toBe("Canada");
  expect(answerFor("Please select the country or countries you anticipate working in")).toBe("US");
  expect(answerFor("If this role offers the option to work from a remote location")).toBe(
    "Yes, I intend to work remotely.",
  );
  expect(answerFor("Have you ever been employed by Stripe")).toBe("No");

  await runSend(owner, applicationId);

  const application = await applicationOf(owner, userId, applicationId);

  const attempts = await attemptsOf(owner, applicationId);

  expect(application.status).toBe("sent");
  expect(application.attempts).toBe(1);
  expect(stripe.fixture.state.applicationPaths).toEqual([STRIPE_PATH]);
  expect(stripe.fixture.state.applicationContentTypes).toEqual(["application/json"]);
  expect(stripe.fixture.state.submissions).toBe(1);
  expect(stripe.fixture.state.lastForm["email"]).toBe("maya.okafor@mail.overture.test");

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(201);

  const detail = sentDetailSchema.parse(
    await (await owner.get(`/api/applications/${applicationId}`)).json(),
  );

  const snapshotAnswer = (prefix: string) =>
    detail.snapshot?.answers.find((answer) => answer.label.startsWith(prefix))?.answer;

  expect(snapshotAnswer("Who is your current or previous employer?")).toBe("Brightwave Analytics");
  expect(snapshotAnswer("Please select the country where you currently reside.")).toBe("Canada");
});

test("a missing react-select option ends form_changed and submits nothing", async ({ stripe }) => {
  const { applicationId, owner } = await preparingApplication(
    stripe,
    withoutTitleOrWhatsapp,
    "stripe-select-option-changed",
  );

  await prepare(owner, applicationId);
  await approveApplication(owner, applicationId);
  await runSend(owner, applicationId);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts[0]?.outcome).toBe("form_changed");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.errorCode).toContain("preflight:option_missing:question_68935509");
  expect(stripe.fixture.state.applicationPaths).toEqual([]);
  expect(stripe.fixture.state.submissions).toBe(0);
});

test("a changed checkbox-group option ends form_changed and submits nothing", async ({
  stripe,
}) => {
  const { applicationId, owner } = await preparingApplication(
    stripe,
    withoutTitleOrWhatsapp,
    "stripe-checkbox-option-changed",
  );

  await prepare(owner, applicationId);
  await approveApplication(owner, applicationId);
  await runSend(owner, applicationId);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts[0]?.outcome).toBe("form_changed");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.errorCode).toContain("preflight:option_missing:question_68935510[]");
  expect(stripe.fixture.state.applicationPaths).toEqual([]);
  expect(stripe.fixture.state.submissions).toBe(0);
});

test("a required question with no Fact opens a Review and nothing is posted to submitPath", async ({
  stripe,
}) => {
  const { applicationId, owner, userId } = await preparingApplication(
    stripe,
    withoutWhatsapp,
    "stripe-without-whatsapp",
  );

  await prepare(owner, applicationId);

  const application = await applicationOf(owner, userId, applicationId);

  expect(application.status).toBe("needs_review");
  expect(application.statusReason).toBe("unknown_question");

  const prompts = await openReviewPrompts(owner, userId);

  expect(prompts).toEqual([{ prompt: JOB_TITLE, reason: "unknown_required" }]);

  await runSend(owner, applicationId);

  expect((await applicationOf(owner, userId, applicationId)).status).toBe("needs_review");
  expect(stripe.fixture.state.applicationPaths).toEqual([]);
  expect(stripe.fixture.state.submissions).toBe(0);
  expect(stripe.fixture.state.applicationRequests).toBe(0);
});

test("the recorded form's required WhatsApp opt-in skips the Application and nothing is posted", async ({
  stripe,
}) => {
  const { applicationId, owner, userId } = await preparingApplication(stripe, allQuestions, null);

  await prepare(owner, applicationId);

  const application = await applicationOf(owner, userId, applicationId);

  expect(application.status).toBe("skipped");
  expect(application.statusReason).not.toBeNull();

  await runSend(owner, applicationId);

  expect(stripe.fixture.state.applicationPaths).toEqual([]);
  expect(stripe.fixture.state.submissions).toBe(0);
});
