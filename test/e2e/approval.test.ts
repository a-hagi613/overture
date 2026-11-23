import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  approveApplication,
  clockNow,
  grantApplications,
  ownerContextFor,
  planShaFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface ApprovalHarness {
  fixture: GreenhouseFixture;
  server: AppServer;
}

const test = appTest.extend<{ approval: ApprovalHarness }>({
  approval: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-approval-"));
      const fixture = startGreenhouseFixture();

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: join(directory, "browsers"),
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        GREENHOUSE_FEED_BASE_URL: fixture.url,
        INBOUND_HMAC_SECRET: "inbound-test-secret",
      });

      await provide({ fixture, server });
      await server.stop();
      fixture.close();
    },
    { scope: "test" },
  ],
});

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
  { key: "website_url", value: "https://maya-okafor.example" },
];

const questions = [
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

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const cardSchema = z.object({
  changes: z.array(z.string()),
  id: z.string(),
  plan: z
    .object({
      answers: z.array(
        z.object({
          answer: z.string().nullable(),
          byUser: z.boolean(),
          label: z.string(),
          questionId: z.string(),
          source: z.string().nullable(),
        }),
      ),
      planSha256: z.string(),
    })
    .nullable(),
  queuePosition: z.number().nullable(),
  sendAt: z.number().nullable(),
  status: z.string(),
  title: z.string().nullable(),
});

const readySchema = z.object({
  approved: z.number(),
  cards: z.array(cardSchema),
  nextSendAt: z.number().nullable(),
  ready: z.number(),
});

const applicationRowSchema = z.object({
  approvedAt: z.number().nullable(),
  approvedPlanEnc: z.string().nullable(),
  approvedPlanSha256: z.string().nullable(),
  attempts: z.number(),
  changes: z.string().nullable(),
  closedReason: z.string().nullable(),
  id: z.string(),
  scheduledFor: z.number().nullable(),
  stage: z.string().nullable(),
  status: z.string(),
});

const applicationSchema = z.object({
  application: applicationRowSchema,
  timeline: z.array(
    z.object({
      fromValue: z.string().nullable(),
      kind: z.string(),
      source: z.string(),
      toValue: z.string().nullable(),
    }),
  ),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const sentDetailSchema = z.object({
  application: applicationRowSchema,
  snapshot: z
    .object({
      answers: z.array(
        z.object({
          answer: z.string().nullable(),
          by_user: z.boolean().optional(),
          label: z.string(),
          resume_line_ids: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
});

const jobsSchema = z.object({ jobs: z.array(z.object({ id: z.string(), kind: z.string() })) });

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });

const SEND_JOB = "application.send";

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  const running = await owner.post("/api/running", { data: { running: true } });

  expect(running.ok()).toBe(true);

  await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone: "UTC" } });

  return { owner, userId };
}

async function ensureMailbox(owner: APIRequestContext) {
  const response = await owner.get("/api/profile/mailbox");

  expect(response.ok()).toBe(true);
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

  await ensureMailbox(owner);
}

async function moveClockTo(owner: APIRequestContext, iso: string) {
  const state = clockSchema.parse(await (await owner.get("/__test__/clock")).json());

  const response = await owner.post("/__test__/clock/offset", {
    data: { offsetMs: state.offsetMs + (Date.parse(iso) - state.now) },
  });

  expect(response.ok()).toBe(true);
}

async function seedPostingFor(owner: APIRequestContext, fixtureUrl: string, suffix = "1") {
  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");
  const boardToken = suffix === "1" ? "blankstreet" : `blank-${suffix}`;
  const atsJobId = suffix === "1" ? "8004209003" : `80042090${suffix.padStart(2, "0")}`;
  const boardId = await seedBoard(owner, companyId, "greenhouse", boardToken);

  return seedPosting(owner, {
    atsJobId,
    boardId,
    companyId,
    questions,
    title: "Assistant General Manager | Durham",
    url: `${fixtureUrl}/${boardToken}/jobs/${atsJobId}`,
  });
}

async function readyApplication(harness: ApprovalHarness) {
  const { owner, userId } = await ownerFor(harness.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");
  await prepareProfile(owner);

  const postingId = await seedPostingFor(owner, harness.fixture.url);

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "ready",
    userId,
  });

  await grantApplications(owner, 5);

  return { applicationId, owner, postingId, userId };
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return applicationSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );
}

async function readyOf(owner: APIRequestContext) {
  return readySchema.parse(await (await owner.get("/api/ready")).json());
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  return applicationsSchema.parse(
    await (await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)).json(),
  ).applications;
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

async function sendJobIds(owner: APIRequestContext) {
  const { jobs } = jobsSchema.parse(await (await owner.get("/__test__/jobs")).json());

  return jobs.filter((job) => job.kind === SEND_JOB).map((job) => job.id);
}

async function fixtureState(fixture: GreenhouseFixture) {
  return z
    .object({ applicationRequests: z.number(), submissions: z.number() })
    .parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

test("Send freezes the plan with its SHA-256 and a sealed copy, and refuses a stale hash", async ({
  approval,
}) => {
  const { applicationId, owner } = await readyApplication(approval);

  const ready = await readyOf(owner);
  const card = ready.cards.find((candidate) => candidate.id === applicationId);

  expect(ready.ready).toBe(1);
  expect(card?.plan).not.toBeNull();
  expect(card?.status).toBe("ready");

  const planSha256 = card?.plan?.planSha256 ?? "";

  expect(planSha256).toHaveLength(64);
  expect(card?.plan?.answers.find((answer) => answer.label === "First Name")?.answer).toBe("Maya");

  const stale = await owner.post(`/api/applications/${encodeURIComponent(applicationId)}/approve`, {
    data: { planSha256: "0".repeat(64) },
  });

  expect(stale.status()).toBe(409);
  expect(z.object({ error: z.string() }).parse(await stale.json()).error).toBe("plan_changed");
  expect((await applicationOf(owner, applicationId)).application.status).toBe("ready");

  const approved = await owner.post(
    `/api/applications/${encodeURIComponent(applicationId)}/approve`,
    { data: { planSha256 } },
  );

  expect(approved.ok()).toBe(true);

  const detail = await applicationOf(owner, applicationId);

  expect(detail.application.status).toBe("approved");
  expect(detail.application.stage).toBe("ready");
  expect(detail.application.approvedAt).not.toBeNull();
  expect(detail.application.approvedPlanSha256).toBe(planSha256);
  expect(detail.application.approvedPlanEnc).not.toBeNull();
  expect(detail.application.approvedPlanEnc ?? "").not.toContain("maya.okafor@example.com");
  expect(
    detail.timeline.some(
      (event) =>
        event.kind === "status" &&
        event.fromValue === "ready" &&
        event.toValue === "approved" &&
        event.source === "user",
    ),
  ).toBe(true);

  const afterApproval = await readyOf(owner);

  expect(afterApproval.ready).toBe(0);
  expect(afterApproval.approved).toBe(1);
  expect(afterApproval.cards[0]?.status).toBe("approved");
  expect(afterApproval.cards[0]?.plan?.planSha256).toBe(planSha256);

  const again = await owner.post(`/api/applications/${encodeURIComponent(applicationId)}/approve`, {
    data: { planSha256 },
  });

  expect(again.status()).toBe(409);
  expect(z.object({ error: z.string() }).parse(await again.json()).error).toBe("not_ready");

  const missing = await owner.post(`/api/applications/${crypto.randomUUID()}/approve`, {
    data: { planSha256 },
  });

  expect(missing.status()).toBe(404);
});

test("Undo returns an approved Application to Ready, frees its slot and is refused once sending", async ({
  approval,
}) => {
  const { applicationId, owner, userId } = await readyApplication(approval);

  await approveApplication(owner, applicationId);
  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = await applicationOf(owner, applicationId);

  expect(planned.application.status).toBe("approved");
  expect(planned.application.scheduledFor).not.toBeNull();

  const undone = await owner.post(
    `/api/applications/${encodeURIComponent(applicationId)}/unapprove`,
  );

  expect(undone.ok()).toBe(true);

  const afterUndo = await applicationOf(owner, applicationId);

  expect(afterUndo.application.status).toBe("ready");
  expect(afterUndo.application.stage).toBe("ready");
  expect(afterUndo.application.approvedAt).toBeNull();
  expect(afterUndo.application.approvedPlanSha256).toBeNull();
  expect(afterUndo.application.approvedPlanEnc).toBeNull();
  expect(afterUndo.application.scheduledFor).toBeNull();
  expect(
    afterUndo.timeline.some((event) => event.fromValue === "approved" && event.toValue === "ready"),
  ).toBe(true);

  await approveApplication(owner, applicationId);

  const sending = await owner.post("/__test__/applications/status", {
    data: { applicationId, status: "sending", statusReason: null },
  });

  expect(sending.ok()).toBe(true);

  const refused = await owner.post(
    `/api/applications/${encodeURIComponent(applicationId)}/unapprove`,
  );

  expect(refused.status()).toBe(409);
});

test("Send all approves the cards in the order shown, reports a refused card and plans in approval order", async ({
  approval,
}) => {
  const { applicationId, owner, userId } = await readyApplication(approval);

  const secondPosting = await seedPostingFor(owner, approval.fixture.url, "2");
  const thirdPosting = await seedPostingFor(owner, approval.fixture.url, "3");

  const second = await seedApplication(owner, {
    postingId: secondPosting,
    status: "ready",
    userId,
  });

  const third = await seedApplication(owner, {
    postingId: thirdPosting,
    status: "ready",
    userId,
  });

  const firstSha = await planShaFor(owner, applicationId);
  const thirdSha = await planShaFor(owner, third);

  const sentAll = await owner.post("/api/ready/approve", {
    data: {
      items: [
        { id: applicationId, planSha256: firstSha },
        { id: second, planSha256: "f".repeat(64) },
        { id: third, planSha256: thirdSha },
      ],
    },
  });

  expect(sentAll.ok()).toBe(true);

  const result = z
    .object({
      approved: z.array(z.object({ id: z.string(), planSha256: z.string() })),
      refused: z.array(z.object({ error: z.string(), id: z.string() })),
    })
    .parse(await sentAll.json());

  expect(result.approved.map((entry) => entry.id)).toEqual([applicationId, third]);
  expect(result.refused).toEqual([{ error: "plan_changed", id: second }]);
  expect((await applicationOf(owner, second)).application.status).toBe("ready");
  expect((await applicationOf(owner, second)).application.changes).toBeNull();

  await moveClockTo(owner, "2026-03-11T00:05:00.000Z");
  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const rows = await applicationsFor(owner, userId);
  const firstRow = rows.find((row) => row.id === applicationId);
  const thirdRow = rows.find((row) => row.id === third);

  expect(firstRow?.scheduledFor).not.toBeNull();
  expect(thirdRow?.scheduledFor).not.toBeNull();
  expect(firstRow?.scheduledFor ?? 0).toBeLessThan(thirdRow?.scheduledFor ?? 0);

  const thirdSlot = thirdRow?.scheduledFor ?? null;

  expect(
    (await owner.post(`/api/applications/${encodeURIComponent(applicationId)}/unapprove`)).ok(),
  ).toBe(true);

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const afterUndo = await applicationsFor(owner, userId);

  expect(afterUndo.find((row) => row.id === applicationId)?.scheduledFor).toBeNull();
  expect(afterUndo.find((row) => row.id === third)?.scheduledFor).toBe(thirdSlot);
});

test("Skip withdraws a Ready or an Approved Application and never adds the company to the Skip list", async ({
  approval,
}) => {
  const { applicationId, owner, postingId, userId } = await readyApplication(approval);

  const skippedReady = await owner.post(
    `/api/applications/${encodeURIComponent(applicationId)}/withdraw`,
  );

  expect(skippedReady.ok()).toBe(true);
  expect((await applicationOf(owner, applicationId)).application.status).toBe("withdrawn");

  const withdrawnReady = await applicationOf(owner, applicationId);

  expect(withdrawnReady.application.stage).toBeNull();
  expect(withdrawnReady.application.closedReason).toBe("withdrawn");

  const secondPosting = await seedPostingFor(owner, approval.fixture.url, "2");

  const approvedId = await seedApplication(owner, {
    postingId: secondPosting,
    status: "ready",
    userId,
  });

  await approveApplication(owner, approvedId);

  const skippedApproved = await owner.post(
    `/api/applications/${encodeURIComponent(approvedId)}/withdraw`,
  );

  expect(skippedApproved.ok()).toBe(true);

  const withdrawnApproved = await applicationOf(owner, approvedId);

  expect(withdrawnApproved.application.status).toBe("withdrawn");
  expect(withdrawnApproved.application.approvedPlanSha256).toBeNull();
  expect(withdrawnApproved.application.scheduledFor).toBeNull();

  const skipList = z
    .object({ companies: z.array(z.object({ domain: z.string().nullable() })) })
    .parse(await (await owner.get("/api/profile/skip-companies")).json());

  expect(skipList.companies.some((company) => company.domain === "blankstreet.example")).toBe(
    false,
  );
  expect(postingId).not.toBe("");
});

test("dispatch claims only approved Applications and returns one whose Fact changed to Ready with what changed", async ({
  approval,
}) => {
  const { applicationId: first, owner, userId } = await readyApplication(approval);

  const now = await clockNow(owner);

  const readyPosting = await seedPostingFor(owner, approval.fixture.url, "2");

  await seedApplication(owner, {
    postingId: readyPosting,
    scheduledFor: now - 60_000,
    status: "ready",
    userId,
  });

  const beforeReady = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  expect((await sendJobIds(owner)).filter((id) => !beforeReady.has(id))).toEqual([]);

  await approveApplication(owner, first);
  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const firstRow = (await applicationsFor(owner, userId)).find((row) => row.id === first);

  expect(firstRow?.status).toBe("approved");

  if (firstRow?.scheduledFor === null || firstRow?.scheduledFor === undefined) {
    throw new Error("the planner gave the first Application no slot");
  }

  await moveClockTo(owner, new Date(firstRow.scheduledFor).toISOString());

  const beforeApproved = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  const claimed = (await sendJobIds(owner)).filter((id) => !beforeApproved.has(id));

  expect(claimed).toHaveLength(1);

  await expect
    .poll(async () => (await applicationOf(owner, first)).application.status, { timeout: 20_000 })
    .toBe("sent");

  const secondPosting = await seedPostingFor(owner, approval.fixture.url, "3");

  const second = await seedApplication(owner, {
    postingId: secondPosting,
    status: "ready",
    userId,
  });

  await approveApplication(owner, second);
  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const secondSlot = (await applicationsFor(owner, userId)).find(
    (row) => row.id === second,
  )?.scheduledFor;

  if (secondSlot === null || secondSlot === undefined) {
    throw new Error("the planner gave the second Application no slot");
  }

  await moveClockTo(owner, new Date(secondSlot).toISOString());

  const beforeChange = new Set(await sendJobIds(owner));

  const changed = await owner.put("/api/profile/facts", {
    data: {
      facts: facts.map((fact) =>
        fact.key === "legal_name" ? { key: fact.key, value: "Maya A. Okafor" } : fact,
      ),
    },
  });

  expect(changed.ok()).toBe(true);

  await runJob(owner, "dispatch.tick", "{}");

  expect((await sendJobIds(owner)).filter((id) => !beforeChange.has(id))).toEqual([]);

  const afterChange = await applicationOf(owner, second);

  expect(afterChange.application.status).toBe("ready");
  expect(afterChange.application.approvedAt).toBeNull();
  expect(afterChange.application.approvedPlanSha256).toBeNull();
  expect(afterChange.application.stage).toBe("ready");
  expect(JSON.parse(afterChange.application.changes ?? "[]")).toEqual(["An answer changed"]);
});

const factsSchema = z.object({
  facts: z.array(
    z.object({
      key: z.string(),
      revision: z.number(),
      scope: z.string(),
      source: z.string(),
      value: z.string(),
    }),
  ),
});

const editResultSchema = z.object({
  answer: z.string(),
  byUser: z.boolean(),
  factKey: z.string().nullable(),
  factRevision: z.number().nullable(),
});

async function editAnswer(
  owner: APIRequestContext,
  applicationId: string,
  questionId: string,
  value: string,
) {
  return owner.put(
    `/api/applications/${encodeURIComponent(applicationId)}/answers/${encodeURIComponent(questionId)}`,
    { data: { value } },
  );
}

function questionIdOf(card: z.infer<typeof cardSchema> | undefined, label: string) {
  const answer = card?.plan?.answers.find((candidate) => candidate.label === label);

  if (answer === undefined) {
    throw new Error(`no plan answer labelled ${label}`);
  }

  return answer;
}

const questionsSchema = z.object({
  questions: z.array(z.object({ questionId: z.string(), text: z.string() })),
});

async function seedOpenText(
  owner: APIRequestContext,
  userId: string,
  applicationId: string,
  postingId: string,
  texts: { sentence: string; text: string }[],
) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  const { questions: questionList } = questionsSchema.parse(await response.json());

  await Promise.all(
    texts.map(async (entry) => {
      const question = questionList.find((candidate) => candidate.text === entry.text);

      if (question === undefined) {
        throw new Error(`no seeded question for ${entry.text}`);
      }

      const seeded = await owner.post("/__test__/application-answers", {
        data: {
          applicationId,
          kind: "open_text",
          questionId: question.questionId,
          sentences: [{ resumeLineIds: ["open-text-line"], sentence: entry.sentence }],
        },
      });

      expect(seeded.ok()).toBe(true);
    }),
  );
}

test("the send fills the approved plan even after its open text changed behind the approval", async ({
  approval,
}) => {
  const { applicationId, owner, postingId, userId } = await readyApplication(approval);

  const approvedSentence = "I build backend platforms for payments teams.";

  await seedOpenText(owner, userId, applicationId, postingId, [
    { sentence: approvedSentence, text: "Website" },
  ]);

  const card = (await readyOf(owner)).cards.find((candidate) => candidate.id === applicationId);

  expect(card?.plan?.answers.find((answer) => answer.label === "Website")?.answer).toBe(
    approvedSentence,
  );

  await approveApplication(owner, applicationId);

  const approvedRow = (await applicationOf(owner, applicationId)).application;

  expect(approvedRow.approvedPlanSha256).not.toBeNull();

  await seedOpenText(owner, userId, applicationId, postingId, [
    { sentence: "This sentence arrived after the approval.", text: "Website" },
  ]);

  const sent = await owner.post("/__test__/jobs/run-now", {
    data: { kind: SEND_JOB, payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });

  expect(sent.ok()).toBe(true);
  expect((await applicationOf(owner, applicationId)).application.status).toBe("sent");

  const state = z
    .object({ applicationRequests: z.number(), submissions: z.number() })
    .parse(await (await fetch(`${approval.fixture.url}/__fixture__/state`)).json());

  expect(state.submissions).toBe(1);
  expect(approval.fixture.state.lastForm["question_32895468003"]).toBe(approvedSentence);

  const detail = z
    .object({
      snapshot: z
        .object({
          approvedAt: z.number().nullable(),
          approvedPlanSha256: z.string().nullable(),
          confirmedBy: z.string(),
        })
        .nullable(),
    })
    .parse(
      await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
    );

  expect(detail.snapshot?.confirmedBy).toBe("page");
  expect(detail.snapshot?.approvedAt).not.toBeNull();
  expect(detail.snapshot?.approvedPlanSha256).toBe(approvedRow.approvedPlanSha256);
});

test("no path submits an Application that is not approved", async ({ approval }) => {
  const { applicationId, owner } = await readyApplication(approval);

  const readySend = await owner.post("/__test__/jobs/run-now", {
    data: { kind: SEND_JOB, payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });

  expect(readySend.ok()).toBe(true);

  const untouched = await applicationOf(owner, applicationId);

  expect(untouched.application.status).toBe("ready");
  expect(untouched.application.attempts).toBe(0);
  expect((await fixtureState(approval.fixture)).submissions).toBe(0);

  await approveApplication(owner, applicationId);

  const approvedSend = await owner.post("/__test__/jobs/run-now", {
    data: { kind: SEND_JOB, payload: JSON.stringify({ applicationId }) },
    timeout: 120_000,
  });

  expect(approvedSend.ok()).toBe(true);

  const sent = await applicationOf(owner, applicationId);

  expect(sent.application.status).toBe("sent");
  expect(sent.application.attempts).toBe(1);
  expect((await fixtureState(approval.fixture)).submissions).toBe(1);
});

test("editing a factual answer saves the Fact and returns every approval that used it to Ready", async ({
  approval,
}) => {
  const { applicationId, owner, userId } = await readyApplication(approval);

  const secondPosting = await seedPostingFor(owner, approval.fixture.url, "2");

  const second = await seedApplication(owner, {
    postingId: secondPosting,
    status: "ready",
    userId,
  });

  await approveApplication(owner, second);

  const emailCompany = await seedCompany(owner, "Email Only Co", "emailonly.example");
  const emailBoard = await seedBoard(owner, emailCompany, "greenhouse", "emailonly");

  const emailPosting = await seedPosting(owner, {
    atsJobId: "8004209999",
    boardId: emailBoard,
    companyId: emailCompany,
    questions: [
      {
        answerKind: "fact",
        factKey: "email",
        fieldName: "email",
        fieldType: "email",
        required: true,
        text: "Email",
      },
      {
        answerKind: "skip",
        fieldName: "resume",
        fieldType: "file",
        required: true,
        text: "Resume/CV",
      },
    ],
    title: "Email only",
    url: `${approval.fixture.url}/emailonly/jobs/8004209999`,
  });

  const untouched = await seedApplication(owner, {
    postingId: emailPosting,
    status: "ready",
    userId,
  });

  await approveApplication(owner, untouched);

  const before = (await readyOf(owner)).cards.find((card) => card.id === applicationId);
  const country = questionIdOf(before, "Country");

  expect(country.answer).toBe("United Kingdom");

  const factsBefore = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());

  const revisionBefore =
    factsBefore.facts.find((fact) => fact.key === "current_country")?.revision ?? 0;

  const refusedEdit = await editAnswer(owner, second, country.questionId, "Canada");

  expect(refusedEdit.status()).toBe(409);
  expect(z.object({ error: z.string() }).parse(await refusedEdit.json()).error).toBe(
    "not_editable",
  );

  const unknownQuestion = await editAnswer(owner, applicationId, crypto.randomUUID(), "Canada");

  expect(unknownQuestion.status()).toBe(404);

  const invalid = await editAnswer(owner, applicationId, country.questionId, "France");

  expect(invalid.status()).toBe(422);
  expect((await applicationOf(owner, second)).application.status).toBe("approved");

  const edited = await editAnswer(owner, applicationId, country.questionId, "Canada");

  expect(edited.ok()).toBe(true);

  const result = editResultSchema.parse(await edited.json());

  expect(result).toEqual({
    answer: "Canada",
    byUser: false,
    factKey: "current_country",
    factRevision: revisionBefore + 1,
  });

  const factsList = factsSchema.parse(await (await owner.get("/api/profile/facts")).json());
  const countryFact = factsList.facts.find((fact) => fact.key === "current_country");

  expect(countryFact?.value).toBe("Canada");
  expect(countryFact?.revision).toBe(revisionBefore + 1);
  expect(countryFact?.source).toBe("user");

  const stale = await applicationOf(owner, second);

  expect(stale.application.status).toBe("ready");
  expect(stale.application.approvedAt).toBeNull();
  expect(stale.application.approvedPlanSha256).toBeNull();
  expect(stale.application.stage).toBe("ready");
  expect(JSON.parse(stale.application.changes ?? "[]")).toEqual(["An answer changed"]);
  expect(
    stale.timeline.some(
      (event) =>
        event.kind === "status" &&
        event.fromValue === "approved" &&
        event.toValue === "ready" &&
        event.source === "system",
    ),
  ).toBe(true);

  expect((await applicationOf(owner, untouched)).application.status).toBe("approved");

  const after = (await readyOf(owner)).cards.find((card) => card.id === applicationId);

  expect(questionIdOf(after, "Country").answer).toBe("Canada");
});

test("editing open text keeps the user's own words and records them in the Snapshot", async ({
  approval,
}) => {
  const { applicationId, owner } = await readyApplication(approval);

  const before = (await readyOf(owner)).cards.find((card) => card.id === applicationId);
  const website = questionIdOf(before, "Website");

  expect(website.answer).toBeNull();

  const text = "I build payment platforms that settle across twelve markets.";

  const edited = await editAnswer(owner, applicationId, website.questionId, text);

  expect(edited.ok()).toBe(true);
  expect(editResultSchema.parse(await edited.json())).toEqual({
    answer: text,
    byUser: true,
    factKey: null,
    factRevision: null,
  });

  const after = (await readyOf(owner)).cards.find((card) => card.id === applicationId);

  expect(questionIdOf(after, "Website").answer).toBe(text);
  expect(questionIdOf(after, "Website").byUser).toBe(true);
  expect(questionIdOf(after, "Website").source).toBe("open_text");

  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

  const afterPrepare = (await readyOf(owner)).cards.find((card) => card.id === applicationId);

  expect(questionIdOf(afterPrepare, "Website").answer).toBe(text);
  expect(questionIdOf(afterPrepare, "Website").byUser).toBe(true);

  const empty = await editAnswer(owner, applicationId, website.questionId, "   ");

  expect(empty.status()).toBe(400);

  await approveApplication(owner, applicationId);

  const sent = await owner.post("/__test__/jobs/run-now", {
    data: {
      kind: SEND_JOB,
      payload: JSON.stringify({ applicationId }),
    },
    timeout: 120_000,
  });

  expect(sent.ok()).toBe(true);

  await expect
    .poll(async () => (await applicationOf(owner, applicationId)).application.status, {
      timeout: 20_000,
    })
    .toBe("sent");

  const detail = sentDetailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );

  const answer = detail.snapshot?.answers.find((candidate) => candidate.label === "Website");

  expect(answer?.answer).toBe(text);
  expect(answer?.by_user).toBe(true);
  expect(answer?.resume_line_ids).toEqual([]);
  expect((await fixtureState(approval.fixture)).submissions).toBe(1);
});

test("a resume change returns an approval that used the old resume to Ready with what changed", async ({
  approval,
}) => {
  const { applicationId, owner } = await readyApplication(approval);

  await approveApplication(owner, applicationId);

  const replacement = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(resumeBytes),
        mimeType: "application/pdf",
        name: "maya-okafor-2026.pdf",
      },
    },
  });

  expect(replacement.ok()).toBe(true);

  const after = await applicationOf(owner, applicationId);

  expect(after.application.status).toBe("ready");
  expect(after.application.approvedAt).toBeNull();
  expect(after.application.approvedPlanSha256).toBeNull();
  expect(JSON.parse(after.application.changes ?? "[]")).toEqual(["Your resume changed"]);
});
