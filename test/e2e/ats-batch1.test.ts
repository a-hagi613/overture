import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { Batch1Board, Batch1Fixture } from "./batch1.fixture.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { BATCH1_SITES, startBatch1Fixture } from "./batch1.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface Batch1Harness {
  fixture: Batch1Fixture;
  server: AppServer;
  userId: string;
  owner: APIRequestContext;
}

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+1 415 555 0199", scope: "" },
  { key: "current_city", value: "Toronto", scope: "" },
  { key: "current_country", value: "Canada", scope: "" },
  { key: "earliest_start", value: "2026-12-01", scope: "" },
  { key: "work_auth", value: "Yes", scope: "CA" },
];

const applicationSchema = z.object({
  application: z.object({
    attempts: z.number(),
    id: z.string(),
    stage: z.string().nullable(),
    status: z.string(),
    statusReason: z.string().nullable(),
  }),
  snapshot: z
    .object({
      answers: z.array(
        z.object({ answer: z.string().nullable(), kind: z.string(), label: z.string() }),
      ),
      confirmedBy: z.string(),
    })
    .nullable(),
});

const attemptsSchema = z.object({
  attempts: z.array(z.object({ outcome: z.string().nullable() })),
});

const questionSchema = z.object({
  questions: z.array(
    z.object({
      fieldType: z.string(),
      required: z.boolean(),
      text: z.string(),
    }),
  ),
});

const reviewSchema = z.object({
  reviews: z.array(z.object({ id: z.string(), prompt: z.string() })),
});

const billingSchema = z.object({ applicationsLeft: z.number() });

async function withHarness(
  identityServer: IdentityServer,
  work: (harness: Batch1Harness) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-batch1-"));
  const fixture = startBatch1Fixture();

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: join(directory, "browsers"),
  });

  try {
    const { owner, userId } = await ownerContextFor(server.url);

    await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });
    await owner.post("/api/running", { data: { running: true } });

    await prepareProfile(owner);

    await work({ fixture, owner, server, userId });
  } finally {
    await server.stop();
    fixture.close();
  }
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

async function runJob(owner: APIRequestContext, kind: string, payload: string) {
  const response = await owner.post("/__test__/jobs/run-now", {
    data: { kind, payload },
    timeout: 120_000,
  });

  if (!response.ok()) {
    throw new Error(
      `The ${kind} job failed: ${String(response.status())} ${await response.text()}`,
    );
  }
}

async function seededApplication(harness: Batch1Harness, board: Batch1Board) {
  const site = BATCH1_SITES.find((candidate) => candidate.board === board);

  if (site === undefined) {
    throw new Error(`no fixture site for ${board}`);
  }

  const companyId = await seedCompany(harness.owner, "Example", "example.test");
  const boardId = await seedBoard(harness.owner, companyId, board, site.boardToken);

  const postingId = await seedPosting(harness.owner, {
    ats: board,
    atsJobId: site.jobId,
    boardId,
    companyId,
    title: "Platform Engineer",
    url: harness.fixture.applyUrl(board),
  });

  const applicationId = await seedApplication(harness.owner, {
    postingId,
    status: "preparing",
    userId: harness.userId,
  });

  return { applicationId, postingId };
}

async function prepareApplication(harness: Batch1Harness, applicationId: string) {
  await runJob(harness.owner, "application.prepare", JSON.stringify({ applicationId }));
}

async function applicationOf(owner: APIRequestContext, applicationId: string) {
  return applicationSchema.parse(
    await (await owner.get(`/api/applications/${encodeURIComponent(applicationId)}`)).json(),
  );
}

async function attemptsOf(owner: APIRequestContext, applicationId: string) {
  const response = await owner.get(
    `/__test__/attempts?applicationId=${encodeURIComponent(applicationId)}`,
  );

  return attemptsSchema.parse(await response.json()).attempts;
}

async function questionsOf(owner: APIRequestContext, postingId: string, userId: string) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  return questionSchema.parse(await response.json()).questions;
}

async function applicationsLeft(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/billing-state?userId=${encodeURIComponent(userId)}`);

  return billingSchema.parse(await response.json()).applicationsLeft;
}

for (const site of BATCH1_SITES) {
  test(`${site.board} is read over plain HTTP, then the approved plan fills and submits the recorded form`, async ({
    identityServer,
  }) => {
    await withHarness(identityServer, async (harness) => {
      const { applicationId, postingId } = await seededApplication(harness, site.board);

      await prepareApplication(harness, applicationId);

      const prepared = await applicationOf(harness.owner, applicationId);

      expect(prepared.application.status).toBe("ready");
      expect(prepared.application.statusReason).toBeNull();

      const questions = await questionsOf(harness.owner, postingId, harness.userId);

      expect(questions.map((question) => question.text)).toEqual(
        expect.arrayContaining(["First name", "Last name", "Email", "Resume"]),
      );
      expect(questions.find((question) => question.text === "Resume")?.fieldType).toBe("file");

      expect(harness.fixture.state(site.board).submissions).toBe(0);
      expect(harness.fixture.state(site.board).formLoads).toBe(1);

      await grantApplications(harness.owner, 2);

      const leftBeforeSend = await applicationsLeft(harness.owner, harness.userId);

      await approveApplication(harness.owner, applicationId);
      await runJob(harness.owner, "application.send", JSON.stringify({ applicationId }));

      const sent = await applicationOf(harness.owner, applicationId);

      expect(sent.application.status).toBe("sent");
      expect(sent.application.stage).toBe("applied");
      expect(sent.snapshot?.confirmedBy).toBe("page");

      const answers = new Map(
        sent.snapshot?.answers.map((answer) => [answer.label, answer.answer]),
      );

      expect(answers.get("First name")).toBe("Maya");
      expect(answers.get("Last name")).toBe("Okafor");
      expect(answers.get("Email")).toBe("maya.okafor@example.com");

      const state = harness.fixture.state(site.board);

      expect(state.submissions).toBe(1);
      expect(state.lastForm["email"]).toBe("maya.okafor@example.com");
      expect(state.files).toEqual([{ field: "resume", name: "maya-okafor.pdf" }]);
      expect(harness.fixture.posts(site.board)).toHaveLength(1);
      expect(await applicationsLeft(harness.owner, harness.userId)).toBe(leftBeforeSend - 1);

      const attempts = await attemptsOf(harness.owner, applicationId);

      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.outcome).toBe("sent");
    });
  });
}

test("a Paylocity login gate is skipped at preparation, before any question, browser or credit", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async (harness) => {
    harness.fixture.setMode({ board: "paylocity", loginWall: true });

    const { applicationId } = await seededApplication(harness, "paylocity");

    await prepareApplication(harness, applicationId);

    const prepared = await applicationOf(harness.owner, applicationId);

    expect(prepared.application.status).toBe("skipped");
    expect(prepared.application.statusReason).toBe("unsupported_login_required");
    expect(prepared.application.stage).toBeNull();
    expect(harness.fixture.state("paylocity").submissions).toBe(0);
    expect(await attemptsOf(harness.owner, applicationId)).toHaveLength(0);
  });
});

test("a Paylocity send that meets the login gate stops before Submit and releases its credit", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async (harness) => {
    const { applicationId } = await seededApplication(harness, "paylocity");

    await prepareApplication(harness, applicationId);

    expect((await applicationOf(harness.owner, applicationId)).application.status).toBe("ready");

    await grantApplications(harness.owner, 2);

    const leftBeforeSend = await applicationsLeft(harness.owner, harness.userId);

    await approveApplication(harness.owner, applicationId);

    harness.fixture.setMode({ board: "paylocity", loginWall: true });

    await runJob(harness.owner, "application.send", JSON.stringify({ applicationId }));

    const after = await applicationOf(harness.owner, applicationId);

    expect(after.application.status).toBe("skipped");
    expect(after.application.statusReason).toBe("unsupported_login_required");
    expect(after.snapshot).toBeNull();
    expect(harness.fixture.state("paylocity").submissions).toBe(0);
    expect(await applicationsLeft(harness.owner, harness.userId)).toBe(leftBeforeSend);

    const attempts = await attemptsOf(harness.owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("blocked");
  });
});

test("a form that rewrites an approved answer after filling never submits and asks for a fresh approval", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async (harness) => {
    const { applicationId } = await seededApplication(harness, "careerplug");

    await prepareApplication(harness, applicationId);
    await grantApplications(harness.owner, 2);
    await approveApplication(harness.owner, applicationId);

    harness.fixture.setMode({ board: "careerplug", mutate: true });

    await runJob(harness.owner, "application.send", JSON.stringify({ applicationId }));

    const after = await applicationOf(harness.owner, applicationId);

    expect(after.application.status).toBe("ready");
    expect(after.snapshot).toBeNull();
    expect(harness.fixture.state("careerplug").submissions).toBe(0);

    const attempts = await attemptsOf(harness.owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("form_changed");
  });
});

test("a new required question opens one honest Review and never submits the stale plan", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async (harness) => {
    const { applicationId } = await seededApplication(harness, "manatal");

    await prepareApplication(harness, applicationId);
    await grantApplications(harness.owner, 2);
    await approveApplication(harness.owner, applicationId);

    harness.fixture.setMode({ board: "manatal", extraRequired: true });

    await runJob(harness.owner, "application.send", JSON.stringify({ applicationId }));

    const after = await applicationOf(harness.owner, applicationId);

    expect(after.application.status).toBe("needs_review");
    expect(after.application.statusReason).toBe("unknown_question");
    expect(after.snapshot).toBeNull();
    expect(harness.fixture.state("manatal").submissions).toBe(0);

    const reviews = reviewSchema.parse(await (await harness.owner.get("/api/reviews")).json());

    expect(reviews.reviews.map((review) => review.prompt)).toEqual(
      expect.arrayContaining(["Pronouns"]),
    );
  });
});

test("an unsupported required file slot skips the JazzHR Application without spending", async ({
  identityServer,
}) => {
  await withHarness(identityServer, async (harness) => {
    harness.fixture.setMode({ board: "jazzhr", portfolio: true });

    const { applicationId } = await seededApplication(harness, "jazzhr");

    await prepareApplication(harness, applicationId);

    const prepared = await applicationOf(harness.owner, applicationId);

    expect(prepared.application.status).toBe("skipped");
    expect(prepared.application.statusReason).toBe("form_unsupported");
    expect(prepared.snapshot).toBeNull();
    expect(harness.fixture.state("jazzhr").submissions).toBe(0);
    expect(await applicationsLeft(harness.owner, harness.userId)).toBe(0);

    const reviews = reviewSchema.parse(await (await harness.owner.get("/api/reviews")).json());

    expect(reviews.reviews).toHaveLength(0);
  });
});
