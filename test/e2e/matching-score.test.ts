import { readFileSync } from "node:fs";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { AnthropicFixtureServer } from "./anthropic-fixture-server.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { startAnthropicFixtureServer } from "./anthropic-fixture-server.ts";
import { startGreenhouseQuestionsFixture } from "./greenhouse-questions.fixture.ts";
import {
  clearCatalog,
  clockNow,
  clockState,
  configureMatching,
  grantApplications,
  moveClockTo,
  ownerContextFor,
  runPrepDaily,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

const test = appTest.extend<{
  matching: {
    anthropic: AnthropicFixtureServer;
    questions: ReturnType<typeof startGreenhouseQuestionsFixture>;
    server: AppServer;
  };
}>({
  matching: [
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

const matchRowSchema = z.object({
  postingId: z.string(),
  codeRank: z.number(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
});

const matchesSchema = z.object({ matches: z.array(matchRowSchema) });

const applicationRowSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  origin: z.enum(["auto", "manual"]),
  status: z.string(),
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const postingSchema = z.object({
  id: z.string(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
  applicationId: z.string().nullable(),
});

const appliedSchema = z.object({ applicationId: z.string(), created: z.boolean() });

const notificationsSchema = z.object({
  notifications: z.array(z.object({ body: z.string(), kind: z.string(), title: z.string() })),
});

const llmUsageSchema = z.object({
  totals: z.object({ calls: z.number(), costMicros: z.number() }),
});

const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  runAt: z.number(),
  status: z.string(),
  dedupeKey: z.string().nullable(),
});

const jobsSchema = z.object({ jobs: z.array(jobSchema) });

async function seedCompanies(
  owner: APIRequestContext,
  prefix: string,
  count: number,
  extra: { salaryMinMinor: number | null; postedAt?: number },
) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const name = `${prefix} ${String(index)}`;
      const companyId = await seedCompany(owner, name, `${prefix}-${String(index)}.example`);
      const boardId = await seedBoard(owner, companyId, "greenhouse", `${prefix}-${String(index)}`);

      return seedPosting(owner, {
        atsJobId: `${prefix}-${String(index)}`,
        boardId,
        companyId,
        postedAt: extra.postedAt === undefined ? null : extra.postedAt - index * 1000,
        salaryMinMinor: extra.salaryMinMinor,
        salaryCurrency: extra.salaryMinMinor === null ? null : "CAD",
        title: "Senior Backend Engineer",
        url: `https://${prefix}-${String(index)}.example/1`,
      });
    }),
  );
}

async function matchesFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/matches?userId=${encodeURIComponent(userId)}`)
  ).json();

  return matchesSchema.parse(body).matches;
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return applicationsSchema.parse(body).applications;
}

async function alertsFor(owner: APIRequestContext, userId: string) {
  const body: unknown = await (
    await owner.get(`/__test__/notifications?userId=${encodeURIComponent(userId)}`)
  ).json();

  return notificationsSchema.parse(body).notifications.filter((note) => note.kind === "alert");
}

async function scoreSpendMicros(owner: APIRequestContext) {
  return llmUsageSchema.parse(await (await owner.get("/__test__/llm/usage?purpose=score")).json())
    .totals.costMicros;
}

test("the daily run fills the free Ready slots in rank order and never scores twice", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const now = await clockNow(owner);

  const paid = await seedCompanies(owner, "paid", 10, {
    postedAt: now - 20 * 86_400_000,
    salaryMinMinor: 15_000_000,
  });

  const unpaid = await seedCompanies(owner, "unpaid", 10, {
    postedAt: now - 15 * 86_400_000,
    salaryMinMinor: null,
  });

  await runPrepDaily(owner, userId);

  const applications = await applicationsFor(owner, userId);
  const matches = await matchesFor(owner, userId);
  const scored = matches.filter((row) => row.score !== null);

  expect(applications).toHaveLength(10);
  expect(scored).toHaveLength(10);
  expect(matching.anthropic.requests()).toHaveLength(10);

  for (const id of paid) {
    expect(scored.some((row) => row.postingId === id)).toBe(true);
  }

  for (const id of unpaid) {
    expect(scored.some((row) => row.postingId === id)).toBe(false);
  }

  const reasons = scored.map((row) => row.reason);

  expect(reasons.every((reason) => reason !== null && reason.length <= 140)).toBe(true);

  await runPrepDaily(owner, userId);

  expect(await applicationsFor(owner, userId)).toHaveLength(10);
  expect((await matchesFor(owner, userId)).filter((row) => row.score !== null)).toHaveLength(10);
  expect(matching.anthropic.requests()).toHaveLength(10);

  const alerts = await alertsFor(owner, userId);

  expect(
    alerts.filter((alert) => alert.title === "Overture alert: match.score_bound"),
  ).toHaveLength(0);

  await owner.dispose();
});

test("a strict threshold over a large pool stops at the scoring bound, alerts once and leaves the LLM cap untripped", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  await owner.put("/__test__/settings/match.auto_threshold_default", { data: { value: "95" } });
  await owner.put("/__test__/settings/llm.cap_user_day_usd", { data: { value: "0.018" } });

  await seedCompanies(owner, "bound", 40, { salaryMinMinor: 15_000_000 });

  await runPrepDaily(owner, userId);

  const scored = (await matchesFor(owner, userId)).filter((row) => row.score !== null);
  const alerts = await alertsFor(owner, userId);

  expect(scored).toHaveLength(30);
  expect(matching.anthropic.requests()).toHaveLength(30);
  expect(await applicationsFor(owner, userId)).toHaveLength(0);

  const boundAlerts = alerts.filter((alert) => alert.title === "Overture alert: match.score_bound");

  expect(boundAlerts).toHaveLength(1);
  expect(alerts.filter((alert) => alert.title === "Overture alert: llm.cap")).toHaveLength(0);

  expect(JSON.parse(boundAlerts[0]?.body ?? "{}")).toMatchObject({
    attempts: 30,
    bound: 30,
    candidates: 40,
    need: 10,
    threshold: 95,
  });

  const spendMicros = await scoreSpendMicros(owner);

  expect(spendMicros).toBeGreaterThan(0);
  expect(spendMicros).toBeLessThan(18_000);

  await owner.dispose();
});

test("a run after the daily time schedules only tomorrow, never a second run today", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  await owner.put("/__test__/settings/match.auto_threshold_default", { data: { value: "95" } });
  await owner.put("/__test__/settings/prep.run_local_time", { data: { value: "07:00" } });

  const { now: before } = await clockState(owner);
  const dayMs = 86_400_000;
  const todayStart = Math.floor(before / dayMs) * dayMs;
  const todayRunAt = todayStart + 9 * 3_600_000;

  if (before < todayRunAt) {
    await moveClockTo(owner, todayRunAt);
  }

  await seedCompanies(owner, "late", 40, { salaryMinMinor: 15_000_000 });

  await runPrepDaily(owner, userId);

  const now = await clockNow(owner);
  const tomorrowRunAt = todayStart + dayMs + 7 * 3_600_000;
  const { jobs } = jobsSchema.parse(await (await owner.get("/__test__/jobs")).json());
  const scheduled = jobs.filter((job) => job.kind === "prep.daily" && job.dedupeKey !== null);

  expect(matching.anthropic.requests()).toHaveLength(30);
  expect(scheduled.filter((job) => job.runAt <= now)).toHaveLength(0);
  expect(
    scheduled.filter((job) => job.runAt === tomorrowRunAt && job.status === "queued"),
  ).toHaveLength(1);

  await owner.dispose();
});

test("opening a posting scores it once, and manual apply works below the threshold", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const strongCompany = await seedCompany(owner, "Strong Co", "strong.example");
  const strongBoard = await seedBoard(owner, strongCompany, "greenhouse", "strong");

  const strong = await seedPosting(owner, {
    atsJobId: "strong",
    boardId: strongBoard,
    companyId: strongCompany,
    descriptionText: "We build distributed systems on Kubernetes and Postgres for payments teams.",
    title: "Data Backend Engineer",
    url: "https://strong.example/1",
  });

  const weakCompany = await seedCompany(owner, "Weak Co", "weak.example");
  const weakBoard = await seedBoard(owner, weakCompany, "greenhouse", "weak");

  const weak = await seedPosting(owner, {
    atsJobId: "weak",
    boardId: weakBoard,
    companyId: weakCompany,
    title: "Junior Backend Engineer",
    url: "https://weak.example/1",
  });

  const strongPosting = postingSchema.parse(
    await (await owner.get(`/api/postings/${strong}`)).json(),
  );

  expect(strongPosting.score).toBe(87);
  expect(strongPosting.reason).toContain("pipelines");
  expect(strongPosting.applicationId).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(1);
  expect(matching.anthropic.requests().at(0)?.user).toContain(
    "distributed systems on Kubernetes and Postgres",
  );

  const weakFirst = postingSchema.parse(await (await owner.get(`/api/postings/${weak}`)).json());

  expect(weakFirst.score).toBe(35);
  expect(weakFirst.applicationId).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(2);

  const reopened = postingSchema.parse(await (await owner.get(`/api/postings/${strong}`)).json());

  expect(reopened.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(2);

  const manual = appliedSchema.parse(
    await (await owner.post(`/api/postings/${weak}/apply`, { data: {} })).json(),
  );

  expect(manual.created).toBe(true);

  const application = (await applicationsFor(owner, userId)).find((row) => row.postingId === weak);

  expect(application?.origin).toBe("manual");
  expect(["preparing", "ready"]).toContain(application?.status);

  await owner.put("/api/profile/targets", {
    data: {
      roles: ["Backend"],
      seniorities: ["senior"],
      workplaces: ["remote"],
      locations: ["Toronto, ON", "Vancouver, BC"],
      employmentTypes: ["full_time"],
      salaryFloorMinor: 10_000_000,
      salaryCurrency: "CAD",
      salaryPeriod: "year",
    },
  });

  const rescored = postingSchema.parse(await (await owner.get(`/api/postings/${strong}`)).json());

  expect(rescored.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(3);
  expect(matching.anthropic.requests().at(2)?.user).toContain("Toronto, ON or Vancouver, BC");

  const reopenedAgain = postingSchema.parse(
    await (await owner.get(`/api/postings/${strong}`)).json(),
  );

  expect(reopenedAgain.score).toBe(87);
  expect(matching.anthropic.requests()).toHaveLength(3);

  await owner.dispose();
});

test("an application is created only for a score at or above the threshold", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  async function seededPosting(title: string) {
    const name = title.replaceAll(" ", "");
    const companyId = await seedCompany(owner, `${name} Co`, `${name.toLowerCase()}.example`);
    const boardId = await seedBoard(owner, companyId, "greenhouse", name.toLowerCase());

    const id = await seedPosting(owner, {
      atsJobId: name,
      boardId,
      companyId,
      title,
      url: `https://${name.toLowerCase()}.example/1`,
    });

    return { id, title };
  }

  const seeded = await Promise.all(
    ["Senior Backend Engineer", "Backend Engineer", "Junior Backend Engineer"].map(async (title) =>
      seededPosting(title),
    ),
  );

  await runPrepDaily(owner, userId);

  const applications = await applicationsFor(owner, userId);
  const matches = await matchesFor(owner, userId);

  expect(matches.filter((row) => row.score !== null)).toHaveLength(3);
  expect(applications).toHaveLength(1);
  expect(applications.at(0)?.postingId).toBe(seeded.at(0)?.id);

  await owner.dispose();
});

test("manual Apply refuses every hard filter and scores only what it may apply to", async ({
  matching,
}) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const upload = await owner.post("/api/profile/resume", {
    multipart: {
      file: {
        buffer: Buffer.from(readFileSync("test/e2e/fixtures/resume-text.pdf")),
        mimeType: "application/pdf",
        name: "resume.pdf",
      },
    },
  });

  expect(upload.status()).toBe(201);

  await owner.put("/api/profile/skip-companies", {
    data: { companies: [{ domain: "fenwick.example", name: "Fenwick & Marsh" }] },
  });

  const now = await clockNow(owner);

  async function companyWithPostings(company: string, titles: string[]) {
    const companyId = await seedCompany(
      owner,
      company,
      `${company.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}.example`,
    );

    const boardId = await seedBoard(
      owner,
      companyId,
      "greenhouse",
      company.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and"),
    );

    return Promise.all(
      titles.map(async (title, index) =>
        seedPosting(owner, {
          atsJobId: `${company}-${String(index)}`,
          boardId,
          companyId,
          title,
          url: `https://example.test/${company}/${String(index)}`,
        }),
      ),
    );
  }

  const skipped = await companyWithPostings("Fenwick & Marsh", ["Senior Backend Engineer"]);
  const employer = await companyWithPostings("Brightwave Analytics", ["Senior Backend Engineer"]);
  const closed = await companyWithPostings("Closed Co", ["Senior Backend Engineer"]);

  const repost = await companyWithPostings("Repost Co", [
    "Repost Backend Engineer",
    "Repost Backend Engineer",
  ]);

  const openCompany = await companyWithPostings("Open Co", [
    "Backend Engineer",
    "Platform Backend Engineer",
  ]);

  const cooldown = await companyWithPostings("Cooldown Co", [
    "Staff Backend Engineer",
    "Data Backend Engineer",
  ]);

  const allowed = await companyWithPostings("Allowed Co", ["Junior Backend Engineer"]);

  await owner.post("/__test__/catalog/postings/close", { data: { id: closed[0] } });

  await seedApplication(owner, {
    postingId: repost[0] ?? "",
    sentAt: now - 40 * 86_400_000,
    status: "sent",
    userId,
  });
  await seedApplication(owner, { postingId: openCompany[1] ?? "", status: "preparing", userId });
  await seedApplication(owner, {
    postingId: cooldown[1] ?? "",
    sentAt: now - 3 * 86_400_000,
    status: "sent",
    userId,
  });

  const refusals: { id: string; reason: string }[] = [
    { id: skipped[0] ?? "", reason: "skip_list" },
    { id: employer[0] ?? "", reason: "current_employer" },
    { id: closed[0] ?? "", reason: "closed" },
    { id: repost[1] ?? "", reason: "repost_guard" },
    { id: openCompany[0] ?? "", reason: "open_application_company" },
    { id: cooldown[0] ?? "", reason: "company_cooldown" },
  ];

  await Promise.all(
    refusals.map(async (refusal) => {
      const response = await owner.post(`/api/postings/${refusal.id}/apply`, { data: {} });

      expect(response.status()).toBe(409);
      expect(
        z.object({ error: z.literal("filtered"), reason: z.string() }).parse(await response.json())
          .reason,
      ).toBe(refusal.reason);
    }),
  );

  expect(matching.anthropic.requests()).toHaveLength(0);

  const skippedPosting = postingSchema.parse(
    await (await owner.get(`/api/postings/${skipped[0] ?? ""}`)).json(),
  );

  expect(skippedPosting.score).toBeNull();
  expect(skippedPosting.reason).toBeNull();
  expect(matching.anthropic.requests()).toHaveLength(0);

  const allowedResponse = await owner.post(`/api/postings/${allowed[0] ?? ""}/apply`, { data: {} });

  expect(allowedResponse.status()).toBe(200);
  expect(appliedSchema.parse(await allowedResponse.json()).created).toBe(true);
  expect(matching.anthropic.requests()).toHaveLength(1);

  const applications = await applicationsFor(owner, userId);
  const refusedIds = new Set(refusals.map((refusal) => refusal.id));

  expect(applications.some((row) => refusedIds.has(row.postingId))).toBe(false);
  expect(applications.find((row) => row.postingId === allowed[0])?.origin).toBe("manual");

  await owner.dispose();
});

test("ready and approved Applications reduce the daily run", async ({ matching }) => {
  const { owner, userId } = await ownerContextFor(matching.server.url);

  await clearCatalog(owner);
  await grantApplications(owner, 70);
  await configureMatching(owner);

  const now = await clockNow(owner);

  const paid = await seedCompanies(owner, "buffer-paid", 10, {
    postedAt: now - 20 * 86_400_000,
    salaryMinMinor: 15_000_000,
  });

  await seedCompanies(owner, "buffer-unpaid", 10, {
    postedAt: now - 15 * 86_400_000,
    salaryMinMinor: null,
  });

  const approved = paid.slice(0, 3);

  await Promise.all(
    approved.map(async (postingId) => {
      await seedApplication(owner, { postingId, status: "approved", userId });
    }),
  );

  await runPrepDaily(owner, userId);

  const applications = await applicationsFor(owner, userId);
  const approvedIds = new Set(approved);

  expect(applications).toHaveLength(10);
  expect(applications.filter((row) => !approvedIds.has(row.postingId))).toHaveLength(7);
  expect(matching.anthropic.requests()).toHaveLength(7);

  await owner.dispose();
});
