import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import { readSseEventUntil } from "./sse.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface PacingHarness {
  fixture: GreenhouseFixture;
  server: AppServer;
  sessionDirectory: string;
}

const test = appTest.extend<{ pacing: PacingHarness }>({
  pacing: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-pacing-"));
      const fixture = startGreenhouseFixture();
      const sessionDirectory = join(directory, "browsers");

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: sessionDirectory,
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        GREENHOUSE_FEED_BASE_URL: fixture.url,
        INBOUND_HMAC_SECRET: "inbound-test-secret",
      });

      await provide({ fixture, server, sessionDirectory });
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

const postingQuestions = [
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

const applicationSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  status: z.string(),
  statusReason: z.string().nullable(),
  scheduledFor: z.number().nullable(),
  sentAt: z.number().nullable(),
});

const applicationsSchema = z.object({ applications: z.array(applicationSchema) });

const applicationDetailSchema = z.object({
  application: z.object({
    status: z.string(),
    statusReason: z.string().nullable(),
  }),
  timeline: z.array(
    z.object({
      detail: z.string().nullable(),
      kind: z.string(),
      toValue: z.string().nullable(),
    }),
  ),
});

const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  payload: z.string(),
  status: z.string(),
});

const jobsSchema = z.object({ jobs: z.array(jobSchema) });

const questionsSchema = z.object({
  questions: z.array(z.object({ questionId: z.string(), text: z.string() })),
});

const jobEventSchema = z.object({ id: z.string() });

const SEND_JOB = "application.send";

const captureFormPage = `<!doctype html>
<html><body>
<h1>Senior Backend Engineer</h1>
<form method="post" action="/apply">
  <label>First name <input type="text" name="first_name" /></label>
  <label>Email <input type="email" name="email" /></label>
  <button type="submit">Submit application</button>
</form>
</body></html>`;

const MINUTE_MS = 60_000;

const SEND_AT = Date.parse("2026-03-10T12:00:10.000Z");

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  const start = await owner.post("/api/running", { data: { running: true } });

  expect(start.ok()).toBe(true);

  await owner.put("/api/profile/settings", {
    data: { languages: ["en"], timezone: "UTC" },
  });

  return { owner, userId };
}

async function saveFacts(owner: APIRequestContext) {
  const response = await owner.put("/api/profile/facts", { data: { facts } });

  expect(response.ok()).toBe(true);
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

async function ensureMailbox(owner: APIRequestContext) {
  const response = await owner.get("/api/profile/mailbox");

  expect(response.ok()).toBe(true);
}

const createdSchema = z.object({ id: z.string() });

async function seedPostingFor(owner: APIRequestContext, fixtureUrl: string, region: "us" | "eu") {
  const companyId = await seedCompany(owner, "Blank Street", "blankstreet.example");

  const response = await owner.post("/__test__/catalog/boards", {
    data: { ats: "greenhouse", boardToken: "blankstreet", companyId, region },
  });

  const boardId = createdSchema.parse(await response.json()).id;

  return seedPosting(owner, {
    atsJobId: "8004209003",
    boardId,
    companyId,
    questions: postingQuestions,
    title: "Assistant General Manager | Durham",
    url: `${fixtureUrl}/blankstreet/jobs/8004209003`,
  });
}

async function seedWebsiteAnswer(
  owner: APIRequestContext,
  userId: string,
  applicationId: string,
  postingId: string,
) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  const { questions } = questionsSchema.parse(await response.json());
  const question = questions.find((candidate) => candidate.text === "Website");

  if (question === undefined) {
    throw new Error("the seeded Posting has no Website question");
  }

  const seeded = await owner.post("/__test__/application-answers", {
    data: {
      applicationId,
      questionId: question.questionId,
      kind: "open_text",
      sentences: [
        { sentence: "I build backend platforms for payments teams.", resumeLineIds: ["line-1"] },
      ],
    },
  });

  expect(seeded.ok()).toBe(true);
}

async function seedTwoApproved(owner: APIRequestContext, userId: string, fixtureUrl: string) {
  const firstPosting = await seedPostingFor(owner, fixtureUrl, "us");

  const secondPosting = await seedPostingFor(owner, fixtureUrl, "eu");

  const firstApplication = await seedApplication(owner, {
    postingId: firstPosting,
    status: "ready",
    userId,
  });

  const secondApplication = await seedApplication(owner, {
    postingId: secondPosting,
    status: "ready",
    userId,
  });

  await seedWebsiteAnswer(owner, userId, firstApplication, firstPosting);
  await seedWebsiteAnswer(owner, userId, secondApplication, secondPosting);

  await approveApplication(owner, firstApplication);
  await approveApplication(owner, secondApplication);

  return { firstApplication, secondApplication };
}

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", { data: { kind, payload } });

  expect(response.ok()).toBe(true);
}

const clockStateSchema = z.object({ now: z.number(), offsetMs: z.number() });

async function moveClockTo(owner: APIRequestContext, iso: string) {
  const state = clockStateSchema.parse(await (await owner.get("/__test__/clock")).json());
  const offsetMs = state.offsetMs + (Date.parse(iso) - state.now);

  const response = await owner.post("/__test__/clock/offset", { data: { offsetMs } });

  expect(response.ok()).toBe(true);
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`);

  return applicationsSchema.parse(await response.json()).applications;
}

const homeRunningSchema = z.object({ pauseReason: z.string().nullable(), running: z.boolean() });

async function homeRunning(owner: APIRequestContext) {
  return homeRunningSchema.parse(await (await owner.get("/api/home")).json());
}

async function sendJobIds(owner: APIRequestContext) {
  const response = await owner.get("/__test__/jobs");

  const { jobs } = jobsSchema.parse(await response.json());

  return jobs.filter((job) => job.kind === SEND_JOB).map((job) => job.id);
}

function utcHour(at: number) {
  return new Date(at).getUTCHours();
}

async function newSendJobs(owner: APIRequestContext, before: ReadonlySet<string>) {
  return (await sendJobIds(owner)).filter((id) => !before.has(id));
}

async function waitForNewSend(
  owner: APIRequestContext,
  appServerUrl: string,
  before: ReadonlySet<string>,
) {
  const created = await newSendJobs(owner, before);

  expect(created.length).toBe(1);

  const jobId = created[0] ?? "";

  const event = await readSseEventUntil(
    `${appServerUrl}/api/events`,
    null,
    (candidate) =>
      candidate.event === "job.done" &&
      jobEventSchema.parse(JSON.parse(candidate.data)).id === jobId,
  );

  expect(event).not.toBeNull();

  return jobId;
}

test("the dispatcher records a missing resume and a missing mailbox on Home", async ({
  pacing,
}) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");

  const postingId = await seedPostingFor(owner, pacing.fixture.url, "us");

  const applicationId = await seedApplication(owner, {
    postingId,
    scheduledFor: Date.parse("2026-03-10T12:00:00.000Z"),
    status: "approved",
    userId,
  });

  await runJob(owner, "dispatch.tick", "{}");

  expect(await homeRunning(owner)).toEqual({ pauseReason: "no_resume", running: false });

  await uploadResume(owner);
  expect(await homeRunning(owner)).toEqual({ pauseReason: null, running: true });

  await owner.post("/__test__/applications/status", {
    data: {
      applicationId,
      scheduledFor: Date.parse("2026-03-10T12:00:00.000Z"),
      status: "approved",
    },
  });

  const mailboxId = z
    .object({ mailboxes: z.array(z.object({ id: z.string() })).min(1) })
    .parse(
      await (await owner.get(`/__test__/mailboxes?userId=${encodeURIComponent(userId)}`)).json(),
    ).mailboxes[0]?.id;

  if (mailboxId === undefined) {
    throw new Error("the owner has no mailbox");
  }

  await owner.post(`/__test__/mailboxes/${encodeURIComponent(mailboxId)}/status`, {
    data: { status: "closed" },
  });
  await runJob(owner, "dispatch.tick", "{}");

  expect(await homeRunning(owner)).toEqual({ pauseReason: "no_mailbox", running: false });

  await owner.post(`/__test__/mailboxes/${encodeURIComponent(mailboxId)}/status`, {
    data: { status: "active" },
  });
  await owner.post("/__test__/mailboxes/first-forwarded", { data: { userId } });

  expect(await homeRunning(owner)).toEqual({ pauseReason: null, running: true });

  await owner.dispose();
});

test("every dispatcher gate blocks a send until it is cleared", async ({ pacing }) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 5);

  const postingId = await seedPostingFor(owner, pacing.fixture.url, "us");

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  await approveApplication(owner, applicationId);

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = (await applicationsFor(owner, userId)).find((row) => row.id === applicationId);

  expect(planned?.scheduledFor).not.toBeNull();

  if (planned?.scheduledFor === null || planned?.scheduledFor === undefined) {
    throw new Error("the planner gave no slot");
  }

  expect(utcHour(planned.scheduledFor)).toBeGreaterThanOrEqual(8);
  expect(utcHour(planned.scheduledFor)).toBeLessThan(20);

  await moveClockTo(owner, new Date(planned.scheduledFor).toISOString());

  const blockedTick = async () => {
    const before = await sendJobIds(owner);

    await runJob(owner, "dispatch.tick", "{}");

    return (await sendJobIds(owner)).length === before.length;
  };

  const pause = await owner.post("/api/running", { data: { running: false } });

  expect(pause.ok()).toBe(true);
  expect(await blockedTick()).toBe(true);

  await owner.post("/api/running", { data: { running: true } });

  await owner.put("/__test__/kill-switches/global/all", {
    data: { enabled: true, reason: "test", setBy: "owner" },
  });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/kill-switches/global/all", {
    data: { enabled: false, reason: "test", setBy: "owner" },
  });

  await owner.put("/__test__/kill-switches/ats/greenhouse", {
    data: { enabled: true, reason: "test", setBy: "owner" },
  });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/kill-switches/ats/greenhouse", {
    data: { enabled: false, reason: "test", setBy: "owner" },
  });

  const application = (await applicationsFor(owner, userId)).find(
    (row) => row.id === applicationId,
  );

  if (application === undefined) {
    throw new Error("the seeded Application disappeared");
  }

  const employerKey = encodeURIComponent(application.companyId);

  await owner.put(`/__test__/kill-switches/employer/${employerKey}`, {
    data: { enabled: true, reason: "test", setBy: "owner" },
  });

  expect(await blockedTick()).toBe(true);

  await owner.put(`/__test__/kill-switches/employer/${employerKey}`, {
    data: { enabled: false, reason: "test", setBy: "owner" },
  });

  await owner.put("/__test__/kill-switches/provider/local", {
    data: { enabled: true, reason: "test", setBy: "owner" },
  });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/kill-switches/provider/local", {
    data: { enabled: false, reason: "test", setBy: "owner" },
  });

  await owner.put("/__test__/settings/limits.daily_cap", { data: { value: "0" } });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/settings/limits.daily_cap", { data: { value: "10" } });

  await owner.put("/__test__/settings/limits.ats_hourly.greenhouse", { data: { value: "0" } });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/settings/limits.ats_hourly.greenhouse", { data: { value: "120" } });

  await owner.put("/__test__/settings/limits.crowd_per_posting", { data: { value: "0" } });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/settings/limits.crowd_per_posting", { data: { value: "20" } });

  await owner.put("/__test__/settings/limits.crowd_per_employer_week", { data: { value: "0" } });

  expect(await blockedTick()).toBe(true);

  await owner.put("/__test__/settings/limits.crowd_per_employer_week", {
    data: { value: "50" },
  });

  await owner.post("/__test__/user/suspend", { data: { suspended: true, userId } });

  expect(await blockedTick()).toBe(true);

  await owner.post("/__test__/user/suspend", { data: { suspended: false, userId } });

  const otherPosting = await seedPostingFor(owner, pacing.fixture.url, "eu");

  const otherApplication = await seedApplication(owner, {
    postingId: otherPosting,
    status: "sending",
    userId,
  });

  expect(await blockedTick()).toBe(true);

  await owner.post("/__test__/applications/status", {
    data: { applicationId: otherApplication, status: "ready" },
  });

  const before = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  await waitForNewSend(owner, pacing.server.url, before);

  const sent = (await applicationsFor(owner, userId)).filter((row) => row.status === "sent");

  expect(sent.length).toBe(1);
});

test("a Posting closed since preparation is skipped, not sent", async ({ pacing }) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 3);

  const postingId = await seedPostingFor(owner, pacing.fixture.url, "us");

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  await approveApplication(owner, applicationId);

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = (await applicationsFor(owner, userId)).find((row) => row.id === applicationId);

  if (planned?.scheduledFor === null || planned?.scheduledFor === undefined) {
    throw new Error("the planner gave no slot");
  }

  await moveClockTo(owner, new Date(planned.scheduledFor).toISOString());

  pacing.fixture.state.postingOpen = false;

  const before = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  const after = (await applicationsFor(owner, userId)).find((row) => row.id === applicationId);

  expect(after?.status).toBe("skipped");
  expect(after?.statusReason).toBe("posting_closed");
  expect(await newSendJobs(owner, before)).toEqual([]);

  const detail = applicationDetailSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );

  const reason = detail.timeline.find(
    (event) => event.kind === "status" && event.toValue === "skipped",
  );

  expect(reason?.detail).toBe("The role closed before Overture could send.");
});

test("the clock moves sends only into the window, spaced at least twenty minutes apart", async ({
  pacing,
}) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T07:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 5);
  await seedTwoApproved(owner, userId, pacing.fixture.url);

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = (await applicationsFor(owner, userId)).toSorted(
    (left, right) => (left.scheduledFor ?? 0) - (right.scheduledFor ?? 0),
  );

  expect(planned.length).toBe(2);

  const firstSlot = planned[0]?.scheduledFor ?? 0;
  const secondSlot = planned[1]?.scheduledFor ?? 0;

  expect(firstSlot).toBeGreaterThan(0);
  expect(secondSlot - firstSlot).toBeGreaterThanOrEqual(20 * MINUTE_MS);
  expect(utcHour(firstSlot)).toBeGreaterThanOrEqual(8);
  expect(utcHour(secondSlot)).toBeLessThan(20);

  await moveClockTo(owner, "2026-03-10T07:59:00.000Z");

  const beforeWindow = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  expect(await newSendJobs(owner, beforeWindow)).toEqual([]);

  await moveClockTo(owner, new Date(firstSlot).toISOString());

  const beforeFirstSlot = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  await waitForNewSend(owner, pacing.server.url, beforeFirstSlot);

  await moveClockTo(owner, new Date(firstSlot + 10 * MINUTE_MS).toISOString());

  const beforeBetweenSlots = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  expect(await newSendJobs(owner, beforeBetweenSlots)).toEqual([]);

  await moveClockTo(owner, new Date(secondSlot).toISOString());

  const beforeSecondSlot = new Set(await sendJobIds(owner));

  await runJob(owner, "dispatch.tick", "{}");

  await waitForNewSend(owner, pacing.server.url, beforeSecondSlot);

  const sent = (await applicationsFor(owner, userId)).filter((row) => row.status === "sent");

  expect(sent.length).toBe(2);

  const sentAt = sent.map((row) => row.sentAt ?? 0).toSorted((left, right) => left - right);

  expect((sentAt[1] ?? 0) - (sentAt[0] ?? 0)).toBeGreaterThanOrEqual(20 * MINUTE_MS);

  for (const at of sentAt) {
    expect(utcHour(at)).toBeGreaterThanOrEqual(8);
    expect(utcHour(at)).toBeLessThan(20);
  }
});

test("an approval that cannot fit today's remaining slots rolls to the next window", async ({
  pacing,
}) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T07:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 5);

  const cap = await owner.put("/__test__/settings/limits.daily_cap", { data: { value: "1" } });

  expect(cap.ok()).toBe(true);

  const { firstApplication, secondApplication } = await seedTwoApproved(
    owner,
    userId,
    pacing.fixture.url,
  );

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = (await applicationsFor(owner, userId)).toSorted(
    (left, right) => (left.scheduledFor ?? 0) - (right.scheduledFor ?? 0),
  );

  expect(planned.length).toBe(2);

  const firstSlot = planned[0]?.scheduledFor ?? 0;
  const secondSlot = planned[1]?.scheduledFor ?? 0;
  const tomorrow = Date.parse("2026-03-11T00:00:00.000Z");

  expect(firstSlot).toBeGreaterThanOrEqual(Date.parse("2026-03-10T08:00:00.000Z"));
  expect(firstSlot).toBeLessThan(Date.parse("2026-03-10T20:00:00.000Z"));
  expect(secondSlot).toBeGreaterThanOrEqual(tomorrow + 8 * 60 * MINUTE_MS);
  expect(secondSlot).toBeLessThan(tomorrow + 20 * 60 * MINUTE_MS);

  await moveClockTo(owner, "2026-03-11T00:05:00.000Z");
  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const nextDay = await applicationsFor(owner, userId);
  const firstNext = nextDay.find((row) => row.id === firstApplication)?.scheduledFor ?? 0;
  const secondNext = nextDay.find((row) => row.id === secondApplication)?.scheduledFor ?? 0;

  expect(firstNext).toBeGreaterThan(0);
  expect(secondNext).toBeGreaterThan(firstNext);
});

async function putSetting(owner: APIRequestContext, key: string, value: string) {
  const response = await owner.put(`/__test__/settings/${encodeURIComponent(key)}`, {
    data: { value },
  });

  expect(response.ok()).toBe(true);
}

interface SendJobRequest {
  kind: string;
  payload: string;
  runAt: number;
  dedupeKey?: string;
}

async function enqueueSendJob(
  owner: APIRequestContext,
  applicationId: string,
  runAt: number,
  dedupeKey?: string,
) {
  const data: SendJobRequest = {
    kind: SEND_JOB,
    payload: JSON.stringify({ applicationId }),
    runAt,
  };

  if (dedupeKey !== undefined) {
    data.dedupeKey = dedupeKey;
  }

  const response = await owner.post("/__test__/jobs/enqueue", { data });

  expect(response.ok()).toBe(true);

  return createdSchema.parse(await response.json()).id;
}

async function jobRows(owner: APIRequestContext) {
  return jobsSchema.parse(await (await owner.get("/__test__/jobs")).json()).jobs;
}

async function jobStatus(owner: APIRequestContext, jobId: string) {
  return (await jobRows(owner)).find((job) => job.id === jobId)?.status ?? "missing";
}

const sendPayloadSchema = z.object({ applicationId: z.string() });

async function sendJobsFor(owner: APIRequestContext, applicationId: string) {
  return (await jobRows(owner)).filter((job) => {
    const payload: unknown = JSON.parse(job.payload);

    return (
      job.kind === SEND_JOB &&
      sendPayloadSchema.safeParse(payload).data?.applicationId === applicationId
    );
  });
}

async function holdTheOnlyBrowserSession(owner: APIRequestContext) {
  const gate = Promise.withResolvers<undefined>();
  const state = { hits: 0 };

  const page = Bun.serve({
    port: 0,
    async fetch() {
      state.hits += 1;
      await gate.promise;

      return new Response(captureFormPage, { headers: { "content-type": "text/html" } });
    },
  });

  const capture = runCapture(owner, `http://127.0.0.1:${String(page.port)}/form`);

  await expect.poll(() => state.hits, { timeout: 30_000 }).toBeGreaterThan(0);

  return {
    capture,
    page,
    release: () => {
      gate.resolve(undefined);
    },
  };
}

async function applicationsDueAtSendTime(pacing: PacingHarness, regions: readonly ("us" | "eu")[]) {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 5);

  const applicationIds = await Promise.all(
    regions.map(async (region) => {
      const postingId = await seedPostingFor(owner, pacing.fixture.url, region);

      const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

      await seedWebsiteAnswer(owner, userId, applicationId, postingId);
      await approveApplication(owner, applicationId);

      return applicationId;
    }),
  );

  const drained = await owner.post("/__test__/jobs/run-due");

  expect(drained.ok()).toBe(true);

  const pinned = await Promise.all(
    applicationIds.map(async (applicationId) =>
      owner.post("/__test__/applications/status", {
        data: { applicationId, scheduledFor: SEND_AT, status: "approved" },
      }),
    ),
  );

  for (const response of pinned) {
    expect(response.ok()).toBe(true);
  }

  await moveClockTo(owner, new Date(SEND_AT).toISOString());

  return { applicationIds, owner, userId };
}

async function startSendJob(owner: APIRequestContext, applicationId: string, runAt: number) {
  const jobId = await enqueueSendJob(owner, applicationId, runAt, `${SEND_JOB}:${applicationId}`);

  await expect.poll(async () => jobStatus(owner, jobId), { timeout: 30_000 }).toBe("running");

  return jobId;
}

async function waitForSendJobToSettle(owner: APIRequestContext, jobId: string) {
  await expect
    .poll(async () => jobStatus(owner, jobId), { timeout: 120_000 })
    .toMatch(/^(?<settled>done|dead|failed)$/u);
}

async function runCapture(owner: APIRequestContext, applyUrl: string) {
  return owner.post("/__test__/jobs/run-now", {
    data: {
      kind: "fixtures.capture",
      payload: JSON.stringify({ applyUrls: [applyUrl], ats: "greenhouse" }),
    },
  });
}

async function statusOf(owner: APIRequestContext, userId: string, applicationId: string) {
  return (await applicationsFor(owner, userId)).find((row) => row.id === applicationId)?.status;
}

test("dispatch queues no more sends than the browser session cap holds", async ({ pacing }) => {
  const { owner, userId } = await ownerFor(pacing.server);

  await moveClockTo(owner, "2026-03-10T12:00:00.000Z");
  await uploadResume(owner);
  await saveFacts(owner);
  await ensureMailbox(owner);
  await grantApplications(owner, 3);

  const postingId = await seedPostingFor(owner, pacing.fixture.url, "us");

  const applicationId = await seedApplication(owner, { postingId, status: "ready", userId });

  await approveApplication(owner, applicationId);

  await runJob(owner, "planner.day", JSON.stringify({ userId }));

  const planned = (await applicationsFor(owner, userId)).find((row) => row.id === applicationId);

  if (planned?.scheduledFor === null || planned?.scheduledFor === undefined) {
    throw new Error("the planner gave no slot");
  }

  const slot = new Date(planned.scheduledFor).toISOString();

  await moveClockTo(owner, slot);
  await enqueueSendJob(owner, crypto.randomUUID(), Date.parse(slot) + MINUTE_MS);

  const before = new Set(await sendJobIds(owner));

  expect(before.size).toBe(1);

  await putSetting(owner, "browser.max_concurrent_sessions", "1");
  await runJob(owner, "dispatch.tick", "{}");

  expect(await newSendJobs(owner, before)).toEqual([]);

  await putSetting(owner, "browser.max_concurrent_sessions", "2");
  await runJob(owner, "dispatch.tick", "{}");

  expect((await newSendJobs(owner, before)).length).toBe(1);
});

test("a send waits for a browser session before it marks the Application sending", async ({
  pacing,
}) => {
  test.setTimeout(120_000);

  const { applicationIds, owner, userId } = await applicationsDueAtSendTime(pacing, ["us"]);
  const [applicationId] = applicationIds;

  if (applicationId === undefined) {
    throw new Error("the harness seeded no Application");
  }

  await putSetting(owner, "browser.max_concurrent_sessions", "1");

  const slot = await holdTheOnlyBrowserSession(owner);

  try {
    const jobId = await startSendJob(owner, applicationId, SEND_AT);

    expect(await statusOf(owner, userId, applicationId)).toBe("approved");

    slot.release();

    await slot.capture;
    await waitForSendJobToSettle(owner, jobId);

    expect(await statusOf(owner, userId, applicationId)).toBe("sent");
  } finally {
    slot.release();
    await slot.page.stop(true);
  }
});

test("a send waiting for a browser slot is counted, so the tick never queues it twice", async ({
  pacing,
}) => {
  test.setTimeout(120_000);

  const { applicationIds, owner, userId } = await applicationsDueAtSendTime(pacing, ["us", "eu"]);
  const [waiting, next] = applicationIds;

  if (waiting === undefined || next === undefined) {
    throw new Error("the harness seeded fewer than two Applications");
  }

  await putSetting(owner, "browser.max_concurrent_sessions", "1");

  const slot = await holdTheOnlyBrowserSession(owner);

  try {
    const jobId = await startSendJob(owner, waiting, SEND_AT);

    expect(await statusOf(owner, userId, waiting)).toBe("approved");

    const before = new Set(await sendJobIds(owner));

    await runJob(owner, "dispatch.tick", "{}");

    expect(await newSendJobs(owner, before)).toEqual([]);
    expect((await sendJobsFor(owner, waiting)).map((job) => job.id)).toEqual([jobId]);
    expect(await statusOf(owner, userId, next)).toBe("approved");

    await putSetting(owner, "browser.max_concurrent_sessions", "2");
    await runJob(owner, "dispatch.tick", "{}");

    expect(await newSendJobs(owner, before)).toEqual([]);

    slot.release();

    await slot.capture;
    await waitForSendJobToSettle(owner, jobId);

    expect(await statusOf(owner, userId, waiting)).toBe("sent");
  } finally {
    slot.release();
    await slot.page.stop(true);
  }
});

test("a kill switch flipped while a send waits for a slot stops that send", async ({ pacing }) => {
  test.setTimeout(120_000);

  const { applicationIds, owner, userId } = await applicationsDueAtSendTime(pacing, ["us"]);
  const [applicationId] = applicationIds;

  if (applicationId === undefined) {
    throw new Error("the harness seeded no Application");
  }

  await putSetting(owner, "browser.max_concurrent_sessions", "1");

  const slot = await holdTheOnlyBrowserSession(owner);

  try {
    const jobId = await startSendJob(owner, applicationId, SEND_AT);

    expect(await statusOf(owner, userId, applicationId)).toBe("approved");

    const switched = await owner.put("/__test__/kill-switches/ats/greenhouse", {
      data: { enabled: true, reason: "testing the send re-check", setBy: "owner" },
    });

    expect(switched.ok()).toBe(true);

    slot.release();

    await slot.capture;
    await waitForSendJobToSettle(owner, jobId);

    expect(await statusOf(owner, userId, applicationId)).toBe("approved");
  } finally {
    slot.release();
    await slot.page.stop(true);
  }
});
