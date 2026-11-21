import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AshbyFixture } from "./ashby.fixture.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { AnswerKind } from "../../src/shared/questions.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { recordedAshbyFormQuestions, startAshbyFixture } from "./ashby.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface AshbyHarness {
  fixture: AshbyFixture;
  server: AppServer;
  sessionDirectory: string;
  site: AshbySite;
}

interface AshbySite {
  boardToken: string;
  jobId: string;
  companyName: string;
  title: string;
}

const VOLTA: AshbySite = {
  boardToken: "volta",
  companyName: "Volta",
  jobId: "123e02c6-445b-42bb-893c-addb1f6d4752",
  title: "Senior Project Manager - CTO Support",
};

const CLERA: AshbySite = {
  boardToken: "clera",
  companyName: "Clera",
  jobId: "0a278229-474e-4534-82d0-ebfafe18ad9d",
  title: "Werkstudent Content & Brand (m/w/d)",
};

const HIGHLIGHTTA: AshbySite = {
  boardToken: "highlightta",
  companyName: "HighlightTA",
  jobId: "1e4f70e2-9d0a-455e-9b08-e84b301e37e6",
  title: "Client Success Specialist",
};

const startAshbyHarness = async (identityServer: IdentityServer, site: AshbySite) => {
  const directory = mkdtempSync(join(tmpdir(), "overture-ashby-send-"));
  const fixture = startAshbyFixture(site);
  const sessionDirectory = join(directory, "browsers");

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: sessionDirectory,
    ASHBY_JOBS_BASE_URL: fixture.url,
  });

  return { fixture, server, sessionDirectory, site };
};

async function provideAshbyHarness(
  identityServer: IdentityServer,
  site: AshbySite,
  provide: (harness: AshbyHarness) => Promise<void>,
) {
  const harness = await startAshbyHarness(identityServer, site);

  await provide(harness);
  await harness.server.stop();
  harness.fixture.close();
}

const test = appTest.extend<{
  ashby: AshbyHarness;
  ashbyLocation: AshbyHarness;
  ashbyYesNo: AshbyHarness;
}>({
  ashby: [
    async ({ identityServer }, provide) => provideAshbyHarness(identityServer, VOLTA, provide),
    { scope: "test" },
  ],
  ashbyLocation: [
    async ({ identityServer }, provide) =>
      provideAshbyHarness(identityServer, HIGHLIGHTTA, provide),
    { scope: "test" },
  ],
  ashbyYesNo: [
    async ({ identityServer }, provide) => provideAshbyHarness(identityServer, CLERA, provide),
    { scope: "test" },
  ],
});

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const SPONSORSHIP_NO =
  "No, I do not require sponsorship to work in the country where this role is located";

const SPONSORSHIP_GROUP =
  "aff810b3-1f77-4e76-950f-6c5dfb53f847_d2dcc981-709b-4026-ae4f-d6f6d613e982";

const applicationRowSchema = z.object({
  approvedAt: z.number().nullable(),
  approvedPlanSha256: z.string().nullable(),
  changes: z.string().nullable(),
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  stage: z.string().nullable(),
  attempts: z.number(),
});

const attemptSchema = z.object({
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

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const baseFacts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "current_city", value: "London", scope: "" },
  { key: "current_country", value: "United Kingdom", scope: "" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor", scope: "" },
];

const sponsorshipFact = { key: "sponsorship_required", value: SPONSORSHIP_NO, scope: "" };

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  return { owner, userId };
}

async function prepareProfile(owner: APIRequestContext, facts: typeof baseFacts) {
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

async function seededApplication(
  harness: AshbyHarness,
  facts: typeof baseFacts,
  options: {
    query?: string;
    questions?: {
      text: string;
      fieldName?: string | null;
      fieldType?:
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
      answerKind?: AnswerKind;
      mappedBy?: "rules" | "llm" | "owner" | null;
    }[];
  } = {},
) {
  const { owner, userId } = await ownerFor(harness.server);

  await prepareProfile(owner, facts);

  const { boardToken, companyName, jobId, title } = harness.site;
  const domain = `${boardToken}.example`;

  const companyId = await seedCompany(owner, companyName, domain);
  const boardId = await seedBoard(owner, companyId, "ashby", boardToken);

  const postingId = await seedPosting(owner, {
    ats: "ashby",
    atsJobId: jobId,
    boardId,
    companyId,
    questions: options.questions ?? [],
    title,
    url: `${harness.fixture.url}/${boardToken}/${jobId}/application${options.query ?? ""}`,
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

async function fixtureState(fixture: AshbyFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

async function reviewsOf(owner: APIRequestContext) {
  return reviewViewSchema.parse(await (await owner.get("/api/reviews")).json()).reviews;
}

test("an unknown required Ashby question opens a Review during preparation and nothing is submitted", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(ashby, baseFacts);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");
  expect(detail.application.statusReason).toBe("unknown_question");
  expect(detail.application.stage).toBe("queued");
  expect(detail.snapshot).toBeNull();

  const state = await fixtureState(ashby.fixture);

  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);

  const reviews = await reviewsOf(owner);

  expect(reviews.map((review) => review.prompt)).toEqual([SPONSORSHIP_PROMPT]);
  expect(reviews[0]?.fieldType).toBe("radio");
  expect(reviews[0]?.options).toContain(SPONSORSHIP_NO);
  expect(reviews[0]?.unlocked).toBe(1);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(0);
});

test("an Ashby send fills the recorded form and ends sent only on the success page", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(ashby, [...baseFacts, sponsorshipFact]);

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot?.confirmedBy).toBe("page");

  const answers = new Map(detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]));

  expect(answers.get("Name")).toBe("Maya Okafor");
  expect(answers.get("Email")).toBe("maya.okafor@example.com");
  expect(answers.get("LinkedIn Profile")).toBe("https://www.linkedin.com/in/maya-okafor");
  expect(answers.get("Where are you currently located?")).toBe("London");
  expect(answers.get(SPONSORSHIP_PROMPT)).toBe(SPONSORSHIP_NO);

  const state = await fixtureState(ashby.fixture);

  expect(state.applicationRequests).toBe(1);
  expect(state.submissions).toBe(1);

  expect(ashby.fixture.state.lastForm["_systemfield_name"]).toBe("Maya Okafor");
  expect(ashby.fixture.state.lastForm["_systemfield_email"]).toBe("maya.okafor@example.com");
  expect(ashby.fixture.state.lastForm["ab4fc714-5c54-42c3-afef-f8899dad9f99"]).toBe(
    "https://www.linkedin.com/in/maya-okafor",
  );
  expect(ashby.fixture.state.lastForm["_systemfield_location"]).toBe("London");
  expect(ashby.fixture.state.lastForm[SPONSORSHIP_GROUP]).toBe(SPONSORSHIP_NO);
  expect(ashby.fixture.state.lastResumeBytes).not.toBeNull();
  expect(
    Buffer.from(ashby.fixture.state.lastResumeBytes ?? new Uint8Array()).toString("base64"),
  ).toBe(Buffer.from(resumeBytes).toString("base64"));

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(200);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);
});

test("a live form missing a planned field returns the Application to Ready with what changed", async ({
  ashby,
}) => {
  const recorded = recordedAshbyFormQuestions("volta", "123e02c6-445b-42bb-893c-addb1f6d4752");

  const { applicationId, owner } = await seededApplication(
    ashby,
    [...baseFacts, sponsorshipFact, { key: "years_total", value: "5", scope: "" }],
    {
      questions: [
        ...recorded.map((question) => ({
          fieldName: question.fieldName,
          fieldType: question.fieldType,
          options: question.options,
          required: question.required,
          text: question.label,
        })),
        {
          answerKind: "fact" as const,
          factKey: "years_total",
          fieldName: "question_years_total",
          fieldType: "number" as const,
          required: true,
          text: "How many years of experience do you have?",
        },
      ],
    },
  );

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("ready");
  expect(detail.application.approvedAt).toBeNull();
  expect(detail.application.approvedPlanSha256).toBeNull();
  expect(JSON.parse(detail.application.changes ?? "[]")).toEqual(["A field was removed"]);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("form_changed");
  expect(attempts[0]?.submitClickedAt).toBeNull();

  expect((await fixtureState(ashby.fixture)).submissions).toBe(0);
});

test("an Ashby 2xx without the success page stays Confirming and is never called sent", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(ashby, [...baseFacts, sponsorshipFact], {
    query: "?blank=1",
  });

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("confirming");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("unconfirmed");
  expect(attempts[0]?.submitResponseStatus).toBe(200);
  expect(attempts[0]?.submitClickedAt).not.toBeNull();

  expect((await fixtureState(ashby.fixture)).applicationRequests).toBe(1);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);
});

const answersSchema = z.object({
  answers: z.array(
    z.object({
      text: z.string(),
      required: z.boolean(),
      resolved: z.boolean(),
      answer: z.string().nullable(),
    }),
  ),
});

async function preparedAnswers(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/prepared-answers?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return answersSchema.parse(await response.json()).answers;
}

test("an Ashby send answers a yes/no question from a Fact and presses its option", async ({
  ashbyYesNo,
}) => {
  const { applicationId, owner } = await seededApplication(ashbyYesNo, [
    ...baseFacts,
    { key: "work_auth", value: "Citizen", scope: "" },
  ]);

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot?.confirmedBy).toBe("page");

  const answers = new Map(detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]));

  expect(answers.get("Do you have work authorization to work in that country?")).toBe("Yes");

  const state = await fixtureState(ashbyYesNo.fixture);

  expect(state.submissions).toBe(1);
  expect(ashbyYesNo.fixture.state.lastForm["1323b323-1e0c-45e7-bcf7-b49e37897e1d"]).toBe("Yes");

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("sent");
});

test("an Ashby send reads a yes/no question as its options and a bare Location as the city", async ({
  ashbyLocation,
}) => {
  const { applicationId, owner } = await seededApplication(ashbyLocation, baseFacts, {
    questions: [
      {
        answerKind: "fact",
        factKey: "current_city",
        fieldName: "_systemfield_location",
        fieldType: "text",
        required: true,
        text: "Location",
      },
      {
        answerKind: "fact",
        factKey: "work_auth",
        fieldName: "c60c5d97-5e0f-4258-a5fa-a5b1095af145",
        fieldType: "radio",
        options: ["Yes", "No"],
        required: true,
        text: "Are you legally authorized to work in Canada?",
      },
    ],
  });

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");

  const reviews = await reviewsOf(owner);

  const canada = reviews.find((review) =>
    review.prompt.startsWith("Are you legally authorized to work in Canada?"),
  );

  expect(canada).toMatchObject({ fieldType: "radio", options: ["Yes", "No"] });
  expect(reviews.some((review) => review.prompt === "Location")).toBe(false);

  const location = (await preparedAnswers(owner, applicationId)).find(
    (answer) => answer.text === "Location",
  );

  expect(location).toMatchObject({ resolved: true, answer: "London" });

  expect((await fixtureState(ashbyLocation.fixture)).submissions).toBe(0);
});
