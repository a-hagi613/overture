import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { WorkableFixture } from "./workable.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startWorkableFixture } from "./workable.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface WorkableHarness {
  fixture: WorkableFixture;
  server: AppServer;
  sessionDirectory: string;
}

const JOB_ID = "WK-1001";
const TITLE = "Senior Platform Engineer";

const SPONSORSHIP_PROMPT =
  "Will you now, or in the future, require visa sponsorship to legally work in the country where this role is based?";

const SPONSORSHIP_NO =
  "No, I do not require sponsorship to work in the country where this role is located";

const startWorkableHarness = async (
  identityServer: IdentityServer,
  formBaseUrl: (fixture: WorkableFixture) => string = (fixture) => fixture.url,
) => {
  const directory = mkdtempSync(join(tmpdir(), "overture-workable-send-"));
  const fixture = startWorkableFixture({ jobId: JOB_ID, title: TITLE });
  const sessionDirectory = join(directory, "browsers");

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: sessionDirectory,
    WORKABLE_FORM_BASE_URL: formBaseUrl(fixture),
  });

  return { fixture, server, sessionDirectory };
};

async function provideWorkableHarness(
  identityServer: IdentityServer,
  provide: (harness: WorkableHarness) => Promise<void>,
  formBaseUrl?: (fixture: WorkableFixture) => string,
) {
  const harness = await startWorkableHarness(identityServer, formBaseUrl);

  try {
    await provide(harness);
  } finally {
    await harness.server.stop();
    harness.fixture.close();
  }
}

const test = appTest.extend<{ workable: WorkableHarness }>({
  workable: [
    async ({ identityServer }, provide) => provideWorkableHarness(identityServer, provide),
    { scope: "test" },
  ],
});

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

const homeSchema = z.object({ applicationsLeft: z.number() });

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const baseFacts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+44 20 7946 0018", scope: "" },
];

const sponsorshipFact = { key: "sponsorship_required", value: SPONSORSHIP_NO, scope: "" };

async function ownerFor(server: AppServer, enableWorkable = true) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  if (enableWorkable) {
    await owner.put("/__test__/kill-switches/ats/workable", {
      data: { enabled: false, reason: "the fixture probe passed" },
    });
  }

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
  harness: WorkableHarness,
  facts: typeof baseFacts,
  enableWorkable = true,
  postingUrl = `${harness.fixture.url}/j/${JOB_ID}`,
) {
  const { owner, userId } = await ownerFor(harness.server, enableWorkable);

  await prepareProfile(owner, facts);

  const companyId = await seedCompany(owner, "Workable Corp", "workable.example");
  const boardId = await seedBoard(owner, companyId, "workable", "workable-corp");

  const postingId = await seedPosting(owner, {
    ats: "workable",
    atsJobId: JOB_ID,
    boardId,
    companyId,
    title: TITLE,
    url: postingUrl,
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

test("Workable preparation stays off while the ATS kill switch is engaged", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(workable, baseFacts, false);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("skipped");
  expect(detail.application.statusReason).toBe("ats_not_enabled");
  expect(workable.fixture.state.formLoads).toBe(0);
  expect(workable.fixture.state.submissions).toBe(0);
});

test("an unanswerable required Workable question opens a Review during preparation and nothing is submitted", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(workable, baseFacts);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("needs_review");
  expect(detail.application.statusReason).toBe("unknown_question");
  expect(detail.snapshot).toBeNull();

  expect(workable.fixture.state.submissions).toBe(0);
  expect(workable.fixture.state.applicationRequests).toBe(0);

  const { reviews } = reviewViewSchema.parse(await (await owner.get("/api/reviews")).json());

  expect(reviews.map((review) => review.prompt)).toEqual([SPONSORSHIP_PROMPT]);
  expect(reviews[0]?.fieldType).toBe("radio");
  expect(reviews[0]?.options).toEqual(["Yes", "No"]);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(0);
});

test("a Workable send fills the recorded form with the user's real email and ends sent only on the confirmation page", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(workable, [
    ...baseFacts,
    sponsorshipFact,
  ]);

  const prepared = await applicationOf(owner, applicationId);

  expect(prepared.application.status).toBe("ready");

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("sent");
  expect(detail.application.stage).toBe("applied");
  expect(detail.snapshot?.confirmedBy).toBe("page");

  const answers = new Map(detail.snapshot?.answers.map((answer) => [answer.label, answer.answer]));

  expect(answers.get("First name")).toBe("Maya");
  expect(answers.get("Last name")).toBe("Okafor");
  expect(answers.get("Email")).toBe("maya.okafor@example.com");
  expect(answers.get("Phone")).toBe("+44 20 7946 0018");
  expect(answers.get(SPONSORSHIP_PROMPT)).toBe("No");
  expect(answers.get("I agree to the privacy notice and the processing of my personal data.")).toBe(
    "Yes",
  );

  expect(workable.fixture.state.applicationRequests).toBe(1);
  expect(workable.fixture.state.submissions).toBe(1);
  expect(workable.fixture.state.lastForm["firstname"]).toBe("Maya");
  expect(workable.fixture.state.lastForm["lastname"]).toBe("Okafor");
  expect(workable.fixture.state.lastForm["email"]).toBe("maya.okafor@example.com");
  expect(workable.fixture.state.lastForm["QA_1001"]).toBe("No");
  expect(workable.fixture.state.lastForm["QA_1003"]).toBe("Yes");
  expect(
    Buffer.from(workable.fixture.state.lastResumeBytes ?? new Uint8Array()).toString("base64"),
  ).toBe(Buffer.from(resumeBytes).toString("base64"));

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("sent");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
  expect(attempts[0]?.submitResponseStatus).toBe(201);

  const home = homeSchema.parse(await (await owner.get("/api/home")).json());

  expect(home.applicationsLeft).toBe(2);
});

test("a live Workable form missing a planned field returns the Application to Ready with what changed", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(workable, [
    ...baseFacts,
    sponsorshipFact,
  ]);

  workable.fixture.state.omitField = "lastname";

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

  expect(workable.fixture.state.submissions).toBe(0);
});

test("a Workable form the plain endpoint cannot serve is captured in a browser and still sends", async ({
  identityServer,
}) => {
  await provideWorkableHarness(
    identityServer,
    async (harness) => {
      const { applicationId, owner } = await seededApplication(harness, [
        ...baseFacts,
        sponsorshipFact,
      ]);

      const prepared = await applicationOf(owner, applicationId);

      expect(prepared.application.status).toBe("ready");

      await approveForSend(owner, applicationId);

      const response = await runSend(owner, applicationId);

      expect(response.ok()).toBe(true);

      const detail = await applicationOf(owner, applicationId);

      expect(detail.application.status).toBe("sent");
      expect(harness.fixture.state.submissions).toBe(1);
      expect(harness.fixture.state.lastForm["firstname"]).toBe("Maya");
      expect(detail.snapshot?.confirmedBy).toBe("page");
    },
    (fixture) => `${fixture.url}/unavailable`,
  );
});

test("a Workable 2xx without the confirmation page stays confirming and is never called sent", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(workable, [
    ...baseFacts,
    sponsorshipFact,
  ]);

  workable.fixture.state.confirmation = "none";

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("confirming");
  expect(detail.snapshot).toBeNull();
  expect(workable.fixture.state.submissions).toBe(1);

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("unconfirmed");
  expect(attempts[0]?.submitClickedAt).not.toBeNull();
});

test("a Workable page whose shortcode differs from the approved plan is skipped without submitting", async ({
  workable,
}) => {
  const { applicationId, owner } = await seededApplication(
    workable,
    [...baseFacts, sponsorshipFact],
    true,
    `${workable.fixture.url}/j/WK-9999`,
  );

  await approveForSend(owner, applicationId);

  const response = await runSend(owner, applicationId);

  expect(response.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("skipped");
  expect(detail.application.statusReason).toBe("posting_identity:job_id");
  expect(detail.snapshot).toBeNull();
  expect(workable.fixture.state.submissions).toBe(0);
  expect(workable.fixture.state.pageJobId).toBe("WK-9999");

  const attempts = await attemptsOf(owner, applicationId);

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.outcome).toBe("identity_mismatch");
});
