import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AshbyFixture } from "./ashby.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAshbyFixture } from "./ashby.fixture.ts";
import {
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
}

const JOB_ID = "123e02c6-445b-42bb-893c-addb1f6d4752";
const BOARD_TOKEN = "volta";

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const SPONSORSHIP_NO =
  "No, I do not require sponsorship to work in the country where this role is located";

const SPONSORSHIP_GROUP =
  "aff810b3-1f77-4e76-950f-6c5dfb53f847_d2dcc981-709b-4026-ae4f-d6f6d613e982";

const test = appTest.extend<{ ashby: AshbyHarness }>({
  ashby: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-ashby-send-"));
      const fixture = startAshbyFixture();
      const sessionDirectory = join(directory, "browsers");

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: sessionDirectory,
      });

      await provide({ fixture, server, sessionDirectory });
      await server.stop();
      fixture.close();
    },
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

async function seededApplication(harness: AshbyHarness, facts: typeof baseFacts, query = "") {
  const { owner, userId } = await ownerFor(harness.server);

  await prepareProfile(owner, facts);

  const companyId = await seedCompany(owner, "Volta", "volta.example");
  const boardId = await seedBoard(owner, companyId, "ashby", BOARD_TOKEN);

  const postingId = await seedPosting(owner, {
    ats: "ashby",
    atsJobId: JOB_ID,
    boardId,
    companyId,
    title: "Senior Project Manager - CTO Support",
    url: `${harness.fixture.url}/${BOARD_TOKEN}/${JOB_ID}/application${query}`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 3);

  return { applicationId, owner, userId };
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

test("an unknown required Ashby question opens a Review and nothing is submitted", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(ashby, baseFacts);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");
  expect(detail.application.statusReason).toBe("unknown_question");
  expect(detail.application.stage).toBe("queued");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("needs_review");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBeNull();

  const state = await fixtureState(ashby.fixture);

  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);

  const reviews = await reviewsOf(owner);

  expect(reviews.map((review) => review.prompt)).toEqual([SPONSORSHIP_PROMPT]);
  expect(reviews[0]?.fieldType).toBe("radio");
  expect(reviews[0]?.options).toContain(SPONSORSHIP_NO);
  expect(reviews[0]?.unlocked).toBe(1);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(3);
});

test("an Ashby send fills the recorded form and ends sent only on the success page", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(ashby, [...baseFacts, sponsorshipFact]);

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

test("an Ashby 2xx without the success page stays Confirming and is never called sent", async ({
  ashby,
}) => {
  const { applicationId, owner } = await seededApplication(
    ashby,
    [...baseFacts, sponsorshipFact],
    "?blank=1",
  );

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
