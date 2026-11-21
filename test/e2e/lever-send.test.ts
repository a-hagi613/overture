import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { LeverFixture } from "./lever.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { recordedLeverFormQuestions, startLeverFixture } from "./lever.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface LeverHarness {
  fixture: LeverFixture;
  jobId: string;
  server: AppServer;
  sessionDirectory: string;
  site: LeverSite;
}

interface LeverSite {
  boardToken: string;
  jobId: string;
  companyName: string;
  title: string;
}

const PYKA: LeverSite = {
  boardToken: "pyka",
  companyName: "Pyka",
  jobId: "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb",
  title: "Chief Of Staff",
};

const HIVE: LeverSite = {
  boardToken: "hive",
  companyName: "Deploy",
  jobId: "ac502675-09a8-4169-8061-8d49fd4e2c4f",
  title: "Account Executive",
};

const startLeverHarness = async (identityServer: IdentityServer, site: LeverSite) => {
  const directory = mkdtempSync(join(tmpdir(), "overture-lever-send-"));
  const fixture = startLeverFixture({ boardToken: site.boardToken, jobId: site.jobId });
  const sessionDirectory = join(directory, "browsers");

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: sessionDirectory,
    LEVER_JOBS_BASE_URL: fixture.url,
  });

  return { fixture, jobId: site.jobId, server, sessionDirectory, site };
};

async function provideLeverHarness(
  identityServer: IdentityServer,
  site: LeverSite,
  provide: (harness: LeverHarness) => Promise<void>,
) {
  const harness = await startLeverHarness(identityServer, site);

  await provide(harness);
  await harness.server.stop();
  harness.fixture.close();
}

const test = appTest.extend<{ lever: LeverHarness; leverHive: LeverHarness }>({
  lever: [
    async ({ identityServer }, provide) => provideLeverHarness(identityServer, PYKA, provide),
    { scope: "test" },
  ],
  leverHive: [
    async ({ identityServer }, provide) => provideLeverHarness(identityServer, HIVE, provide),
    { scope: "test" },
  ],
});

const applicationRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  stage: z.string().nullable(),
  attempts: z.number(),
});

const attemptSchema = z.object({
  id: z.string(),
  n: z.number(),
  outcome: z.string().nullable(),
  submitClickedAt: z.number().nullable(),
  submitResponseStatus: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const snapshotSchema = z.object({
  answers: z.array(
    z.object({
      answer: z.string().nullable(),
      kind: z.string(),
      label: z.string(),
    }),
  ),
  confirmedBy: z.string(),
});

const applicationDetailSchema = z.object({
  application: applicationRowSchema,
  snapshot: snapshotSchema.nullable(),
});

const fixtureStateSchema = z.object({
  applicationRequests: z.number(),
  submissions: z.number(),
  formLoads: z.number(),
});

const homeSchema = z.object({ applicationsLeft: z.number() });

const reviewViewSchema = z.object({
  reviews: z.array(
    z.object({
      id: z.string(),
      prompt: z.string(),
      fieldType: z.string(),
      options: z.array(z.string()),
      unlocked: z.number(),
    }),
  ),
});

const seededReviewSchema = z.object({ reviewId: z.string(), questionId: z.string() });

const HEARD_PROMPT = "How did you hear about this position?";

const COMMUTE_PROMPT =
  "This role is based in Alameda, CA, and requires on-site work at least three days per week. Are you able to reliably commute to Alameda for this schedule?";

const LEVER_FACT_KEYS = new Map<string, string>([
  ["Full name", "legal_name"],
  ["Email", "email"],
  ["Phone", "phone"],
  ["Current location", "current_city"],
  ["Current company", "current_employer"],
  ["LinkedIn URL", "linkedin_url"],
  ["GitHub URL", "github_url"],
  ["Portfolio URL", "website_url"],
  ["Are you legally authorized to work in the United States?", "work_auth"],
  ["How did you hear about this position?", "how_did_you_hear"],
  ["What are your annual salary expectations for this role?", "salary_expectation"],
  [COMMUTE_PROMPT, "security_clearance"],
  [HEARD_PROMPT, "how_did_you_hear"],
  ["What is/was your GPA?", "degree_highest"],
  [
    "Will you now or in the future require sponsorship for employment? If so, please explain in detail (e.g., OPT with STEM extension).",
    "sponsorship_required",
  ],
  ["How did you hear about us?", "how_did_you_hear"],
]);

const HEARD_OPTIONS = [
  "LinkedIn",
  "Google (Job Search)",
  "ZipRecruiter",
  "Climatebase",
  "Indeed",
  "Wellfound",
  "College of Alameda",
  "Stanford Solar Car Project",
  "MIT Design, Built, Fly",
  "SJSU Spartans",
  "Waterloo Aerial Robotics Group",
  "WaterlooWorks Website",
  "Bay Area Women in Space and Aerospace",
  "Employee Referral (please specify employee's full name below)",
  "Other",
];

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+1 416 555 0199", scope: "" },
  { key: "current_city", value: "London", scope: "" },
  { key: "current_country", value: "United Kingdom", scope: "" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor", scope: "" },
  { key: "work_auth", value: "Yes", scope: "US" },
  { key: "salary_expectation", value: "120000 per year", scope: "" },
];

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  return { owner, userId };
}

async function prepareProfile(owner: APIRequestContext) {
  const resume = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(resume.ok()).toBe(true);

  const saved = await owner.put("/api/profile/facts", { data: { facts } });

  expect(saved.ok()).toBe(true);
}

async function seededApplication(harness: LeverHarness) {
  const { owner, userId } = await ownerFor(harness.server);

  await prepareProfile(owner);

  const { boardToken, companyName, jobId, title } = harness.site;
  const domain = `${boardToken}.example`;

  const companyId = await seedCompany(owner, companyName, domain);
  const boardId = await seedBoard(owner, companyId, "lever", boardToken);

  const recorded = await recordedLeverFormQuestions(boardToken, jobId);

  const postingId = await seedPosting(owner, {
    ats: "lever",
    atsJobId: jobId,
    boardId,
    companyId,
    questions: recorded.map((question) => {
      const factKey = LEVER_FACT_KEYS.get(question.label) ?? null;

      return {
        answerKind: factKey === null ? ("skip" as const) : ("fact" as const),
        factKey,
        fieldName: question.fieldName,
        fieldType: question.fieldType,
        options: question.options,
        required: question.required,
        text: question.label,
      };
    }),
    title,
    url: `${harness.fixture.url}/${boardToken}/${jobId}/apply`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

  return { applicationId, owner, postingId, userId };
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

async function approveForSend(owner: APIRequestContext, applicationId: string) {
  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return applicationDetailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function fixtureState(fixture: LeverFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

async function reviewsOf(owner: APIRequestContext) {
  return reviewViewSchema.parse(await (await owner.get("/api/reviews")).json()).reviews;
}

async function learnReview(
  owner: APIRequestContext,
  input: {
    applicationId: string;
    options: string[];
    prompt: string;
    userId: string;
    value: string;
  },
) {
  const open = (await reviewsOf(owner)).find((review) => review.prompt === input.prompt);
  let reviewId = open?.id;

  if (reviewId === undefined) {
    const seeded = seededReviewSchema.parse(
      await (
        await owner.post("/__test__/reviews/seed", {
          data: {
            applicationIds: [input.applicationId],
            fieldType: "select",
            options: input.options,
            prompt: input.prompt,
            reason: "unknown_required",
            userId: input.userId,
          },
        })
      ).json(),
    );

    const { reviewId: seededReviewId } = seeded;

    reviewId = seededReviewId;
  }

  const answered = await owner.post(`/api/reviews/${encodeURIComponent(reviewId)}/answer`, {
    data: { value: input.value },
  });

  expect(answered.ok()).toBe(true);
}

test("an unknown required Lever question opens a Review during preparation and nothing is submitted", async ({
  lever,
}) => {
  const { applicationId, owner } = await seededApplication(lever);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");
  expect(detail.application.statusReason).toBe("unknown_question");
  expect(detail.application.stage).toBe("queued");
  expect(detail.snapshot).toBeNull();

  const state = await fixtureState(lever.fixture);

  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);

  const reviews = await reviewsOf(owner);

  expect(reviews.map((review) => review.prompt).toSorted()).toEqual(
    [COMMUTE_PROMPT, HEARD_PROMPT].toSorted(),
  );

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(0);
});

test("a Lever send fills the recorded form and ends sent after its questions are learned", async ({
  lever,
}) => {
  const { applicationId, owner, userId } = await seededApplication(lever);

  await learnReview(owner, {
    applicationId,
    options: HEARD_OPTIONS,
    prompt: HEARD_PROMPT,
    userId,
    value: "LinkedIn",
  });
  await learnReview(owner, {
    applicationId,
    options: ["Yes", "No"],
    prompt: COMMUTE_PROMPT,
    userId,
    value: "Yes",
  });

  expect((await applicationOf(owner, applicationId)).application.status).toBe("ready");

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot?.confirmedBy).toBe("page");

  const answers = new Map(detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]));

  expect(answers.get("Full name")).toBe("Maya Okafor");
  expect(answers.get("Email")).toBe("maya.okafor@example.com");
  expect(answers.get("Phone")).toBe("+1 416 555 0199");
  expect(answers.get("Current location")).toBe("London");
  expect(answers.get("LinkedIn URL")).toBe("https://www.linkedin.com/in/maya-okafor");
  expect(answers.get("Are you legally authorized to work in the United States?")).toBe("Yes");
  expect(answers.get(HEARD_PROMPT)).toBe("LinkedIn");
  expect(answers.get("What are your annual salary expectations for this role?")).toBe(
    "120000 per year",
  );
  expect(answers.get(COMMUTE_PROMPT)).toBe("Yes");

  const state = await fixtureState(lever.fixture);

  expect(state.applicationRequests).toBe(1);
  expect(state.submissions).toBe(1);

  expect(lever.fixture.state.lastForm["name"]).toBe("Maya Okafor");
  expect(lever.fixture.state.lastForm["email"]).toBe("maya.okafor@example.com");
  expect(lever.fixture.state.lastForm["location"]).toBe("London");
  expect(lever.fixture.state.lastForm["urls[LinkedIn]"]).toBe(
    "https://www.linkedin.com/in/maya-okafor",
  );
  expect(lever.fixture.state.lastForm[`cards[e71c4b64-41f5-44a8-9637-9dab78656f8f][field0]`]).toBe(
    "Yes",
  );
  expect(lever.fixture.state.lastForm[`cards[e71c4b64-41f5-44a8-9637-9dab78656f8f][field1]`]).toBe(
    "LinkedIn",
  );
  expect(lever.fixture.state.lastForm[`cards[021e60de-4072-4b55-a0d3-a3168bfea04e][field0]`]).toBe(
    "Yes",
  );
  expect(lever.fixture.state.lastResumeBytes).not.toBeNull();
  expect(
    Buffer.from(lever.fixture.state.lastResumeBytes ?? new Uint8Array()).toString("base64"),
  ).toBe(Buffer.from(resumeBytes).toString("base64"));

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(201);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);
});

test("a Lever card is read by its section heading, not its generic field prompt", async ({
  leverHive,
}) => {
  const { applicationId, owner } = await seededApplication(leverHive);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");
  expect(detail.application.statusReason).toBe("unknown_question");

  const prompts = (await reviewsOf(owner)).map((review) => review.prompt);

  expect(prompts).toContain("How did you hear about us?");
  expect(prompts).not.toContain("Please check all that apply:");

  expect((await fixtureState(leverHive.fixture)).submissions).toBe(0);
});
