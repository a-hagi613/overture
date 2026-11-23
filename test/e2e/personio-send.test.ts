import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { IdentityServer } from "./identity-server-test.fixture.ts";
import type { PersonioFixture, PersonioVariant } from "./personio.fixture.ts";

import { expect, startFreshAppServer, test } from "./app.fixture.ts";
import { startPersonioFixture } from "./personio.fixture.ts";
import {
  approveApplication,
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";

interface PersonioHarness {
  fixture: PersonioFixture;
  server: AppServer;
  site: { boardToken: string; companyName: string; jobId: string; title: string };
}

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor", scope: "" },
  { key: "email", value: "maya.okafor@example.com", scope: "" },
  { key: "phone", value: "+49 176 555 0199", scope: "" },
  { key: "current_city", value: "Berlin", scope: "" },
  { key: "current_country", value: "Germany", scope: "" },
  { key: "earliest_start", value: "2026-12-01", scope: "" },
  { key: "salary_expectation", value: "90000 per year", scope: "" },
  { key: "work_auth", value: "Yes", scope: "DE" },
  { key: "willing_relocate", value: "Yes", scope: "" },
  { key: "languages", value: "English, German", scope: "" },
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

const attemptSchema = z.object({
  outcome: z.string().nullable(),
  submitResponseStatus: z.number().nullable(),
});

const attemptsSchema = z.object({ attempts: z.array(attemptSchema) });

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

const fixtureStateSchema = z.object({
  applicationRequests: z.number(),
  checkedValues: z.array(z.string()),
  documents: z.array(z.object({ bytes: z.number(), name: z.string() })),
  formLoads: z.number(),
  submissions: z.number(),
});

interface PersonioHarnessOptions {
  showConfirmation?: boolean;
  submitStatus?: number;
  redirectToAlternateHost?: boolean;
  redirectJobId?: string;
}

async function startHarness(
  identityServer: IdentityServer,
  variant: PersonioVariant,
  options: PersonioHarnessOptions = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "overture-personio-send-"));

  const fixture = startPersonioFixture({
    redirectJobId: options.redirectJobId,
    redirectToAlternateHost: options.redirectToAlternateHost,
    showConfirmation: options.showConfirmation,
    submitStatus: options.submitStatus,
    variant,
  });

  const server = await startFreshAppServer(identityServer, {
    BROWSER_PROVIDER: "local",
    BROWSER_SESSION_DIR: join(directory, "browsers"),
  });

  return {
    fixture,
    server,
    site: {
      boardToken: "musterfirma",
      companyName: "Musterfirma",
      jobId: "1234567",
      title: "Senior Backend Engineer",
    },
  } satisfies PersonioHarness;
}

async function withHarness(
  identityServer: IdentityServer,
  variant: PersonioVariant,
  work: (harness: PersonioHarness) => Promise<void>,
  options: PersonioHarnessOptions = {},
) {
  const harness = await startHarness(identityServer, variant, options);

  try {
    await work(harness);
  } finally {
    await harness.server.stop();
    harness.fixture.close();
  }
}

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

  const running = await owner.post("/api/running", { data: { running: true } });

  expect(running.ok()).toBe(true);

  await owner.put("/__test__/kill-switches/ats/personio", {
    data: { enabled: false, reason: "personio send test" },
  });

  return { owner, userId };
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

async function seededApplication(harness: PersonioHarness) {
  const { owner, userId } = await ownerFor(harness.server);

  await prepareProfile(owner);

  const { boardToken, companyName, jobId, title } = harness.site;

  const companyId = await seedCompany(owner, companyName, `${boardToken}.example`);
  const boardId = await seedBoard(owner, companyId, "personio", boardToken);

  const postingId = await seedPosting(owner, {
    ats: "personio",
    atsJobId: jobId,
    boardId,
    companyId,
    title,
    url: harness.fixture.applyUrl(jobId),
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));

  return { applicationId, owner, postingId, userId };
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

async function fixtureState(fixture: PersonioFixture) {
  return fixtureStateSchema.parse(await (await fetch(`${fixture.url}/__fixture__/state`)).json());
}

async function questionsOf(owner: APIRequestContext, postingId: string, userId: string) {
  const response = await owner.get(
    `/__test__/questions?userId=${encodeURIComponent(userId)}&postingId=${encodeURIComponent(postingId)}`,
  );

  return questionSchema.parse(await response.json()).questions;
}

test("a Personio form is read over plain HTTP and a send fills, uploads the resume and submits the recorded page", async ({
  identityServer,
}) => {
  await withHarness(identityServer, "standard", async (harness) => {
    const { applicationId, owner, postingId, userId } = await seededApplication(harness);

    const detail = await applicationOf(owner, applicationId);

    expect(detail.application.status).toBe("ready");
    expect(detail.application.statusReason).toBeNull();

    const questions = await questionsOf(owner, postingId, userId);

    expect(questions.map((question) => question.text)).toEqual(
      expect.arrayContaining(["First name", "Last name", "Email", "Earliest start date"]),
    );
    expect(questions.find((question) => question.text === "Resume")?.fieldType).toBe("file");
    expect(questions.find((question) => question.text === "Resume")?.required).toBe(true);

    const beforeSend = await fixtureState(harness.fixture);

    expect(beforeSend.submissions).toBe(0);
    expect(beforeSend.formLoads).toBe(1);

    await grantApplications(owner, 2);
    await approveApplication(owner, applicationId);

    const sent = await owner.post("/__test__/jobs/run-now", {
      data: { kind: "application.send", payload: JSON.stringify({ applicationId }) },
      timeout: 120_000,
    });

    expect(sent.ok()).toBe(true);

    const after = await applicationOf(owner, applicationId);

    expect(after.application.status).toBe("sent");
    expect(after.application.stage).toBe("applied");
    expect(after.snapshot?.confirmedBy).toBe("page");

    const answers = new Map(after.snapshot?.answers.map((answer) => [answer.label, answer.answer]));

    expect(answers.get("First name")).toBe("Maya");
    expect(answers.get("Last name")).toBe("Okafor");
    expect(answers.get("Email")).toBe("maya.okafor@example.com");
    expect(answers.get("Earliest start date")).toBe("2026-12-01");

    const state = await fixtureState(harness.fixture);

    expect(state.submissions).toBe(1);
    expect(state.applicationRequests).toBe(1);
    expect(state.documents.map((document) => document.name)).toContain("maya-okafor.pdf");
    expect(state.documents[0]?.bytes).toBe(resumeBytes.byteLength);
    expect(harness.fixture.state.lastForm["email"]).toBe("maya.okafor@example.com");
    expect(harness.fixture.state.lastForm["first_name"]).toBe("Maya");
    expect(harness.fixture.state.lastForm["last_name"]).toBe("Okafor");
    expect(harness.fixture.state.lastForm["custom_attribute_2001"]).toBe("yes");
    expect(state.checkedValues).toContain("custom_attribute_2001=yes");
    expect(state.checkedValues).toContain("custom_attribute_2002=english");
    expect(state.checkedValues).toContain("custom_attribute_2002=german");
    expect(state.checkedValues).not.toContain("custom_attribute_2002=french");

    const attempts = await attemptsOf(owner, applicationId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("sent");
    expect(attempts[0]?.submitResponseStatus).toBe(201);
  });
});

test("a required custom Personio question opens an honest Review, and its answer readies and sends the form", async ({
  identityServer,
}) => {
  await withHarness(identityServer, "custom", async (harness) => {
    const { applicationId, owner } = await seededApplication(harness);

    const blocked = await applicationOf(owner, applicationId);

    expect(blocked.application.status).toBe("needs_review");
    expect(blocked.application.statusReason).toBe("unknown_question");

    const reviews = reviewSchema.parse(await (await owner.get("/api/reviews")).json());

    const review = reviews.reviews.find((candidate) =>
      candidate.prompt.includes("visa sponsorship"),
    );

    if (review === undefined) {
      throw new Error("The custom question did not open a Review.");
    }

    const answered = await owner.post(`/api/reviews/${encodeURIComponent(review.id)}/answer`, {
      data: { value: "Yes" },
    });

    expect(answered.ok()).toBe(true);

    const ready = await applicationOf(owner, applicationId);

    expect(ready.application.status).toBe("ready");

    await grantApplications(owner, 2);
    await approveApplication(owner, applicationId);

    await runJob(owner, "application.send", JSON.stringify({ applicationId }));

    const sent = await applicationOf(owner, applicationId);

    expect(sent.application.status).toBe("sent");
    expect(harness.fixture.state.lastForm["custom_attribute_1002"]).toBe("custom_option_2001");
    expect(harness.fixture.state.lastForm["email"]).toBe("maya.okafor@example.com");
  });
});

test("a bare 2xx without the confirmation page stays confirming and is never called sent", async ({
  identityServer,
}) => {
  await withHarness(
    identityServer,
    "standard",
    async (harness) => {
      const { applicationId, owner } = await seededApplication(harness);

      await grantApplications(owner, 2);
      await approveApplication(owner, applicationId);
      await runJob(owner, "application.send", JSON.stringify({ applicationId }));

      const after = await applicationOf(owner, applicationId);

      expect(after.application.status).toBe("confirming");
      expect(after.snapshot).toBeNull();
      expect(harness.fixture.state.submissions).toBe(1);

      const attempts = await attemptsOf(owner, applicationId);

      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.outcome).toBe("unconfirmed");
      expect(attempts[0]?.submitResponseStatus).toBe(201);
    },
    { showConfirmation: false },
  );
});

test("a 4xx answer to the Personio application request is blocked, not sent", async ({
  identityServer,
}) => {
  await withHarness(
    identityServer,
    "standard",
    async (harness) => {
      const { applicationId, owner } = await seededApplication(harness);

      await grantApplications(owner, 2);
      await approveApplication(owner, applicationId);
      await runJob(owner, "application.send", JSON.stringify({ applicationId }));

      const after = await applicationOf(owner, applicationId);

      expect(after.application.status).toBe("approved");
      expect(after.snapshot).toBeNull();

      const attempts = await attemptsOf(owner, applicationId);

      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.outcome).toBe("blocked");
      expect(attempts[0]?.submitResponseStatus).toBe(400);
    },
    { submitStatus: 400 },
  );
});

test("a Personio page reached on another host skips the Application as a host mismatch", async ({
  identityServer,
}) => {
  await withHarness(
    identityServer,
    "standard",
    async (harness) => {
      const { applicationId, owner } = await seededApplication(harness);

      await grantApplications(owner, 2);
      await approveApplication(owner, applicationId);
      await runJob(owner, "application.send", JSON.stringify({ applicationId }));

      const after = await applicationOf(owner, applicationId);

      expect(after.application.status).toBe("skipped");
      expect(after.application.statusReason).toBe("posting_identity:host");
      expect(harness.fixture.state.submissions).toBe(0);
    },
    { redirectToAlternateHost: true },
  );
});

test("a Personio page for another job id skips the Application as a job_id mismatch", async ({
  identityServer,
}) => {
  await withHarness(
    identityServer,
    "standard",
    async (harness) => {
      const { applicationId, owner } = await seededApplication(harness);

      await grantApplications(owner, 2);
      await approveApplication(owner, applicationId);
      await runJob(owner, "application.send", JSON.stringify({ applicationId }));

      const after = await applicationOf(owner, applicationId);

      expect(after.application.status).toBe("skipped");
      expect(after.application.statusReason).toBe("posting_identity:job_id");
      expect(harness.fixture.state.submissions).toBe(0);
    },
    { redirectJobId: "9999999" },
  );
});
