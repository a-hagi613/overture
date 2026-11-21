import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { APIRequestContext } from "@playwright/test";
import type { AppServer } from "./app-server.ts";
import type { GreenhouseFixture } from "./greenhouse.fixture.ts";

import { expect, startFreshAppServer, test as appTest } from "./app.fixture.ts";
import { authTestIdentity, testAuthEnvironment } from "./auth.fixture.ts";
import { startGreenhouseFixture } from "./greenhouse.fixture.ts";
import {
  grantApplications,
  ownerContextFor,
  seedApplication,
  seedBoard,
  seedCompany,
  seedPosting,
} from "./matching-harness.ts";
import { parseMasterKey } from "../../src/server/platform/crypto.ts";
import { openDatabase } from "../../src/server/platform/db/client.ts";
import { reviewAuditEvents } from "../../src/server/platform/db/schema.ts";
import { createPersonalCrypto } from "../../src/server/profile/personal-crypto.ts";
import {
  buildReviewReport,
  redactSnapshotAudit,
  sampleSnapshotAudit,
} from "../../src/server/pipeline/review-report.ts";

interface ReportHarness {
  fixture: GreenhouseFixture;
  server: AppServer;
  sessionDirectory: string;
}

type PostingSeed = Parameters<typeof seedPosting>[1];

type SeedQuestion = NonNullable<PostingSeed["questions"]>[number];

const test = appTest.extend<{ reportHarness: ReportHarness }>({
  reportHarness: [
    async ({ identityServer }, provide) => {
      const directory = mkdtempSync(join(tmpdir(), "overture-review-report-"));
      const fixture = startGreenhouseFixture();
      const sessionDirectory = join(directory, "browsers");

      const server = await startFreshAppServer(identityServer, {
        BROWSER_PROVIDER: "local",
        BROWSER_SESSION_DIR: sessionDirectory,
        GREENHOUSE_BOARD_BASE_URL: fixture.url,
        GREENHOUSE_FEED_BASE_URL: fixture.url,
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
});

const applicationsSchema = z.object({ applications: z.array(applicationRowSchema) });

const reviewRowSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  scope: z.string(),
  reason: z.string(),
  status: z.string(),
});

const reviewsSchema = z.object({ reviews: z.array(reviewRowSchema) });

const detailSchema = z.object({
  reason: z.string().optional(),
  repeat: z.boolean().optional(),
  resolution: z.string().optional(),
  answers: z.number().optional(),
  confirmedBy: z.string().optional(),
});

const writtenAuditSchema = z.object({
  snapshots: z.array(
    z.object({
      answers: z.array(
        z.object({
          factKey: z.string().nullable(),
          label: z.string(),
          value: z.string().nullable(),
        }),
      ),
    }),
  ),
});

const reportSchema = z.object({
  audit: z.object({
    sample: z.number(),
    seed: z.string(),
    selected: z.number(),
    snapshots: z.array(
      z.object({
        applicationId: z.string(),
        ats: z.string(),
        company: z.string(),
        answers: z.array(
          z.object({
            factKey: z.string().nullable(),
            factRevision: z.number().nullable(),
            hasValue: z.boolean(),
            label: z.string(),
            source: z.string(),
          }),
        ),
      }),
    ),
  }),
  out: z.string().nullable(),
  report: z.object({
    answersBySource: z.array(z.object({ answers: z.number(), source: z.string() })),
    byAts: z.array(
      z.object({
        ats: z.string(),
        prepared: z.number(),
        reviews: z.number(),
        reviewsPer100: z.number().nullable(),
        sent: z.number(),
      }),
    ),
    coverage: z.number().nullable(),
    prepared: z.number(),
    questionFamilies: z.array(
      z.object({
        prompt: z.string(),
        repeats: z.number(),
        reviews: z.number(),
        textNormHash: z.string(),
      }),
    ),
    repeatRate: z.number().nullable(),
    resolutions: z.object({
      answered: z.number(),
      autoDismissed: z.number(),
      dismissed: z.number(),
      medianAnswerMs: z.number().nullable(),
    }),
    reviews: z.number(),
    reviewsPer100: z.number().nullable(),
    sent: z.number(),
  }),
});

const resumeBytes = new Uint8Array(readFileSync("test/e2e/fixtures/resume-text.pdf"));

const facts = [
  { key: "legal_name", value: "Maya Okafor" },
  { key: "email", value: "maya.okafor@example.com" },
  { key: "phone", value: "+1 416 555 0199" },
  { key: "current_country", value: "United Kingdom" },
  { key: "linkedin_url", value: "https://www.linkedin.com/in/maya-okafor" },
];

const sendQuestions = [
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "first_name",
    fieldType: "text" as const,
    required: true,
    text: "First Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "last_name",
    fieldType: "text" as const,
    required: true,
    text: "Last Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "email",
    fieldName: "email",
    fieldType: "email" as const,
    required: true,
    text: "Email",
  },
  {
    answerKind: "fact" as const,
    factKey: "phone",
    fieldName: "phone",
    fieldType: "phone" as const,
    required: false,
    text: "Phone",
  },
  {
    answerKind: "skip" as const,
    fieldName: "resume",
    fieldType: "file" as const,
    required: true,
    text: "Resume/CV",
  },
];

const reviewQuestions = [
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "first_name",
    fieldType: "text" as const,
    required: true,
    text: "First Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "legal_name",
    fieldName: "last_name",
    fieldType: "text" as const,
    required: true,
    text: "Last Name",
  },
  {
    answerKind: "fact" as const,
    factKey: "email",
    fieldName: "email",
    fieldType: "email" as const,
    required: true,
    text: "Email",
  },
  {
    answerKind: "consent" as const,
    fieldName: "question_consent",
    fieldType: "select" as const,
    options: ["Acknowledge/Confirm"],
    required: true,
    text: "Please review and acknowledge our privacy notice.",
  },
  {
    answerKind: "unknown" as const,
    fieldName: "question_title",
    fieldType: "text" as const,
    required: true,
    text: "What is your current or previous job title?",
  },
];

async function ownerFor(server: AppServer) {
  const { owner, userId } = await ownerContextFor(server.url);

  await owner.put("/__test__/settings/jobs.poll_interval_ms", { data: { value: "3600000" } });

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

  expect(response.ok()).toBe(true);
}

async function prepare(owner: APIRequestContext, applicationId: string) {
  await runJob(owner, "application.prepare", JSON.stringify({ applicationId }));
}

async function applicationsFor(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/applications?userId=${encodeURIComponent(userId)}`);

  return applicationsSchema.parse(await response.json()).applications;
}

async function reviewsFor(owner: APIRequestContext, userId: string) {
  const response = await owner.get(`/__test__/reviews?userId=${encodeURIComponent(userId)}`);

  return reviewsSchema.parse(await response.json()).reviews;
}

function auditEvents(server: AppServer) {
  const { db } = openDatabase(server.databasePath);

  return db.select().from(reviewAuditEvents).all();
}

async function seedReviewPosting(
  owner: APIRequestContext,
  input: {
    companyId: string;
    boardId: string;
    domain: string;
    atsJobId: string;
    questions: SeedQuestion[];
  },
) {
  return seedPosting(owner, {
    atsJobId: input.atsJobId,
    boardId: input.boardId,
    companyId: input.companyId,
    questions: input.questions,
    title: "Platform Engineer",
    url: `https://${input.domain}/jobs/${input.atsJobId}`,
  });
}

test("Reviews, auto-answers and sent Snapshots are recorded, and the report reads them back", async ({
  reportHarness,
}) => {
  const { owner, userId } = await ownerFor(reportHarness.server);

  await prepareProfile(owner);

  const reviewCompany = await seedCompany(owner, "Larkspur Health", "larkspur.example");
  const reviewBoard = await seedBoard(owner, reviewCompany, "greenhouse", "larkspur");

  const firstPosting = await seedReviewPosting(owner, {
    atsJobId: "larkspur-1",
    boardId: reviewBoard,
    companyId: reviewCompany,
    domain: "larkspur.example",
    questions: reviewQuestions,
  });

  const secondPosting = await seedReviewPosting(owner, {
    atsJobId: "larkspur-2",
    boardId: reviewBoard,
    companyId: reviewCompany,
    domain: "larkspur.example",
    questions: reviewQuestions,
  });

  const first = await seedApplication(owner, {
    postingId: firstPosting,
    status: "preparing",
    userId,
  });

  const second = await seedApplication(owner, {
    postingId: secondPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, first);
  await prepare(owner, second);

  const [review] = await reviewsFor(owner, userId);

  if (review === undefined) {
    throw new Error("preparing the review form opened no Review");
  }

  expect(review).toMatchObject({
    prompt: "What is your current or previous job title?",
    reason: "unknown_required",
    status: "open",
  });

  const afterOpen = auditEvents(reportHarness.server);

  const opened = afterOpen.filter((event) => event.kind === "review_opened");

  expect(opened).toHaveLength(1);
  expect(detailSchema.parse(JSON.parse(opened[0]?.detail ?? "{}"))).toMatchObject({
    reason: "unknown_required",
    repeat: false,
  });

  const answered = await owner.post(`/api/reviews/${review.id}/answer`, {
    data: { value: "Staff Platform Engineer" },
  });

  expect(answered.ok()).toBe(true);

  const statuses = await applicationsFor(owner, userId);

  expect(statuses.find((row) => row.id === first)?.status).toBe("ready");
  expect(statuses.find((row) => row.id === second)?.status).toBe("ready");

  const authCompany = await seedCompany(owner, "Tidewater Systems", "tidewater.example");
  const authBoard = await seedBoard(owner, authCompany, "greenhouse", "tidewater");

  const authPosting = await seedReviewPosting(owner, {
    atsJobId: "tidewater-1",
    boardId: authBoard,
    companyId: authCompany,
    domain: "tidewater.example",
    questions: [
      {
        answerKind: "unknown" as const,
        fieldName: "question_auth",
        fieldType: "select" as const,
        options: ["Yes", "No"],
        required: true,
        text: "Are you authorized to work in the UK?",
      },
    ],
  });

  const third = await seedApplication(owner, {
    postingId: authPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, third);

  const authReview = (await reviewsFor(owner, userId)).find((row) =>
    row.prompt.startsWith("Are you authorized to work in the UK?"),
  );

  if (authReview === undefined) {
    throw new Error("the work-authorisation question opened no Review");
  }

  const authAnswered = await owner.post(`/api/reviews/${authReview.id}/answer`, {
    data: { value: "Graduate visa" },
  });

  expect(authAnswered.ok()).toBe(true);

  const repeated = (await reviewsFor(owner, userId)).find(
    (row) =>
      row.prompt.startsWith("Are you authorized to work in the UK?") &&
      row.reason === "option_missing",
  );

  expect(repeated).toMatchObject({ reason: "option_missing", status: "open" });

  const sendPostingCompany = await seedCompany(owner, "Example Company", "exampleco.example");
  const sendBoard = await seedBoard(owner, sendPostingCompany, "greenhouse", "exampleco");

  const sendPosting = await seedPosting(owner, {
    atsJobId: "7006005001",
    boardId: sendBoard,
    companyId: sendPostingCompany,
    questions: sendQuestions,
    title: "Sample Feature Analyst",
    url: `${reportHarness.fixture.url}/exampleco/jobs/7006005001`,
  });

  const sendApplication = await seedApplication(owner, {
    postingId: sendPosting,
    status: "preparing",
    userId,
  });

  await prepare(owner, sendApplication);

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === sendApplication)?.status,
  ).toBe("ready");

  await grantApplications(owner, 3);
  await runJob(owner, "application.send", JSON.stringify({ applicationId: sendApplication }));

  expect(
    (await applicationsFor(owner, userId)).find((row) => row.id === sendApplication)?.status,
  ).toBe("sent");

  const events = auditEvents(reportHarness.server);

  const snapshotEvents = events.filter((event) => event.kind === "snapshot_sent");

  expect(snapshotEvents).toHaveLength(1);
  expect(snapshotEvents[0]?.ats).toBe("greenhouse");
  expect(detailSchema.parse(JSON.parse(snapshotEvents[0]?.detail ?? "{}"))).toMatchObject({
    confirmedBy: "page",
  });

  const autoAnswers = events.filter((event) => event.kind === "auto_answer");
  const sources = new Set(autoAnswers.map((event) => event.source));

  expect(sources.has("fact")).toBe(true);
  expect(sources.has("consent")).toBe(true);
  expect(
    autoAnswers.some((event) => event.source === "fact" && event.factKey === "legal_name"),
  ).toBe(true);
  expect(autoAnswers.some((event) => event.factRevision !== null)).toBe(true);

  const resolutions = events
    .filter((event) => event.kind === "review_resolved")
    .toSorted((left, right) => left.at - right.at);

  expect(resolutions).toHaveLength(2);
  expect(
    resolutions.map((event) => detailSchema.parse(JSON.parse(event.detail)).resolution),
  ).toEqual(["answered", "answered"]);

  const repeatOpened = events.filter(
    (event) =>
      event.kind === "review_opened" &&
      detailSchema.parse(JSON.parse(event.detail)).repeat === true,
  );

  expect(repeatOpened).toHaveLength(1);

  const { db } = openDatabase(reportHarness.server.databasePath);
  const report = buildReviewReport(db, { since: null });

  expect(report.prepared).toBe(4);
  expect(report.reviews).toBe(3);
  expect(report.reviewsPer100).toBe(75);
  expect(report.repeatRate).toBeCloseTo(1 / 3);
  expect(report.sent).toBe(1);
  expect(report.coverage).toBe(0.25);
  expect(report.byAts).toEqual([
    { ats: "greenhouse", prepared: 4, reviews: 3, reviewsPer100: 75, sent: 1 },
  ]);
  expect(report.questionFamilies.map((family) => family.reviews)).toEqual([2, 1]);
  expect(
    report.questionFamilies.find((family) => family.prompt.startsWith("Are you authorized")),
  ).toMatchObject({ repeats: 1, reviews: 2 });
  expect(report.answersBySource.find((row) => row.source === "fact")?.answers).toBeGreaterThan(0);
  expect(report.answersBySource.find((row) => row.source === "consent")?.answers).toBeGreaterThan(
    0,
  );
  expect(report.resolutions).toMatchObject({ answered: 2, autoDismissed: 0, dismissed: 0 });

  const personal = createPersonalCrypto(db, parseMasterKey(authTestIdentity.masterKey, 1), 1);

  const audit = await sampleSnapshotAudit(db, personal, { sample: 1, seed: "e2e", since: null });

  expect(audit.selected).toBe(1);

  const [entry] = audit.snapshots;

  expect(entry?.company).toBe("Example Company");
  const firstName = entry?.answers.find((answer) => answer.label === "First Name");

  expect(firstName).toMatchObject({
    factKey: "legal_name",
    kind: "fact",
    label: "First Name",
    source: "fact",
    value: "Maya",
  });
  expect(firstName?.factRevision).toBeGreaterThan(0);
  expect(entry?.answers.find((answer) => answer.label === "Email")).toMatchObject({
    factKey: "email",
    source: "fact",
    value: "maya.okafor@example.com",
  });

  const redacted = redactSnapshotAudit(audit);

  expect(JSON.stringify(redacted)).not.toContain('"value"');
  expect(redacted.snapshots[0]?.answers.every((answer) => answer.hasValue)).toBe(true);
});

test("the report script writes values only to a mode-600 file", async ({ reportHarness }) => {
  const { owner, userId } = await ownerFor(reportHarness.server);

  await prepareProfile(owner);

  const companyId = await seedCompany(owner, "Example Company", "exampleco.example");
  const boardId = await seedBoard(owner, companyId, "greenhouse", "exampleco");

  const postingId = await seedPosting(owner, {
    atsJobId: "7006005001",
    boardId,
    companyId,
    questions: sendQuestions,
    title: "Sample Feature Analyst",
    url: `${reportHarness.fixture.url}/exampleco/jobs/7006005001`,
  });

  const applicationId = await seedApplication(owner, {
    postingId,
    status: "preparing",
    userId,
  });

  await prepare(owner, applicationId);
  await grantApplications(owner, 3);
  await runJob(owner, "application.send", JSON.stringify({ applicationId }));

  const directory = mkdtempSync(join(tmpdir(), "overture-review-report-out-"));
  const out = join(directory, "audit.json");

  const child = Bun.spawn({
    cmd: [
      "bun",
      "run",
      "scripts/review-report.ts",
      "--db",
      reportHarness.server.databasePath,
      "--sample",
      "1",
      "--seed",
      "e2e",
      "--out",
      out,
    ],
    env: {
      ...process.env,
      ...testAuthEnvironment,
      OBJECT_STORE_ROOT: join(directory, "objects"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const parsed = reportSchema.parse(JSON.parse(stdout));

  expect(parsed.report.prepared).toBe(1);
  expect(parsed.report.reviews).toBe(0);
  expect(parsed.report.sent).toBe(1);
  expect(parsed.audit.selected).toBe(1);
  expect(parsed.audit.snapshots[0]?.answers.some((answer) => answer.factKey === "legal_name")).toBe(
    true,
  );
  expect(parsed.out).toBe(out);

  expect(statSync(out).mode % 0o1000).toBe(0o600);

  const written = writtenAuditSchema.parse(JSON.parse(readFileSync(out, "utf8")));

  const answer = written.snapshots[0]?.answers.find(
    (candidate) => candidate.label === "First Name",
  );

  expect(answer).toMatchObject({ factKey: "legal_name", value: "Maya" });
});
