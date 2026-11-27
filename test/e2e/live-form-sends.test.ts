import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import type { SendPlanField } from "../../src/server/pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../src/shared/questions.ts";

import {
  DrySubmitStoppedError,
  fillErrorCode,
  fillFailureNote,
  readJazzhrQuestions,
  readLeverQuestions,
  runJazzhrAttempt,
  runLeverAttempt,
  startRecordedPage,
} from "./live-form.fixture.ts";

const FIXTURES = join(process.cwd(), "test/e2e/fixtures/forms");

const RESUME_BYTES = new Uint8Array(
  readFileSync(join(process.cwd(), "test/e2e/fixtures/resume-board.pdf")),
);

const JOBGETHER = {
  boardToken: "jobgether",
  fixture: join(FIXTURES, "lever/jobgether-2821491e-4bfc-483e-bbb6-e28276e3e808.fixture.html"),
  jobId: "2821491e-4bfc-483e-bbb6-e28276e3e808",
};

const USMOBILE = {
  boardToken: "usmobile",
  fixture: join(FIXTURES, "lever/usmobile-9109cef4-59db-4fb9-84f7-c9e158b4b1bb.fixture.html"),
  jobId: "9109cef4-59db-4fb9-84f7-c9e158b4b1bb",
};

const JAZZHR = {
  fixture: join(FIXTURES, "jazzhr/cmhatv-WyOeWuBjhH.fixture.html"),
  jobId: "WyOeWuBjhH",
  path: "/apply/WyOeWuBjhH/Leadership-Administrative-Support-Senior-Leadership-Team",
};

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

const drySubmitHooks = () => {
  let willSubmit = 0;

  return {
    hooks: {
      onResponse: () => undefined,
      onWillSubmit: () => {
        willSubmit += 1;

        throw new DrySubmitStoppedError();
      },
    },
    get willSubmit() {
      return willSubmit;
    },
  };
};

test("a fill failure names the field and kind on the attempt", () => {
  expect(
    fillErrorCode(
      { fieldName: "location", fieldType: "text", label: "Current location" },
      "fill_failed",
    ),
  ).toBe("fill_failed:text:location");
  expect(
    fillErrorCode({ fieldName: null, fieldType: null, label: "Current location" }, "fill_failed"),
  ).toBe("fill_failed:unknown:Current location");
  expect(fillErrorCode(undefined, "fill_failed")).toBe("fill_failed:unknown");
  expect(fillErrorCode(undefined, "form_changed")).toBeNull();
  expect(
    fillFailureNote({ fieldName: "location", fieldType: "text", label: "Current location" }),
  ).toBe("The Current location field could not be filled");
});

test("JazzHR's live form_submit_new_resume is found, filled and stops before Submit", async ({
  page,
}) => {
  const server = startRecordedPage(JAZZHR.fixture, JAZZHR.path);

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });

    const questions = await readJazzhrQuestions(page);

    expect(questions.map((question) => question.fieldName)).toEqual(
      expect.arrayContaining([
        "resumator-firstname-value",
        "resumator-lastname-value",
        "resumator-email-value",
        "resumator-phone-value",
      ]),
    );

    const plan = {
      fields: [
        answered("resumator-firstname-value", "text", "First Name", "Maya"),
        answered("resumator-lastname-value", "text", "Last Name", "Okafor"),
        answered("resumator-email-value", "email", "Email Address", "maya.okafor@example.com"),
        answered("resumator-phone-value", "phone", "Phone", "+1 416 555 0199"),
        answered(
          "resumator-license-value",
          "select",
          "Do you have a valid driver's license?",
          "Yes",
        ),
        answered(
          "resumator-questionnaire[1433406]",
          "select",
          "What is the highest level of COMPLETED education you currently possess?",
          "Bachelor's Degree",
        ),
        answered(
          "resumator-questionnaire[1433420]",
          "textarea",
          "Are you currently completing relevant education?",
          "No",
        ),
        answered(
          "resumator-questionnaire[1584515]",
          "text",
          "If you did not upload documents, do you have proof of your credentials?",
          "Yes",
        ),
        answered(
          "resumator-questionnaire[2368885]",
          "select",
          "INTERNAL CANDIDATES ONLY: Have you completed less than 6 months of work in a permanent, full time role with the agency?",
          "No",
        ),
      ],
      identity: {
        ats: "jazzhr" as const,
        boardToken: "",
        companyName: "CMHA Thames Valley",
        jobId: JAZZHR.jobId,
        url: server.url,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const drySubmit = drySubmitHooks();

    await expect(runJazzhrAttempt(page, plan, drySubmit.hooks)).rejects.toBeInstanceOf(
      DrySubmitStoppedError,
    );

    expect(drySubmit.willSubmit).toBe(1);
    expect(server.state.posts).toHaveLength(0);
    expect(await page.locator("#resumator-firstname-value").inputValue()).toBe("Maya");
    expect(await page.locator("#resumator-email-value").inputValue()).toBe(
      "maya.okafor@example.com",
    );
    expect(
      await page
        .locator("#resumator-license-value")
        .evaluate((select) =>
          select instanceof HTMLSelectElement ? select.selectedOptions[0]?.textContent : null,
        ),
    ).toBe("Yes");
  } finally {
    server.close();
  }
});

test("Jobgether's live Lever location commits its selectedLocation suggestion and stops before Submit", async ({
  page,
}) => {
  const server = startRecordedPage(
    JOBGETHER.fixture,
    `/${JOBGETHER.boardToken}/${JOBGETHER.jobId}/apply`,
  );

  try {
    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "text", "Phone", "+1 416 555 0199"),
        answered("location", "text", "Current location", "Ottawa, ON, Canada"),
        answered("org", "text", "Current company", "Shopwise Commerce"),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: JOBGETHER.boardToken,
        companyName: "Jobgether",
        jobId: JOBGETHER.jobId,
        url: server.url,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const drySubmit = drySubmitHooks();

    await expect(runLeverAttempt(page, plan, drySubmit.hooks)).rejects.toBeInstanceOf(
      DrySubmitStoppedError,
    );

    expect(drySubmit.willSubmit).toBe(1);
    expect(server.state.posts).toHaveLength(0);
    expect(await page.locator("input[name='location']").inputValue()).toBe("Ottawa, ON, CAN");
    expect(JSON.parse(await page.locator("#selected-location").inputValue())).toMatchObject({
      id: "3f129681498c6943c4a2ffe672db1ab9dcf14b99",
      name: "Ottawa, ON, CAN",
    });
  } finally {
    server.close();
  }
});

test("US Mobile's live Lever form fills its required cards and stops before Submit", async ({
  page,
}) => {
  const server = startRecordedPage(
    USMOBILE.fixture,
    `/${USMOBILE.boardToken}/${USMOBILE.jobId}/apply`,
  );

  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });

    const questions = await readLeverQuestions(page);

    expect(questions.map((question) => question.label)).toEqual(
      expect.arrayContaining([
        "Current location",
        "Are you able to work in our Toronto office 3 days a week?",
        "Are you authorized to work lawfully in Canada for US Mobile Inc?",
      ]),
    );

    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "text", "Phone", "+1 416 555 0199"),
        answered("location", "text", "Current location", "Toronto, ON, Canada"),
        answered("org", "text", "Current company", "Shopwise Commerce"),
        answered("urls[LinkedIn]", "text", "LinkedIn URL", "https://linkedin.com/in/mayachen"),
        answered(
          "cards[60d2c17f-6332-482e-ba91-a6f739b3cbe8][field0]",
          "radio",
          "Are you able to work in our Toronto office 3 days a week?",
          "Yes",
        ),
        answered(
          "cards[44b1cc2e-d3b5-40a9-b34d-c7ce1ed2d0da][field0]",
          "radio",
          "Are you open to relocation?",
          "Yes",
        ),
        answered(
          "cards[cc0de686-68a3-465f-bb85-c240fc0acefa][field0]",
          "textarea",
          "What are your salary expectations for this role?",
          "CAD 120,000",
        ),
        answered(
          "cards[e19ac17c-3203-4bb3-9521-59425d121325][field0]",
          "radio",
          "Are you authorized to work lawfully in Canada for US Mobile Inc?",
          "Yes",
        ),
        answered(
          "cards[e19ac17c-3203-4bb3-9521-59425d121325][field1]",
          "radio",
          "Are you authorized to work lawfully in the US for US Mobile Inc?",
          "No",
        ),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: USMOBILE.boardToken,
        companyName: "US Mobile",
        jobId: USMOBILE.jobId,
        url: server.url,
      },
      resume: { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" },
    };

    const drySubmit = drySubmitHooks();

    await expect(runLeverAttempt(page, plan, drySubmit.hooks)).rejects.toBeInstanceOf(
      DrySubmitStoppedError,
    );

    expect(drySubmit.willSubmit).toBe(1);
    expect(server.state.posts).toHaveLength(0);
    expect(await page.locator("input[name='location']").inputValue()).toBe("Toronto, ON, CAN");
  } finally {
    server.close();
  }
});

test("a Lever location with no matching suggestion fails with the field name and kind", async ({
  page,
}) => {
  const server = startRecordedPage(
    JOBGETHER.fixture,
    `/${JOBGETHER.boardToken}/${JOBGETHER.jobId}/apply`,
  );

  try {
    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("location", "text", "Current location", "Atlantis, ZZ, Nowhere"),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: JOBGETHER.boardToken,
        companyName: "Jobgether",
        jobId: JOBGETHER.jobId,
        url: server.url,
      },
      resume: null,
    };

    const run = await runLeverAttempt(page, plan, {
      onResponse: () => undefined,
      onWillSubmit: () => undefined,
    });

    expect(run.outcome).toBe("fill_failed");
    expect(run.fillFailure).toEqual({
      fieldName: "location",
      fieldType: "text",
      label: "Current location",
    });
    expect(server.state.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("a genuinely new required Lever question still blocks instead of filling silently", async ({
  page,
}) => {
  const server = startRecordedPage(
    JOBGETHER.fixture,
    `/${JOBGETHER.boardToken}/${JOBGETHER.jobId}/apply`,
    {
      mutate: (html) =>
        html.replace(
          "</form>",
          `<div class="application-question"><label><div class="application-label">Do you hold a security clearance? <span class="required">✱</span></div><div class="application-field"><input name="new_clearance" required></div></label></div></form>`,
        ),
    },
  );

  try {
    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("location", "text", "Current location", "Ottawa, ON, Canada"),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: JOBGETHER.boardToken,
        companyName: "Jobgether",
        jobId: JOBGETHER.jobId,
        url: server.url,
      },
      resume: null,
    };

    const run = await runLeverAttempt(page, plan, {
      onResponse: () => undefined,
      onWillSubmit: () => undefined,
    });

    expect(run.outcome).toBe("needs_review");
    expect(run.unexpectedRequired?.map((problem) => problem.fieldName)).toContain("new_clearance");
    expect(server.state.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});
