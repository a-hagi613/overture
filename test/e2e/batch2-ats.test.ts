import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  BATCH2_FORM_SELECTORS,
  BATCH2_JOB_IDS,
  BATCH2_PATHS,
  BATCH2_RESUME_NAMES,
  batch2Page,
  startBatch2Page,
} from "./batch2-ats.fixture.ts";

import type { Batch2Board } from "./batch2-ats.fixture.ts";
import type { SendPlanField } from "../../src/server/pipeline/send-plan.ts";
import type { BrowserFormPlan } from "../../src/server/dispatch/ats/browser-form.ts";
import type { QuestionFieldType } from "../../src/shared/questions.ts";

import { bambooHrFabricPage, zohoRecruitWebformPage } from "./live-board-forms.fixture.ts";

import { runTeamtailorAttempt } from "../../src/server/dispatch/ats/teamtailor.ts";
import { runZohoRecruitAttempt } from "../../src/server/dispatch/ats/zoho-recruit.ts";
import { runBambooHRAttempt } from "../../src/server/dispatch/ats/bamboohr.ts";
import { runRecruiteeAttempt } from "../../src/server/dispatch/ats/recruitee.ts";
import { runHireologyAttempt } from "../../src/server/dispatch/ats/hireology.ts";
import { APPLY_SUPPORTED_ATS, BATCH_2_ATS } from "../../src/shared/ats.ts";

const BOARDS = [
  "teamtailor",
  "zoho_recruit",
  "bamboohr",
  "recruitee",
  "hireology",
] as const satisfies readonly Batch2Board[];

const RESUME_BYTES = new Uint8Array(
  readFileSync(join(process.cwd(), "test/e2e/fixtures/resume-board.pdf")),
);

const silentHooks = { onResponse: () => undefined, onWillSubmit: () => undefined };

function field(
  fieldName: string,
  fieldType: QuestionFieldType,
  label: string,
  extra: Partial<SendPlanField> = {},
) {
  return {
    answer: null,
    answerKind: "skip",
    block: null,
    factKey: null,
    factRevision: null,
    fieldName,
    fieldType,
    label,
    options: [],
    questionId: `question-${fieldName}`,
    required: false,
    scope: "",
    sentences: [],
    source: null,
    unit: null,
    file: null,
    ...extra,
  } satisfies SendPlanField;
}

const answered = (
  fieldName: string,
  fieldType: QuestionFieldType,
  label: string,
  answer: string,
  options: string[] = [],
) => field(fieldName, fieldType, label, { answer, answerKind: "fact", options, required: true });

const resumeField = (fieldName: string, label = "Resume") =>
  field(fieldName, "file", label, { answerKind: "fact", file: "resume", required: true });

const identity = (board: Batch2Board, base: string) => ({
  ats: board,
  boardToken: "example",
  companyName: "Northwind",
  jobId: BATCH2_JOB_IDS[board],
  url: `${base}${BATCH2_PATHS[board].posting}`,
});

function planFor(board: Batch2Board, base: string) {
  const resume = { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" };

  if (board === "teamtailor") {
    return {
      fields: [
        answered("candidate[first_name]", "text", "First name", "Maya"),
        answered("candidate[last_name]", "text", "Last name", "Okafor"),
        answered("candidate[email]", "email", "Email", "maya.okafor@example.com"),
        answered("candidate[phone]", "phone", "Phone", "+1 415 555 0134"),
        answered("question_1", "select", "Authorized to work?", "Yes", ["Yes", "No"]),
        resumeField(BATCH2_RESUME_NAMES.teamtailor, "Resume/CV"),
        answered("candidate[consent]", "checkbox", "Privacy policy", "Yes"),
      ],
      identity: identity(board, base),
      resume,
    };
  }

  if (board === "zoho_recruit") {
    return {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("last_name", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "phone", "Phone", "+1 415 555 0134"),
        answered("authorized", "radio", "Authorized to work?", "Yes", ["Yes", "No"]),
        resumeField(BATCH2_RESUME_NAMES.zoho_recruit),
      ],
      identity: identity(board, base),
      resume,
    };
  }

  if (board === "bamboohr") {
    return {
      fields: [
        answered("firstName", "text", "First name", "Maya"),
        answered("lastName", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phoneNumber", "phone", "Phone", "+1 415 555 0134"),
        answered("question_1", "select", "Authorized to work?", "Yes", ["Yes", "No"]),
        resumeField(BATCH2_RESUME_NAMES.bamboohr),
      ],
      identity: identity(board, base),
      resume,
    };
  }

  if (board === "recruitee") {
    return {
      fields: [
        answered("candidate[name]", "text", "Full name", "Maya Okafor"),
        answered("candidate[email]", "email", "Email", "maya.okafor@example.com"),
        answered("candidate[arrangement]", "multiselect", "Work arrangement", "Remote, Hybrid", [
          "Remote",
          "Hybrid",
        ]),
        answered(
          "candidate[question_1]",
          "textarea",
          "Why do you want this role?",
          "I build reliable platform tooling.",
        ),
        resumeField(BATCH2_RESUME_NAMES.recruitee, "CV"),
      ],
      identity: identity(board, base),
      resume,
    };
  }

  return {
    fields: [
      answered("first_name", "text", "First name", "Maya"),
      answered("last_name", "text", "Last name", "Okafor"),
      answered("email", "email", "Email", "maya.okafor@example.com"),
      answered("question_1", "select", "Authorized to work?", "Yes", ["Yes", "No"]),
      resumeField(BATCH2_RESUME_NAMES.hireology),
    ],
    identity: identity(board, base),
    resume,
  };
}

async function runFor(
  board: Batch2Board,
  page: Parameters<typeof runHireologyAttempt>[0],
  plan: BrowserFormPlan,
) {
  if (board === "teamtailor") {
    return runTeamtailorAttempt(page, plan, silentHooks);
  }

  if (board === "zoho_recruit") {
    return runZohoRecruitAttempt(page, plan, silentHooks);
  }

  if (board === "bamboohr") {
    return runBambooHRAttempt(page, plan, silentHooks);
  }

  if (board === "recruitee") {
    return runRecruiteeAttempt(page, plan, silentHooks);
  }

  return runHireologyAttempt(page, plan, silentHooks);
}

test("the registry advertises every Batch 2 board as apply-supported", () => {
  expect(BATCH_2_ATS).toEqual(BOARDS);

  for (const board of BOARDS) {
    expect(APPLY_SUPPORTED_ATS).toContain(board);
  }
});

for (const board of BOARDS) {
  test(`${board}: fills the board form, uploads the resume and reports sent only on confirmation`, async ({
    page,
  }) => {
    const server = startBatch2Page(batch2Page(board));

    try {
      const run = await runFor(board, page, planFor(board, server.url));

      expect(run.outcome).toBe("sent");
      expect(run.confirmationSeen).toBe(true);
      expect(run.submitResponseStatus).toBe(200);
      expect(run.submitMayHaveLanded).toBe(true);
      expect(server.posts).toHaveLength(1);

      const [post] = server.posts;

      expect(post?.path).toBe(BATCH2_PATHS[board].action);
      expect(post?.files[BATCH2_RESUME_NAMES[board]]).toBe("resume-board.pdf");
      expect(post?.fields["email"] ?? post?.fields["candidate[email]"]).toBe(
        "maya.okafor@example.com",
      );
      expect(await page.locator(BATCH2_FORM_SELECTORS[board]).count()).toBe(0);
    } finally {
      server.close();
    }
  });

  test(`${board}: never invents an answer for a required question the plan never approved`, async ({
    page,
  }) => {
    const server = startBatch2Page(batch2Page(board, { extraRequired: true }));

    try {
      const run = await runFor(board, page, planFor(board, server.url));

      expect(run.outcome).toBe("needs_review");
      expect(run.confirmationSeen).toBe(false);
      expect(run.submitMayHaveLanded).toBe(false);
      expect(run.unexpectedRequired?.map((problem) => problem.label)).toEqual(["Current employer"]);
      expect(server.posts).toHaveLength(0);
    } finally {
      server.close();
    }
  });
}

test("a planned option that disappeared stops the send before Submit", async ({ page }) => {
  const server = startBatch2Page(batch2Page("teamtailor", { withoutOption: true }));

  try {
    const plan = planFor("teamtailor", server.url);

    plan.fields = plan.fields.map((candidate) =>
      candidate.fieldName === "question_1" ? { ...candidate, answer: "No" } : candidate,
    );

    const run = await runFor("teamtailor", page, plan);

    expect(run.outcome).toBe("fill_failed");
    expect(run.submitMayHaveLanded).toBe(false);
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("a 5xx after Submit stays unconfirmed and is never called sent", async ({ page }) => {
  const server = startBatch2Page(batch2Page("bamboohr"), { status: 503 });

  try {
    const run = await runFor("bamboohr", page, planFor("bamboohr", server.url));

    expect(run.outcome).toBe("unconfirmed");
    expect(run.confirmationSeen).toBe(false);
    expect(run.submitResponseStatus).toBe(503);
    expect(run.submitMayHaveLanded).toBe(true);
    expect(server.posts).toHaveLength(1);
  } finally {
    server.close();
  }
});

test("a 4xx is blocked before anything is claimed as submitted", async ({ page }) => {
  const server = startBatch2Page(batch2Page("zoho_recruit"), { status: 403 });

  try {
    const run = await runFor("zoho_recruit", page, planFor("zoho_recruit", server.url));

    expect(run.outcome).toBe("blocked");
    expect(run.confirmationSeen).toBe(false);
    expect(run.submitResponseStatus).toBe(403);
    expect(run.submitMayHaveLanded).toBe(false);
  } finally {
    server.close();
  }
});

test("a 2xx without the board's confirmation stays unconfirmed", async ({ page }) => {
  const server = startBatch2Page(batch2Page("hireology"), {
    confirmation: "<h2>Saved for later</h2>",
  });

  try {
    const run = await runFor("hireology", page, planFor("hireology", server.url));

    expect(run.outcome).toBe("unconfirmed");
    expect(run.confirmationSeen).toBe(false);
    expect(run.submitResponseStatus).toBe(200);
    expect(run.submitMayHaveLanded).toBe(true);
    expect(server.posts).toHaveLength(1);
  } finally {
    server.close();
  }
});

test("a plan for another board never drives this board's form", async ({ page }) => {
  const server = startBatch2Page(batch2Page("recruitee"));

  try {
    const plan = planFor("recruitee", server.url);

    plan.identity = { ...plan.identity, ats: "hireology" };

    const run = await runFor("recruitee", page, plan);

    expect(run.outcome).toBe("identity_mismatch");
    expect(run.submitMayHaveLanded).toBe(false);
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("BambooHR opens its Fabric form, fills the popup selects and submits the resume", async ({
  page,
}) => {
  const server = startBatch2Page(bambooHrFabricPage());

  try {
    const plan = {
      fields: [
        answered("firstName", "text", "First Name", "Maya"),
        answered("lastName", "text", "Last Name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "phone", "Phone", "+1 415 555 0134"),
        answered("streetAddress.value", "text", "Address", "123 Main St"),
        answered("city.value", "text", "City", "Ottawa"),
        answered("state.value", "select", "Province", "Ontario", ["Ontario", "Quebec"]),
        answered("zip.value", "text", "Postal Code", "K1A 0B1"),
        answered("countryId.value", "select", "Country", "Canada", ["Canada", "United States"]),
        answered("dateAvailable", "date", "Date Available", "2026-12-01"),
        answered("desiredPay", "text", "Desired Pay", "CAD 150,000 a year"),
        field("coverLetterFileId", "file", "Cover Letter", {
          answerKind: "fact",
          file: null,
          required: false,
        }),
        resumeField("resumeFileId"),
      ],
      identity: {
        ats: "bamboohr" as const,
        boardToken: "example",
        companyName: "Victoria Park",
        jobId: "1",
        url: `${server.url}/example/careers/1`,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const run = await runBambooHRAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(run.preflight).toBeUndefined();
    expect(run.submitMayHaveLanded).toBe(true);
    expect(server.posts).toHaveLength(1);

    const [post] = server.posts;

    expect(post?.fields["firstName"]).toBe("Maya");
    expect(post?.fields["state.value"]).toBe("ON");
    expect(post?.fields["countryId.value"]).toBe("Canada");
    expect(post?.fields["dateAvailable"]).toBe("01/12/2026");
    expect(post?.fields["resumeFileId"]).toBe("resume-board.pdf");
  } finally {
    server.close();
  }
});

test("BambooHR still stops on a genuinely new required question in the Fabric form", async ({
  page,
}) => {
  const server = startBatch2Page(bambooHrFabricPage({ extraRequired: true }));

  try {
    const plan = {
      fields: [
        answered("firstName", "text", "First Name", "Maya"),
        answered("lastName", "text", "Last Name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "phone", "Phone", "+1 415 555 0134"),
        answered("streetAddress.value", "text", "Address", "123 Main St"),
        answered("city.value", "text", "City", "Ottawa"),
        answered("state.value", "select", "Province", "Ontario", ["Ontario", "Quebec"]),
        answered("zip.value", "text", "Postal Code", "K1A 0B1"),
        answered("countryId.value", "select", "Country", "Canada", ["Canada", "United States"]),
        answered("dateAvailable", "date", "Date Available", "2026-12-01"),
        answered("desiredPay", "text", "Desired Pay", "CAD 150,000 a year"),
        field("coverLetterFileId", "file", "Cover Letter", {
          answerKind: "fact",
          file: null,
          required: false,
        }),
        resumeField("resumeFileId"),
      ],
      identity: {
        ats: "bamboohr" as const,
        boardToken: "example",
        companyName: "Victoria Park",
        jobId: "1",
        url: `${server.url}/example/careers/1`,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const run = await runBambooHRAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("needs_review");
    expect(run.submitMayHaveLanded).toBe(false);
    expect(run.unexpectedRequired?.map((problem) => problem.label)).toEqual(["Current employer"]);
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Zoho Recruit opens its webform, fills the picklist and the phone network, and submits", async ({
  page,
}) => {
  const server = startBatch2Page(zohoRecruitWebformPage());

  try {
    const plan = {
      fields: [
        answered("rec-form_last", "text", "Last Name", "Okafor"),
        answered("rec-form_email", "email", "Email", "maya.okafor@example.com"),
        answered("rec-form_gender", "select", "Gender", "Female", ["Female", "Male"]),
        answered("rec-form_phone", "phone", "Mobile", "613-555-0142"),
        resumeField("rec-form_resume_file"),
      ],
      identity: {
        ats: "zoho_recruit" as const,
        boardToken: "example",
        companyName: "International Community Schools",
        jobId: "1",
        url: `${server.url}/example/jobs/Careers/1`,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const run = await runZohoRecruitAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(run.preflight).toBeUndefined();
    expect(run.submitMayHaveLanded).toBe(true);
    expect(server.posts).toHaveLength(1);

    const [post] = server.posts;

    expect(post?.fields["rec-form_last"]).toBe("Okafor");
    expect(post?.fields["gender_posted"]).toBe("Female");
    expect(post?.fields["rec-form_phone"]).toBe("613-555-0142");
    expect(post?.files["rec-form_resume_file"]).toBe("resume-board.pdf");
  } finally {
    server.close();
  }
});
