import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { authTestIdentity } from "./auth.fixture.ts";
import { startGreenhouseQuestionsFixture } from "./greenhouse-questions.fixture.ts";
import {
  basePosting,
  clearCatalog,
  configureMatching,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{
  prep: {
    anthropic: AnthropicFixtureServer;
    questions: ReturnType<typeof startGreenhouseQuestionsFixture>;
    server: AppServer;
  };
}>({
  prep: [
    async ({ identityServer }, provide) => {
      const anthropic = await startAnthropicFixtureServer();
      const questions = startGreenhouseQuestionsFixture();

      const server = await startFreshAppServer(identityServer, {
        ANTHROPIC_API_KEY: "test-anthropic-key",
        ANTHROPIC_BASE_URL: anthropic.url,
        GREENHOUSE_FEED_BASE_URL: questions.url,
      });

      await provide({ anthropic, questions, server });
      await server.stop();
      anthropic.stop();
      questions.stop();
    },
    { scope: "test" },
  ],
});

const clockSchema = z.object({ now: z.number(), offsetMs: z.number() });
const createdSchema = z.object({ id: z.string() });

const applicationsSchema = z.object({
  applications: z.array(z.object({ id: z.string(), status: z.string(), postingId: z.string() })),
});

const mailSchema = z.object({
  messages: z.array(z.object({ body: z.string(), subject: z.string(), to: z.string() })),
});

const notificationsSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      body: z.string(),
      url: z.string(),
      createdAt: z.number(),
      emailedAt: z.number().nullable(),
    }),
  ),
});

const readySchema = z.object({
  approved: z.number(),
  cards: z.array(z.object({ id: z.string(), status: z.string() })),
  ready: z.number(),
});

const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      runAt: z.number(),
      status: z.string(),
    }),
  ),
});

async function clockNow(owner: APIRequestContext) {
  return clockSchema.parse(await (await owner.get("/__test__/clock")).json()).now;
}

async function moveClockTo(owner: APIRequestContext, at: number) {
  const { now, offsetMs } = clockSchema.parse(await (await owner.get("/__test__/clock")).json());

  await owner.post("/__test__/clock/offset", { data: { offsetMs: at - (now - offsetMs) } });
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return applicationsSchema.parse(body).applications;
}

async function mailFor(owner: APIRequestContext) {
  return mailSchema.parse(await (await owner.get("/__test__/mail")).json()).messages;
}

async function jobsFor(owner: APIRequestContext) {
  return jobsSchema.parse(await (await owner.get("/__test__/jobs")).json()).jobs;
}

async function notificationsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return notificationsSchema.parse(body).notifications;
}

async function runDueJobs(owner: APIRequestContext) {
  const response = await owner.post("/__test__/jobs/run-due", { data: {} });

  expect(response.ok()).toBe(true);
}

async function pauseSchedulerPolling(owner: APIRequestContext) {
  const response = await owner.put("/__test__/settings/jobs.poll_interval_ms", {
    data: { value: "3600000" },
  });

  expect(response.ok()).toBe(true);
}

async function pinPrepRunTime(owner: APIRequestContext) {
  const response = await owner.put("/__test__/settings/prep.run_local_time", {
    data: { value: "07:00" },
  });

  expect(response.ok()).toBe(true);
}

async function waitForRecapMail(owner: APIRequestContext) {
  await expect
    .poll(
      async () => {
        await runDueJobs(owner);

        return (await mailFor(owner)).length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
}

async function readyFor(owner: APIRequestContext) {
  return readySchema.parse(await (await owner.get("/api/ready")).json());
}

async function seedCandidates(owner: APIRequestContext, count: number) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const name = `Recap ${String(index)}`;

      const company = createdSchema.parse(
        await (
          await owner.post("/__test__/catalog/companies", {
            data: { domain: `recap-${String(index)}.example`, name },
          })
        ).json(),
      );

      const board = createdSchema.parse(
        await (
          await owner.post("/__test__/catalog/boards", {
            data: {
              ats: "greenhouse",
              boardToken: `recap-${String(index)}`,
              companyId: company.id,
            },
          })
        ).json(),
      );

      const posting = createdSchema.parse(
        await (
          await owner.post("/__test__/catalog/postings", {
            data: {
              ...basePosting,
              atsJobId: `recap-${String(index)}`,
              boardId: board.id,
              companyId: company.id,
              title: "Senior Backend Engineer",
              url: `https://recap-${String(index)}.example/1`,
            },
          })
        ).json(),
      );

      return posting.id;
    }),
  );
}

async function nextRunTarget(owner: APIRequestContext) {
  const now = await clockNow(owner);
  const at = new Date(now);

  let target = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 6, 59, 0);

  if (target <= now) {
    target += 86_400_000;
  }

  return target;
}

test("a 07:00 admin override fills exactly the free Ready slots, sends one recap, and does nothing before 07:00", async ({
  prep,
}) => {
  const { owner, userId } = await ownerContextFor(prep.server.url);

  await pinPrepRunTime(owner);
  await owner.post("/__test__/mail/clear", { data: {} });
  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await owner.post("/__test__/profile/running", { data: { running: true, userId } });
  await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone: "UTC" } });
  await configureMatching(owner);

  const postings = await seedCandidates(owner, 12);

  const existing = await seedApplication(owner, {
    postingId: postings[0] ?? "",
    status: "ready",
    userId,
  });

  await owner.post("/__test__/reviews/seed", {
    data: {
      answerKind: "fact",
      applicationIds: [existing],
      factKey: "work_auth_ca",
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Are you authorised to work in Canada?",
      reason: "unknown_required",
      scope: "CA",
      userId,
    },
  });

  const before = await nextRunTarget(owner);
  const after = before + 60_000;

  await pauseSchedulerPolling(owner);
  await moveClockTo(owner, before);
  await owner.post("/api/running", { data: { running: true } });

  await runDueJobs(owner);

  expect(await applicationsFor(owner, userId)).toHaveLength(1);
  expect(await mailFor(owner)).toHaveLength(0);

  await moveClockTo(owner, after);
  await runDueJobs(owner);

  await expect
    .poll(
      async () =>
        (await applicationsFor(owner, userId)).filter(
          (application) => application.status === "ready",
        ).length,
      { timeout: 30_000 },
    )
    .toBe(10);

  expect(await applicationsFor(owner, userId)).toHaveLength(10);

  await waitForRecapMail(owner);

  const [recap] = await mailFor(owner);

  expect(recap?.to).toBe(authTestIdentity.ownerEmail);
  expect(recap?.subject).toBe("Overture recap: 9 ready to approve, 1 need an answer");
  expect(recap?.body).toContain("9 applications are ready to approve");
  expect(recap?.body).toContain("Senior Backend Engineer at Recap 1");
  expect(recap?.body).toContain("1 question needs an answer.");
  expect(recap?.body).toContain("/ready");

  await expect
    .poll(
      async () =>
        (await jobsFor(owner)).find((job) => job.kind === "ready.notify")?.status ?? "missing",
      { timeout: 30_000 },
    )
    .toBe("done");

  const notifications = await notificationsFor(owner, userId);
  const recapNotification = notifications.find((notification) => notification.kind === "ready");

  expect(recapNotification?.url).toContain("/ready");
  expect(recapNotification?.emailedAt).not.toBeNull();

  const link = new URL(recap?.body.match(/https?:\/\/\S+/u)?.[0] ?? "");

  expect(link.pathname).toBe("/ready");

  const page = await owner.get(`${prep.server.url}/ready`);

  expect(page.status()).toBe(200);
  expect(await page.text()).toContain('id="root"');

  const afterOpen = await readyFor(owner);

  expect(afterOpen.approved).toBe(0);
  expect(afterOpen.ready).toBe(10);
  expect(afterOpen.cards.every((card) => card.status === "ready")).toBe(true);
  expect(await mailFor(owner)).toHaveLength(1);
  expect(
    (await applicationsFor(owner, userId)).every((application) => application.status === "ready"),
  ).toBe(true);
  expect((await jobsFor(owner)).some((job) => job.kind === "application.send")).toBe(false);

  await owner.dispose();
});

test("ready.notify lists the run's work, sends once a local day, and sends nothing when the run produced nothing", async ({
  prep,
}) => {
  const { owner, userId } = await ownerContextFor(prep.server.url);

  await owner.post("/__test__/mail/clear", { data: {} });
  await clearCatalog(owner);

  const companyId = await seedCompany(owner, "Recap Direct", "recap-direct.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "recap-direct");

  const postingId = await seedPosting(owner, {
    ats: "greenhouse",
    atsJobId: "recap-direct-1",
    boardId,
    companyId,
    title: "Staff Platform Engineer",
    url: "https://recap-direct.example/1",
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    readyAt: await clockNow(owner),
    status: "ready",
    userId,
  });

  await owner.post("/__test__/reviews/seed", {
    data: {
      answerKind: "fact",
      applicationIds: [applicationId],
      factKey: "work_auth_ca",
      fieldType: "select",
      options: ["Yes", "No"],
      prompt: "Are you authorised to work in Canada?",
      reason: "unknown_required",
      scope: "CA",
      userId,
    },
  });

  const now = await clockNow(owner);
  const settled = JSON.stringify({ since: now - 60_000, userId });

  await owner.post("/__test__/jobs/run-now", {
    data: { kind: "ready.notify", payload: JSON.stringify({ since: now + 60_000, userId }) },
  });

  expect(await mailFor(owner)).toHaveLength(0);

  await owner.post("/__test__/jobs/run-now", { data: { kind: "ready.notify", payload: settled } });

  const [recap] = await mailFor(owner);

  expect(recap?.subject).toBe("Overture recap: 1 ready to approve, 1 need an answer");
  expect(recap?.body).toContain("Staff Platform Engineer at Recap Direct");
  expect(recap?.body).toContain("1 question needs an answer.");
  expect(recap?.body.match(/\/ready/gu)).toHaveLength(1);

  await owner.post("/__test__/jobs/run-now", { data: { kind: "ready.notify", payload: settled } });

  expect(await mailFor(owner)).toHaveLength(1);

  const recapNotifications = (await notificationsFor(owner, userId)).filter(
    (notification) => notification.kind === "ready",
  );

  expect(recapNotifications).toHaveLength(1);
  expect(recapNotifications[0]?.emailedAt).not.toBeNull();

  await owner.dispose();
});

test("the next day's 07:00 override run stops at the unapproved Ready Applications and sends no second recap", async ({
  prep,
}) => {
  const { owner, userId } = await ownerContextFor(prep.server.url);

  await pinPrepRunTime(owner);
  await owner.post("/__test__/mail/clear", { data: {} });
  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await owner.post("/__test__/profile/running", { data: { running: true, userId } });
  await owner.put("/api/profile/settings", { data: { languages: ["en"], timezone: "UTC" } });
  await configureMatching(owner);

  await seedCandidates(owner, 12);

  const firstRun = await nextRunTarget(owner);
  const secondRun = firstRun + 86_400_000 + 60_000;

  await pauseSchedulerPolling(owner);
  await moveClockTo(owner, firstRun);
  await owner.post("/api/running", { data: { running: true } });
  await moveClockTo(owner, firstRun + 60_000);
  await runDueJobs(owner);

  await expect
    .poll(async () => (await applicationsFor(owner, userId)).length, { timeout: 30_000 })
    .toBe(10);

  await waitForRecapMail(owner);

  const scheduled = (await jobsFor(owner)).find(
    (job) => job.kind === "prep.daily" && job.runAt === secondRun,
  );

  expect(scheduled).toBeDefined();

  await moveClockTo(owner, secondRun);
  await runDueJobs(owner);

  await expect
    .poll(
      async () =>
        (await jobsFor(owner)).find((job) => job.id === scheduled?.id)?.status ?? "missing",
      { timeout: 30_000 },
    )
    .toBe("done");

  await runDueJobs(owner);

  expect(await applicationsFor(owner, userId)).toHaveLength(10);
  expect(await mailFor(owner)).toHaveLength(1);

  const notifications = await notificationsFor(owner, userId);

  expect(notifications.filter((notification) => notification.kind === "ready")).toHaveLength(1);

  await owner.dispose();
});
