import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { greenhouseBoardUrl } from "../../src/server/pipeline/greenhouse-board-url.ts";
import { runGreenhouseAttempt } from "../../src/server/dispatch/ats/greenhouse.ts";
import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
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

interface SendHarness {
  fixture: GreenhouseFixture;
  server: AppServer;
  sessionDirectory: string;
}

const test = appTest.extend<{ send: SendHarness }>({
  send: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-first-send-"));
      const fixture = startGreenhouseFixture();
      const sessionDirectory = join(directory, "browsers");

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: sessionDirectory,
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
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
  stage: z.string().nullable(),
  sentAt: z.union([z.number(), z.string()]).nullable(),
  attempts: z.number(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const attemptSchema = z.object({
  id: z.string(),
  n: z.number(),
  outcome: z.string().nullable(),
  submitClickedAt: z.number().nullable(),
  submitResponseStatus: z.number().nullable(),
  errorCode: z.string().nullable(),
  browserMs: z.number().nullable(),
  proxyBytes: z.number().nullable(),
  costMicros: z.number().nullable(),
  endedAt: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

const boardSchema = z.object({
  columns: z.array(
    z.object({
      stage: z.string(),
      cards: z.array(
        z.object({
          id: z.string(),
          company: z.string(),
          title: z.string(),
          status: z.string(),
          stage: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const snapshotSchema = z.object({
  answers: z.array(
    z.object({
      answer: z.string().nullable(),
      fact_key: z.string().nullable(),
      fact_revision: z.number().nullable(),
      kind: z.string(),
      label: z.string(),
      question_id: z.string(),
      resume_line_ids: z.array(z.string()),
    }),
  ),
  confirmedBy: z.string(),
  consentVersion: z.string(),
  costMicros: z.number(),
  coverLetter: z
    .array(z.object({ sentence: z.string(), resume_line_ids: z.array(z.string()) }))
    .nullable(),
  provider: z.string(),
  resumeSha256: z.string(),
  submittedAt: z.number(),
});

const applicationDetailSchema = z.object({
  application: applicationRowSchema.extend({
    statusReason: z.string().nullable(),
  }),
  snapshot: snapshotSchema.nullable(),
});

const fixtureStateSchema = z.object({
  submissions: z.number(),
  applicationRequests: z.number(),
  formLoads: z.number(),
  confirmationLoads: z.number(),
});

const homeSchema = z.object({
  applicationsLeft: z.number(),
});

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
  { key: "website_url", value: "https://maya-okafor.example" },
];

const blankStreetQuestions = [
  {
    text: "First Name",
    fieldName: "first_name",
    fieldType: "text" as const,
    factKey: "legal_name",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Last Name",
    fieldName: "last_name",
    fieldType: "text" as const,
    factKey: "legal_name",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Email",
    fieldName: "email",
    fieldType: "email" as const,
    factKey: "email",
    answerKind: "fact" as const,
    required: true,
  },
  {
    text: "Phone",
    fieldName: "phone",
    fieldType: "phone" as const,
    factKey: "phone",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "Country",
    fieldName: "country",
    fieldType: "select" as const,
    options: ["Canada", "United Kingdom", "United States"],
    factKey: "current_country",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "LinkedIn Profile",
    fieldName: "question_32895467003",
    fieldType: "url" as const,
    factKey: "linkedin_url",
    answerKind: "fact" as const,
    required: false,
  },
  {
    text: "Website",
    fieldName: "question_32895468003",
    fieldType: "text" as const,
    answerKind: "open_text" as const,
    required: false,
  },

  {
    text: "Resume/CV",
    fieldName: "resume",
    fieldType: "file" as const,
    answerKind: "skip" as const,
    required: true,
  },
];

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  return { owner, userId };
}

async function uploadResume(owner: APIRequestContext) {
  const response = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor.pdf",
      },
    },
  });

  expect(response.ok()).toBe(true);
}

async function saveFacts(owner: APIRequestContext) {
  const response = await owner.put("/api/profile/facts", { data: { facts } });

  expect(response.ok()).toBe(true);
}

async function seedBlankStreetPosting(owner: APIRequestContext, fixtureUrl: string) {
  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  return seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: blankStreetQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${fixtureUrl}/blankstreet/jobs/8004209003`,
  });
}

async function runSend(owner: APIRequestContext, applicationId: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
  });

  return response;
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`);

  return applicationDetailSchema.parse(await response.json());
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function boardOf(owner: APIRequestContext) {
  return boardSchema.parse(await (await owner.get("/api/board")).json());
}

async function fixtureState(fixture: GreenhouseFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

async function applicationsOf(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`);

  return applicationsSchema.parse(await response.json()).applications;
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sessionRecords(sessionDirectory: string) {
  return readdirSync(sessionDirectory).filter((name) => name.endsWith(".json"));
}

const questionsSchema = z.object({
  questions: z.array(z.object({ questionId: z.string(), text: z.string() })),
});

async function seedOpenText(
  owner: APIRequestContext,
  userId: string,
  applicationId: string,
  postingId: string,
  answers: { text: string; kind: "open_text" | "cover_letter"; sentence: string }[],
) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  const { questions } = questionsSchema.parse(await response.json());

  await Promise.all(
    answers.map(async (answer) => {
      const question = questions.find((candidate) => candidate.text === answer.text);

      if (question === undefined) {
        throw new Error(`no seeded question for ${answer.text}`);
      }

      const seeded = await owner.post("/__test__/application-answers", {
        data: {
          applicationId,
          questionId: question.questionId,
          kind: answer.kind,
          sentences: [{ sentence: answer.sentence, resumeLineIds: [`${answer.kind}-line`] }],
        },
      });

      expect(seeded.ok()).toBe(true);
    }),
  );
}

async function readyApplication(harness: SendHarness) {
  const { owner, userId } = await ownerFor(harness.server);

  await uploadResume(owner);
  await saveFacts(owner);

  const postingId = await seedBlankStreetPosting(owner, harness.fixture.url);

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await seedOpenText(owner, userId, applicationId, postingId, [
    {
      text: "Website",
      kind: "open_text",
      sentence: "I build backend platforms for payments teams.",
    },
  ]);

  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);

  return { applicationId, owner, userId };
}

test("a ready Application on the recorded Greenhouse form ends sent, charged once, with an immutable Snapshot and an Applied card", async ({
  send,
}) => {
  const { applicationId, owner } = await readyApplication(send);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot).not.toBeNull();

  const { snapshot } = detail;

  if (snapshot === null) {
    throw new Error("the sent Application has no Snapshot");
  }

  expect(snapshot.confirmedBy).toBe("page");
  expect(snapshot.provider).toBe("local");
  expect(snapshot.consentVersion).toBe("m1");
  expect(snapshot.resumeSha256).toBe(sha256Hex(resumeBytes));
  const answers = new Map(snapshot.answers.map((answer) => [answer.label, answer]));

  expect(snapshot.coverLetter).toBeNull();

  expect(answers.get("First Name")?.answer).toBe("Maya");
  expect(answers.get("Last Name")?.answer).toBe("Okafor");
  expect(answers.get("Email")?.answer).toBe("maya.okafor@example.com");
  expect(answers.get("Country")?.answer).toBe("United Kingdom");
  expect(answers.get("Website")?.answer).toBe("I build backend platforms for payments teams.");
  expect(answers.get("Website")?.resume_line_ids).toEqual(["open_text-line"]);
  expect(answers.get("LinkedIn Profile")?.fact_key).toBe("linkedin_url");
  expect(answers.get("LinkedIn Profile")?.fact_revision).toBe(1);
  expect(answers.get("Resume/CV")?.kind).toBe("file");
  expect(answers.get("Resume/CV")?.answer).toBe("maya-okafor.pdf");

  const state = await fixtureState(send.fixture);

  expect(state.applicationRequests).toBe(1);
  expect(send.fixture.state.lastForm["email"]).toBe("maya.okafor@example.com");
  expect(send.fixture.state.lastForm["first_name"]).toBe("Maya");
  expect(send.fixture.state.lastChoices["country"]).toBe("United Kingdom");
  expect(send.fixture.state.lastForm["question_32895468003"]).toBe(
    "I build backend platforms for payments teams.",
  );
  expect(send.fixture.state.lastResumeBytes).not.toBeNull();
  expect(
    send.fixture.state.lastResumeBytes === null
      ? ""
      : Buffer.from(send.fixture.state.lastResumeBytes).toString("base64"),
  ).toBe(Buffer.from(resumeBytes).toString("base64"));

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.browserMs).not.toBeNull();
  expect(attempts[0]?.proxyBytes).toBe(0);
  expect(attempts[0]?.costMicros).toBe(0);

  const board = await boardOf(owner);
  const applied = board.columns.find((column) => column.stage === "applied");

  expect(applied?.cards.map((card) => card.id)).toContain(applicationId);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);

  const tampered = await owner.post("/__test__/snapshots/tamper", {
    data: { action: "update", applicationId },
  });

  const updateRefusal = z
    .object({ refused: z.boolean(), refusal: z.string().nullable() })
    .parse(await tampered.json());

  expect(updateRefusal.refused).toBe(true);

  const deleted = await owner.post("/__test__/snapshots/tamper", {
    data: { action: "delete", applicationId },
  });

  const deleteRefusal = z
    .object({ refused: z.boolean(), refusal: z.string().nullable() })
    .parse(await deleted.json());

  expect(deleteRefusal.refused).toBe(true);

  const unchanged = await applicationOf(owner, applicationId);

  expect(unchanged.snapshot?.consentVersion).toBe("m1");
});

test("a 4xx answer to the application request leaves submit_clicked_at unset and charges nothing", async ({
  send,
}) => {
  const { owner, userId } = await ownerFor(send.server);

  await uploadResume(owner);
  await saveFacts(owner);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: blankStreetQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${send.fixture.url}/blankstreet/jobs/8004209003`,
  });

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);
  send.fixture.state.refuse = true;

  await runSend(owner, applicationId);

  const [application] = await applicationsOf(owner, userId);
  const attempts = await attemptsOf(owner, applicationId);

  expect(application?.status).toBe("approved");
  expect(attempts.length).toBe(1);
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(403);
  expect(attempts[0]?.outcome).toBe("blocked");

  const state = await fixtureState(send.fixture);

  expect(state.applicationRequests).toBe(1);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.snapshot).toBeNull();

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(3);
});

test("a kill before submit_clicked_at releases the Application, stops its browser and a later send submits once", async ({
  send,
}) => {
  const { applicationId, owner, userId } = await readyApplication(send);

  await fetch(`${send.fixture.url}/__fixture__/hold`, {
    method: "POST",
    body: JSON.stringify({ form: true }),
    headers: { "content-type": "application/json" },
  });

  const sending = (async () => {
    try {
      await runSend(owner, applicationId);
    } catch {
      return null;
    }

    return null;
  })();

  await expect.poll(async () => (await fixtureState(send.fixture)).formLoads).toBeGreaterThan(0);

  expect(sessionRecords(send.sessionDirectory).length).toBe(1);

  await send.server.crash();

  await sending;
  await fetch(`${send.fixture.url}/__fixture__/release`, { method: "POST" });

  await send.server.restart();

  await expect.poll(() => sessionRecords(send.sessionDirectory).length).toBe(0);

  const recovered = await ownerContextFor(send.server.url);
  const [application] = await applicationsOf(recovered.owner, userId);
  const attempts = await attemptsOf(recovered.owner, applicationId);

  expect(application?.status).toBe("approved");
  expect(application?.attempts).toBe(0);
  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("interrupted");
  expect(attempts[0]?.submitClickedAt).toBeNull();

  await runSend(recovered.owner, applicationId);

  const detail = await applicationOf(recovered.owner, applicationId);

  expect(detail.application.status).toBe("sent");

  const state = await fixtureState(send.fixture);

  expect(state.applicationRequests).toBe(1);

  const home = homeSchema.parse(await (await recovered.owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);
});

test("a kill after submit_clicked_at goes to Confirming, is never resent, and keeps the Snapshot unwritten", async ({
  send,
}) => {
  const { applicationId, owner, userId } = await readyApplication(send);

  await fetch(`${send.fixture.url}/__fixture__/hold`, {
    method: "POST",
    body: JSON.stringify({ confirmation: true }),
    headers: { "content-type": "application/json" },
  });

  const sending = (async () => {
    try {
      await runSend(owner, applicationId);
    } catch {
      return null;
    }

    return null;
  })();

  await expect
    .poll(async () => (await fixtureState(send.fixture)).confirmationLoads)
    .toBeGreaterThan(0);

  await send.server.crash();

  await sending;
  await fetch(`${send.fixture.url}/__fixture__/release`, { method: "POST" });

  await send.server.restart();

  const recovered = await ownerContextFor(send.server.url);
  const [application] = await applicationsOf(recovered.owner, userId);
  const attempts = await attemptsOf(recovered.owner, applicationId);

  expect(application?.status).toBe("confirming");
  expect(attempts.length).toBe(1);
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(201);

  const before = await fixtureState(send.fixture);

  expect(before.applicationRequests).toBe(1);

  await runSend(recovered.owner, applicationId);

  const after = await fixtureState(send.fixture);

  expect(after.applicationRequests).toBe(1);

  const detail = await applicationOf(recovered.owner, applicationId);

  expect(detail.application.status).toBe("confirming");
  expect(detail.snapshot).toBeNull();
});

test("a redirect to another board skips the Application with a reason and never submits", async ({
  send,
}) => {
  const { owner, userId } = await ownerFor(send.server);

  await uploadResume(owner);
  await saveFacts(owner);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: blankStreetQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${send.fixture.url}/blankstreet/jobs/8004209003`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);
  send.fixture.state.redirect = "board";

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("skipped");
  expect(detail.application.statusReason).toBe("posting_identity:board_token");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("identity_mismatch");
  expect(attempts[0]?.errorCode).toBe("board_token");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBeNull();

  const state = await fixtureState(send.fixture);

  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(3);
});

test("a page showing another company skips the Application with a reason and never submits", async ({
  send,
}) => {
  const { owner, userId } = await ownerFor(send.server);

  await uploadResume(owner);
  await saveFacts(owner);

  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "blankstreet");

  const postingId = await seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: blankStreetQuestions,
    tags: [{ dimension: "subrole", value: "Operations" }],
    title: "Assistant General Manager | Durham",
    url: `${send.fixture.url}/blankstreet/jobs/8004209003`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 3);
  await approveApplication(owner, applicationId);
  send.fixture.state.redirect = "company";

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("skipped");
  expect(detail.application.statusReason).toBe("posting_identity:company");
  expect(detail.snapshot).toBeNull();

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts.length).toBe(1);
  expect(attempts[0]?.outcome).toBe("identity_mismatch");
  expect(attempts[0]?.errorCode).toBe("company");
  expect(attempts[0]?.submitClickedAt).toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBeNull();

  const state = await fixtureState(send.fixture);

  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(3);
});

const recordedStripeJob = z
  .object({ title: z.string(), absolute_url: z.string() })
  .parse(JSON.parse(readFileSync("test/e2e/fixtures/greenhouse/stripe/jobs/8172510.json", "utf8")));

class StopBeforeSubmitError extends Error {
  override name = "StopBeforeSubmitError";
}

test("a Greenhouse posting whose absolute_url is on the company site opens its embed form, passes the identity check and stops before Submit", async ({
  send,
  page,
}) => {
  const url = greenhouseBoardUrl({
    atsJobId: "8172510",
    boardToken: "stripe",
    origin: send.fixture.url,
    region: "us",
  });

  expect(url).not.toBe(recordedStripeJob.absolute_url);

  let reachedSubmit = false;

  const run = await runGreenhouseAttempt(
    page,
    {
      fields: [],
      identity: {
        ats: "greenhouse",
        boardToken: "stripe",
        companyName: "Stripe",
        jobId: "8172510",
        url,
      },
      resume: null,
    },
    {
      onCodeTyped: () => undefined,
      onResponse: () => undefined,
      requestCode: () => {
        throw new StopBeforeSubmitError("no code is requested before Submit");
      },
      onWillSubmit: () => {
        reachedSubmit = true;
        throw new StopBeforeSubmitError("stop before Submit");
      },
    },
  );

  expect(run.outcome).toBe("needs_review");
  expect(run.submitMayHaveLanded).toBe(false);
  expect(reachedSubmit).toBe(false);
  expect(page.url()).toBe(url);

  const state = await fixtureState(send.fixture);

  expect(state.formLoads).toBe(1);
  expect(state.applicationRequests).toBe(0);
  expect(state.submissions).toBe(0);
});
