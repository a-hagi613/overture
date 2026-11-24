import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { batch3Page, startBatch3Page } from "./batch3-ats.fixture.ts";

import type { Batch3Board } from "./batch3-ats.fixture.ts";
import type { SendPlanField } from "../../src/server/pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../src/shared/questions.ts";

import { readBreezyFormHtml } from "../../src/server/pipeline/breezy-form.ts";
import { runBreezyAttempt } from "../../src/server/dispatch/ats/breezy.ts";
import { runClearCompanyAttempt } from "../../src/server/dispatch/ats/clearcompany.ts";
import { runJoinComAttempt } from "../../src/server/dispatch/ats/join-com.ts";
import { runPinpointAttempt } from "../../src/server/dispatch/ats/pinpoint.ts";
import { runSoftgardenAttempt } from "../../src/server/dispatch/ats/softgarden.ts";
import { APPLY_SUPPORTED_ATS, isApplySupportedAts } from "../../src/shared/ats.ts";

const RESUME_BYTES = new Uint8Array(
  readFileSync(join(process.cwd(), "test/e2e/fixtures/resume-board.pdf")),
);

interface BoardCase {
  board: Batch3Board;
  path: (jobId: string) => string;
  resumeName: string;
  run: typeof runBreezyAttempt;
}

const BOARDS: readonly BoardCase[] = [
  {
    board: "breezy",
    path: (jobId) => `/example/p/${jobId}-senior-backend-engineer/apply`,
    resumeName: "resume",
    run: runBreezyAttempt,
  },
  {
    board: "softgarden",
    path: (jobId) => `/example/job/${jobId}/apply`,
    resumeName: "resume",
    run: runSoftgardenAttempt,
  },
  {
    board: "clearcompany",
    path: (jobId) => `/example/${jobId}`,
    resumeName: "resumeFile",
    run: runClearCompanyAttempt,
  },
  {
    board: "join_com",
    path: (jobId) => `/companies/example/${jobId}-senior-backend-engineer`,
    resumeName: "resume",
    run: runJoinComAttempt,
  },
  {
    board: "pinpoint",
    path: (jobId) => `/example/postings/${jobId}`,
    resumeName: "application_form[application][cv]",
    run: runPinpointAttempt,
  },
];

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
  extra: Partial<SendPlanField> = {},
) => field(fieldName, fieldType, label, { answer, answerKind: "fact", required: true, ...extra });

function planFor(board: BoardCase, url: string) {
  return {
    fields: [
      answered("first_name", "text", "First name", "Maya"),
      answered("last_name", "text", "Last name", "Okafor"),
      answered("email", "email", "Email", "maya.okafor@example.com"),
      answered("phone", "phone", "Phone", "+1 416 555 0199"),
      answered("work_auth", "select", "Are you legally authorized to work in Canada?", "Yes", {
        options: ["Yes", "No"],
      }),
      field(board.resumeName, "file", "Resume", {
        answerKind: "fact",
        file: "resume",
        required: true,
      }),
      answered(
        "privacy_consent",
        "multiselect",
        "I agree to the privacy policy",
        "I agree to the privacy policy",
        {
          answerKind: "consent",
          options: ["I agree to the privacy policy"],
        },
      ),
    ],
    identity: {
      ats: board.board,
      boardToken: "example",
      companyName: "Example",
      jobId: board.board === "join_com" ? "123-senior-backend-engineer" : "123",
      url,
    },
    resume: { bytes: RESUME_BYTES, fieldName: board.resumeName, filename: "resume-board.pdf" },
  };
}

function recordingHooks() {
  const events: string[] = [];

  return {
    events,
    hooks: {
      onResponse: (status: number | null) => {
        events.push(`response:${String(status)}`);
      },
      onWillSubmit: () => {
        events.push("submit");
      },
    },
  };
}

for (const board of BOARDS) {
  test.describe(`${board.board} adapter`, () => {
    test("fills only the approved plan, uploads the resume and confirms the send", async ({
      page,
    }) => {
      const server = startBatch3Page(batch3Page(board.board));

      try {
        const url = `${server.url}${board.path("123")}`;
        const { events, hooks } = recordingHooks();
        const run = await board.run(page, planFor(board, url), hooks);

        expect(run.outcome).toBe("sent");
        expect(run.confirmationSeen).toBe(true);
        expect(run.submitMayHaveLanded).toBe(true);
        expect(run.submitResponseStatus).toBe(200);
        expect(events).toEqual(["submit", "response:200"]);
        expect(server.posts).toHaveLength(1);
        expect(server.posts[0]?.path).toBe(`/api/apply/${board.board}`);
        expect(server.posts[0]?.fields).toMatchObject({
          email: "maya.okafor@example.com",
          first_name: "Maya",
          last_name: "Okafor",
          phone: "+1 416 555 0199",
          privacy_consent: "yes",
          work_auth: "yes",
        });
        expect(server.posts[0]?.files).toEqual({ [board.resumeName]: "resume-board.pdf" });
        expect(server.uploads.map((upload) => upload.name)).toEqual([board.resumeName]);
        expect(server.posts.some((post) => post.path === "/newsletter")).toBe(false);
      } finally {
        server.close();
      }
    });

    test("never invents an answer for an unexpected required question", async ({ page }) => {
      const server = startBatch3Page(batch3Page(board.board, { unexpectedRequired: true }));

      try {
        const url = `${server.url}${board.path("123")}`;
        const { events, hooks } = recordingHooks();
        const run = await board.run(page, planFor(board, url), hooks);

        expect(run.outcome).toBe("needs_review");
        expect(events).toEqual([]);
        expect(run.submitMayHaveLanded).toBe(false);
        expect(run.unexpectedRequired?.map((problem) => problem.label)).toEqual([
          "Do you hold security clearance?",
        ]);
        expect(server.posts).toHaveLength(0);
      } finally {
        server.close();
      }
    });

    test("never reports a send when the board refuses with a CAPTCHA", async ({ page }) => {
      const server = startBatch3Page(batch3Page(board.board), { captcha: true });

      try {
        const url = `${server.url}${board.path("123")}`;
        const { events, hooks } = recordingHooks();
        const run = await board.run(page, planFor(board, url), hooks);

        expect(run.outcome).toBe("captcha_blocked");
        expect(run.confirmationSeen).toBe(false);
        expect(run.submitMayHaveLanded).toBe(false);
        expect(run.submitResponseStatus).toBe(403);
        expect(events).toEqual(["submit", "response:403"]);
      } finally {
        server.close();
      }
    });

    test("stays unconfirmed when the employer shows no confirmation", async ({ page }) => {
      const server = startBatch3Page(batch3Page(board.board, { noConfirmation: true }));

      try {
        const url = `${server.url}${board.path("123")}`;
        const run = await board.run(page, planFor(board, url), recordingHooks().hooks);

        expect(run.outcome).toBe("unconfirmed");
        expect(run.confirmationSeen).toBe(false);
        expect(run.submitMayHaveLanded).toBe(true);
        expect(run.submitResponseStatus).toBe(200);
        expect(server.posts).toHaveLength(1);
      } finally {
        server.close();
      }
    });

    test("never submits to a posting whose id differs from the approved plan", async ({ page }) => {
      const server = startBatch3Page(batch3Page(board.board));

      try {
        const url = `${server.url}${board.path("999")}`;
        const run = await board.run(page, planFor(board, url), recordingHooks().hooks);

        expect(run.outcome).toBe("identity_mismatch");
        expect(run.identityReason).toBe("job_id");
        expect(server.posts).toHaveLength(0);
      } finally {
        server.close();
      }
    });
  });
}

test("every Batch 3 board is apply-supported and its payload prepares the form the adapter fills", () => {
  for (const { board } of BOARDS) {
    expect(isApplySupportedAts(board)).toBe(true);
    expect(APPLY_SUPPORTED_ATS).toContain(board);
  }

  const read = readBreezyFormHtml(
    `<script id="portal-data" type="application/json">${JSON.stringify({
      data: {
        questions: [
          {
            questions: [
              {
                "\u005Fid": "work-auth",
                options: [{ text: "Yes" }, { text: "No" }],
                required: true,
                text: "Are you legally authorized to work in Canada?",
                type: { id: "multiplechoice" },
              },
            ],
          },
        ],
      },
    })}</script>`,
  );

  expect(read?.questions).toEqual([
    {
      fieldName: "work-auth",
      fieldType: "radio",
      label: "Are you legally authorized to work in Canada?",
      options: ["Yes", "No"],
      required: true,
    },
  ]);
});
