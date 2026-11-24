import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { HostedBoardsFixture } from "./batch4-ats.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { HOSTED_BOARD_NAMES, startHostedBoardsFixture } from "./batch4-ats.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

type Board = (typeof HOSTED_BOARD_NAMES)[number];

const JOB_ID = "B4-1001";
const TITLE = "Senior Platform Engineer";
const COMPANY = "Batch Four Corp";

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const SPONSORSHIP_NO =
  "No, I do not require sponsorship to work in the country where this role is located";

const PRIVACY_PROMPT = "I agree to the privacy notice and the processing of my personal data.";

const UNANSWERABLE_PROMPT = "What is your current job title?";

const WAVE_1B: readonly Board[] = ["isolved_hire", "applicantpro", "catsone", "onlyfy", "varbi"];

const WAVE_1A: readonly Board[] = ["hiringthing", "rippling", "gem"];

interface HostedHarness {
  fixture: HostedBoardsFixture;
  server: AppServer;
}

const startHostedHarness = async (identityServer: Parameters<typeof startFreshAppServer>[0]) => {
  const directory = mkdtempSync(join(tmpdir(), "overture-batch4-ats-"));
  const fixture = startHostedBoardsFixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: join(directory, "browsers"),
  });

  return { fixture, server } satisfies HostedHarness;
};

async function withHarness(
  identityServer: Parameters<typeof startFreshAppServer>[0],
  provide: (harness: HostedHarness) => Promise<void>,
) {
  const harness = await startHostedHarness(identityServer);

  try {
    await provide(harness);
  } finally {
    await harness.server.stop();
    harness.fixture.close();
  }
}

const test = appTest.extend<{ hosted: HostedHarness }>({
  hosted: [
    async ({ identityServer }, provide) => withHarness(identityServer, provide),
    { scope: "test" },
  ],
});

test.describe.configure({ timeout: 120_000 });

const applicationRowSchema = z.object({
  approvedAt: z.number().nullable(),
  approvedPlanSha256: z.string().nullable(),
  changes: z.string().nullable(),
  id: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  stage: z.string().nullable(),
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

const reviewViewSchema = z.object({
  reviews: z.array(z.object({ prompt: z.string(), fieldType: z.string() })),
});

const homeSchema = z.object({ applicationsLeft: z.number() });

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const baseFacts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+44 20 7946 0018", scope: "" },
  { key: "sponsorship_required", value: SPONSORSHIP_NO, scope: "" },
];

async function ownerFor(server: AppServer, board: Board) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });
  expect((await owner.post("/api/running", { data: { running: true } })).ok()).toBe(true);
  expect(
    (
      await owner.put(`/__test__/kill-switches/ats/${board}`, {
        data: { enabled: false, reason: "the fixture probe passed" },
      })
    ).ok(),
  ).toBe(true);

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

  const saved = await owner.put("/api/profile/facts", { data: { facts: baseFacts } });

  expect(saved.ok()).toBe(true);

  return { owner, userId };
}

async function seededApplication(
  harness: HostedHarness,
  board: Board,
  input: { gated?: boolean; wrongJob?: boolean } = {},
) {
  const { owner, userId } = await ownerFor(harness.server, board);

  const companyId = await seedCompany(owner, COMPANY, "batch-four.example");
  const boardId = await seedBoard(owner, companyId, board, `${board}-corp`);
  const jobId = input.wrongJob === true ? "B4-9999" : JOB_ID;
  const path = input.gated === true ? "gated" : "apply";

  const postingId = await seedPosting(owner, {
    ats: board,
    atsJobId: JOB_ID,
    boardId,
    companyId,
    title: TITLE,
    url: `${harness.fixture.url}/${board}/${path}/${jobId}`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

  return { applicationId, boardId, owner, postingId, userId };
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

async function applicationsLeft(owner: APIRequestContext) {
  return homeSchema.parse(await (await owner.get("/api/home")).json()).applicationsLeft;
}

for (const board of HOSTED_BOARD_NAMES) {
  test(`${board}: preparation waits for approval, then the approved plan sends the real answers`, async ({
    hosted,
  }) => {
    const { applicationId, owner } = await seededApplication(hosted, board);
    const prepared = await applicationOf(owner, applicationId);

    expect(prepared.application.status).toBe("ready");
    expect(hosted.fixture.state[board].submissions).toBe(0);
    expect(hosted.fixture.state[board].applicationRequests).toBe(0);

    await approveForSend(owner, applicationId);

    const response = await runSend(owner, applicationId);

    expect(response.ok()).toBe(true);

    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("sent");
    expect(detail.application.stage).toBe("applied");
    expect(detail.snapshot?.confirmedBy).toBe("page");

    const answers = new Map(
      detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]),
    );

    expect(answers.get("First name")).toBe("Maya");
    expect(answers.get("Last name")).toBe("Okafor");
    expect(answers.get("Email")).toBe("maya.okafor@example.com");
    expect(answers.get("Phone")).toBe("+44 20 7946 0018");
    expect(answers.get(SPONSORSHIP_PROMPT)).toBe("No");
    expect(answers.get(PRIVACY_PROMPT)).toBe("Yes");

    const state = hosted.fixture.state[board];

    expect(state.applicationRequests).toBe(1);
    expect(state.submissions).toBe(1);
    expect(state.lastForm["first_name"]).toBe("Maya");
    expect(state.lastForm["last_name"]).toBe("Okafor");
    expect(state.lastForm["email"]).toBe("maya.okafor@example.com");
    expect(state.lastForm["sponsorship_required"]).toBe("No");
    expect(state.lastForm["privacy_consent"]).toBe("Yes");
    expect(Buffer.from(state.lastResumeBytes ?? new Uint8Array()).toString("base64")).toBe(
      Buffer.from(resumeBytes).toString("base64"),
    );

    const attempts = await attemptsOf(owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("sent");
    expect(attempts[0]?.submitClickedAt).not.toBeNull();
    expect(attempts[0]?.submitResponseStatus).toBe(201);

    expect(await applicationsLeft(owner)).toBe(2);
  });

  test(`${board}: an unanswerable required question opens a Review and nothing is submitted`, async ({
    hosted,
  }) => {
    hosted.fixture.state[board].extraRequiredQuestion = true;

    const { applicationId, owner } = await seededApplication(hosted, board);
    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("needs_review");
    expect(detail.application.statusReason).toBe("unknown_question");
    expect(detail.snapshot).toBeNull();
    expect(hosted.fixture.state[board].submissions).toBe(0);
    expect(hosted.fixture.state[board].applicationRequests).toBe(0);

    const { reviews } = reviewViewSchema.parse(await (await owner.get("/api/reviews")).json());

    expect(reviews.map((review) => review.prompt)).toContain(UNANSWERABLE_PROMPT);
    expect(await applicationsLeft(owner)).toBe(0);
  });
}

for (const board of WAVE_1A) {
  test(`${board}: a changed form returns the Application to Ready without spending a credit`, async ({
    hosted,
  }) => {
    const { applicationId, owner } = await seededApplication(hosted, board);

    hosted.fixture.state[board].omitField = "last_name";

    await approveForSend(owner, applicationId);

    const response = await runSend(owner, applicationId);

    expect(response.ok()).toBe(true);

    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("ready");
    expect(detail.application.approvedAt).toBeNull();
    expect(JSON.parse(detail.application.changes ?? "[]")).toEqual(["The form changed"]);
    expect(hosted.fixture.state[board].submissions).toBe(0);
    expect(await applicationsLeft(owner)).toBe(3);

    const attempts = await attemptsOf(owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("form_changed");
    expect(attempts[0]?.submitClickedAt).toBeNull();
  });
}

for (const board of WAVE_1B) {
  test(`${board}: a mandatory login gate skips preparation as unsupported_login_required before any spend`, async ({
    hosted,
  }) => {
    const { applicationId, owner } = await seededApplication(hosted, board, { gated: true });
    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("skipped");
    expect(detail.application.statusReason).toBe("unsupported_login_required");
    expect(detail.snapshot).toBeNull();
    expect(hosted.fixture.state[board].submissions).toBe(0);
    expect(await applicationsLeft(owner)).toBe(0);
  });
}

test("a ready Application that was never approved is never submitted", async ({ hosted }) => {
  const { applicationId, owner } = await seededApplication(hosted, "hiringthing");

  expect((await applicationOf(owner, applicationId)).application.status).toBe("ready");

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);
  expect((await applicationOf(owner, applicationId)).application.status).toBe("ready");
  expect(hosted.fixture.state.hiringthing.submissions).toBe(0);
  expect(hosted.fixture.state.hiringthing.applicationRequests).toBe(0);
});

test("a 2xx without a confirmation page stays confirming and is never called sent", async ({
  hosted,
}) => {
  const { applicationId, owner } = await seededApplication(hosted, "rippling");

  hosted.fixture.state.rippling.confirmation = "none";

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("confirming");
  expect(detail.snapshot).toBeNull();
  expect(hosted.fixture.state.rippling.submissions).toBe(1);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("unconfirmed");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
});

test("a page whose job id differs from the approved plan is skipped without submitting", async ({
  hosted,
}) => {
  const { applicationId, owner } = await seededApplication(hosted, "gem", { wrongJob: true });

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("skipped");
  expect(detail.application.statusReason).toBe("posting_identity:job_id");
  expect(detail.snapshot).toBeNull();
  expect(hosted.fixture.state.gem.submissions).toBe(0);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("identity_mismatch");
});
