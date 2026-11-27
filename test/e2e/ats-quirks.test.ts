import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import {
  CONFIRMATION_HTML,
  ashbyConsentPage,
  ashbyOverwritePage,
  ashbyResumePage,
  ashbyYesNoPage,
  greenhouseLiveFormPage,
  greenhousePage,
  leverLocationPage,
  leverResumeAutofillPage,
  personioPage,
  startAtsPage,
  workablePage,
} from "./ats-quirks.fixture.ts";

import type { SendPlanField } from "../../src/server/pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../src/shared/questions.ts";
import type { FormScope } from "../../src/server/dispatch/forms/engine.ts";

import { waitForStableForm } from "../../src/server/dispatch/forms/engine.ts";
import { runAshbyAttempt } from "../../src/server/dispatch/ats/ashby.ts";
import { runGreenhouseAttempt } from "../../src/server/dispatch/ats/greenhouse.ts";
import { readLeverQuestions, runLeverAttempt } from "../../src/server/dispatch/ats/lever.ts";
import { runPersonioAttempt } from "../../src/server/dispatch/ats/personio.ts";
import { runWorkableAttempt } from "../../src/server/dispatch/ats/workable.ts";

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
  extra: Partial<SendPlanField> = {},
) => field(fieldName, fieldType, label, { answer, answerKind: "fact", required: true, ...extra });

const resumeUpload = { bytes: RESUME_BYTES, fieldName: null, filename: "resume-board.pdf" };

test("the engine waits for a bounded, in-memory DOM settle before a preflight read", async ({
  page,
}) => {
  await page.setContent(`<!doctype html>
<html lang="en"><body>
<form id="application-form">
  <label for="email">Email</label>
  <input id="email" name="email" value="approved@example.com">
  <button type="submit">Submit application</button>
</form>
<script>
  setTimeout(() => { document.querySelector("#email").value = "parser@example.com"; }, 80);
</script>
</body></html>`);

  const scope: FormScope = { page, root: page.locator("#application-form") };

  expect(await waitForStableForm(scope)).toBe(true);
  expect(await page.locator("#email").inputValue()).toBe("parser@example.com");
});

test("Greenhouse fills and submits the classic application_form root, never the decoy", async ({
  page,
}) => {
  const server = startAtsPage(greenhousePage("/example/jobs/1"));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("last_name", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        field("resume", "file", "Resume/CV", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "greenhouse" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "1",
        url: `${server.url}/example/jobs/1`,
      },
      resume: resumeUpload,
    };

    const run = await runGreenhouseAttempt(page, plan, {
      ...silentHooks,
      onCodeTyped: () => undefined,
      requestCode: async () => {
        await Promise.resolve();

        return null;
      },
    });

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.path).toBe("/example/jobs/1");
    expect(server.posts[0]?.fields).toMatchObject({
      email: "maya.okafor@example.com",
      first_name: "Maya",
      last_name: "Okafor",
    });
    expect(server.posts[0]?.files).toEqual({ resume: "resume-board.pdf" });
    expect(server.posts.some((post) => post.path === "/decoy")).toBe(false);
  } finally {
    server.close();
  }
});

test("a live-shaped Greenhouse form sends after the resume, selects and phone defaults settle", async ({
  page,
}) => {
  const server = startAtsPage(greenhouseLiveFormPage("/example/jobs/1"));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "phone", "Phone", "+1 416 555 0199"),
        answered("country", "select", "Country", "Canada", {
          options: ["Canada", "United States"],
        }),
        answered("candidate-location", "select", "Location (City)", "Ottawa", {
          options: ["Ottawa", "Toronto"],
        }),
        field("", "file", "Resume/CV", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "greenhouse" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "1",
        url: `${server.url}/example/jobs/1`,
      },
      resume: { ...resumeUpload, fieldName: "resume_upload" },
    };

    const run = await runGreenhouseAttempt(page, plan, {
      ...silentHooks,
      onCodeTyped: () => undefined,
      requestCode: async () => {
        await Promise.resolve();

        return null;
      },
    });

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.fields).toMatchObject({
      candidate_location: "ottawa",
      country_field: "CA",
      email: "maya.okafor@example.com",
      first_name: "Maya",
      phone_number: "+1 416 555 0199",
    });
    expect(server.posts[0]?.files).toEqual({ resume_file: "resume-board.pdf" });
  } finally {
    server.close();
  }
});

test("a genuinely changed live Greenhouse form still stops before Submit", async ({ page }) => {
  const server = startAtsPage(greenhouseLiveFormPage("/example/jobs/1", { changed: true }));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("phone", "phone", "Phone", "+1 416 555 0199"),
        answered("country", "select", "Country", "Canada", {
          options: ["Canada", "United States"],
        }),
        answered("candidate-location", "select", "Location (City)", "Ottawa", {
          options: ["Ottawa", "Toronto"],
        }),
        field("", "file", "Resume/CV", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "greenhouse" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "1",
        url: `${server.url}/example/jobs/1`,
      },
      resume: { ...resumeUpload, fieldName: "resume_upload" },
    };

    const run = await runGreenhouseAttempt(page, plan, {
      ...silentHooks,
      onCodeTyped: () => undefined,
      requestCode: async () => {
        await Promise.resolve();

        return null;
      },
    });

    expect(run.outcome).toBe("form_changed");
    expect(server.posts).toHaveLength(0);
    expect(
      run.preflight?.map((problem) => `${problem.kind}:${problem.fieldName ?? problem.label}`),
    ).toEqual(
      expect.arrayContaining([
        "option_not_selected:country",
        "option_not_selected:candidate-location",
      ]),
    );
  } finally {
    server.close();
  }
});

test("Lever refuses a typed location that never committed its selectedLocation backing id", async ({
  page,
}) => {
  const server = startAtsPage(
    leverLocationPage("/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply", false),
  );

  try {
    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("location", "text", "Current location", "London"),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb",
        url: `${server.url}/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply`,
      },
      resume: null,
    };

    const run = await runLeverAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("fill_failed");
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Lever fills and submits a location whose suggestion committed the readable city and backing id", async ({
  page,
}) => {
  const server = startAtsPage(
    leverLocationPage("/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply", true),
  );

  try {
    const plan = {
      fields: [
        answered("name", "text", "Full name", "Maya Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        answered("location", "text", "Current location", "London"),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb",
        url: `${server.url}/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply`,
      },
      resume: null,
    };

    const run = await runLeverAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.fields).toMatchObject({
      email: "maya.okafor@example.com",
      location: "London, United Kingdom",
      selectedLocation: "loc-london",
    });
  } finally {
    server.close();
  }
});

test("a Lever EU host keeps its identity check and submits the same form", async ({ page }) => {
  const path = "/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply";

  await page.route("https://jobs.eu.lever.co/**", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ body: CONFIRMATION_HTML, contentType: "text/html", status: 200 });

      return;
    }

    await route.fulfill({
      body: leverLocationPage(path, true),
      contentType: "text/html",
      status: 200,
    });
  });

  const plan = {
    fields: [
      answered("name", "text", "Full name", "Maya Okafor"),
      answered("email", "email", "Email", "maya.okafor@example.com"),
      answered("location", "text", "Current location", "London"),
    ],
    identity: {
      ats: "lever" as const,
      boardToken: "example",
      companyName: "Example",
      jobId: "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb",
      url: `https://jobs.eu.lever.co${path}`,
    },
    resume: null,
  };

  const run = await runLeverAttempt(page, plan, silentHooks);

  expect(run.outcome).toBe("sent");
});

test("a Lever upload-status line never becomes part of a question label", async ({ page }) => {
  await page.setContent(`<!doctype html>
<html lang="en"><body>
<form id="application-form">
  <ul>
    <li class="application-question">
      <div class="application-label">Why do you want this role?
        <span class="resume-upload-working"><div class="resume-upload-label">Analyzing resume...</div></span>
      </div>
      <div class="application-field"><textarea name="why" required></textarea></div>
    </li>
  </ul>
  <button id="btn-submit" type="submit">Submit application</button>
</form>
</body></html>`);

  const questions = await readLeverQuestions(page);
  const why = questions.find((question) => question.fieldName === "why");

  expect(why?.label).toBe("Why do you want this role?");
});

test("a Lever resume autofill that rewrites an approved field never submits", async ({ page }) => {
  const server = startAtsPage(
    leverResumeAutofillPage("/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply"),
  );

  try {
    const plan = {
      fields: [
        answered("email", "email", "Email", "maya.okafor@example.com"),
        field("resume", "file", "Resume/CV", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "lever" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "2c7db323-e4e8-4c07-8ec6-ad351b0f24eb",
        url: `${server.url}/example/2c7db323-e4e8-4c07-8ec6-ad351b0f24eb/apply`,
      },
      resume: { ...resumeUpload, fieldName: "resume" },
    };

    const run = await runLeverAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("form_changed");
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Ashby uploads the resume attachment, never the optional Autofill from resume dropzone", async ({
  page,
}) => {
  const server = startAtsPage(ashbyResumePage());

  try {
    const plan = {
      fields: [
        answered("_systemfield_name", "text", "Name", "Maya Okafor"),
        answered("_systemfield_email", "email", "Email", "maya.okafor@example.com"),
        field("_systemfield_resume", "file", "Resume", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "ashby" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "123e02c6-445b-42bb-893c-addb1f6d4752",
        url: `${server.url}/example/123e02c6-445b-42bb-893c-addb1f6d4752/application`,
      },
      resume: { ...resumeUpload, fieldName: "_systemfield_resume" },
    };

    const run = await runAshbyAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.uploads.map((upload) => upload.name)).toEqual(["resume-upload"]);
    expect(server.uploads[0]?.file).toBe("resume-board.pdf");
  } finally {
    server.close();
  }
});

test("an Ashby resume autofill that rewrites contact details or consent never submits", async ({
  page,
}) => {
  const server = startAtsPage(ashbyOverwritePage());

  try {
    const plan = {
      fields: [
        answered("_systemfield_email", "email", "Email", "maya.okafor@example.com"),
        answered(
          "privacy-consent",
          "multiselect",
          "I agree to the privacy policy",
          "I agree to the privacy policy",
          {
            answerKind: "consent",
            options: ["I agree to the privacy policy"],
          },
        ),
        field("_systemfield_resume", "file", "Resume", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "ashby" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "123e02c6-445b-42bb-893c-addb1f6d4752",
        url: `${server.url}/example/123e02c6-445b-42bb-893c-addb1f6d4752/application`,
      },
      resume: { ...resumeUpload, fieldName: "_systemfield_resume" },
    };

    const run = await runAshbyAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("form_changed");
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Ashby checks an unchecked consent box through a real Playwright check", async ({ page }) => {
  const server = startAtsPage(ashbyConsentPage());

  try {
    const plan = {
      fields: [
        answered("_systemfield_name", "text", "Name", "Maya Okafor"),
        answered(
          "privacy-consent",
          "multiselect",
          "I agree to the privacy policy",
          "I agree to the privacy policy",
          { answerKind: "consent", options: ["I agree to the privacy policy"] },
        ),
      ],
      identity: {
        ats: "ashby" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "123e02c6-445b-42bb-893c-addb1f6d4752",
        url: `${server.url}/example/123e02c6-445b-42bb-893c-addb1f6d4752/application`,
      },
      resume: null,
    };

    const run = await runAshbyAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
  } finally {
    server.close();
  }
});

test("Ashby reads a yes/no answer from its backing checkbox after a rerender drops aria-pressed", async ({
  page,
}) => {
  const server = startAtsPage(ashbyYesNoPage());

  try {
    const plan = {
      fields: [
        answered("_systemfield_name", "text", "Name", "Maya Okafor"),
        answered("work-auth", "radio", "Are you legally authorized to work in Canada?", "Yes", {
          answerKind: "fact",
          options: ["Yes", "No"],
        }),
      ],
      identity: {
        ats: "ashby" as const,
        boardToken: "example",
        companyName: "Example",
        jobId: "123e02c6-445b-42bb-893c-addb1f6d4752",
        url: `${server.url}/example/123e02c6-445b-42bb-893c-addb1f6d4752/application`,
      },
      resume: null,
    };

    const run = await runAshbyAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
  } finally {
    server.close();
  }
});

test("Personio scopes every locator to the one application form, not a decoy form", async ({
  page,
}) => {
  const server = startAtsPage(personioPage({ confirmPill: true, decoy: true }));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("last_name", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
      ],
      identity: {
        ats: "personio" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "123",
        url: `${server.url}/job/123`,
      },
      resume: { ...resumeUpload, fieldName: "documents.cv" },
    };

    const run = await runPersonioAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.path).toBe("/api/v1/jobs/123/application");
    expect(server.posts.some((post) => post.path === "/newsletter")).toBe(false);
  } finally {
    server.close();
  }
});

test("Personio uploads the resume to documents.cv only and leaves gender and Other untouched", async ({
  page,
}) => {
  const server = startAtsPage(personioPage({ confirmPill: true }));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("last_name", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        field("documents.cv", "file", "Resume", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "personio" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "123",
        url: `${server.url}/job/123`,
      },
      resume: { ...resumeUpload, fieldName: "documents.cv" },
    };

    const run = await runPersonioAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.uploads.map((upload) => upload.name)).toEqual(["documents.cv"]);
    expect(server.posts[0]?.fields.gender).toBe("");
    expect(server.posts[0]?.fields["custom_attribute_1001"]).toBe("");
  } finally {
    server.close();
  }
});

test("Personio refuses a resume mapped to a custom_attribute file slot instead of documents.cv", async ({
  page,
}) => {
  const server = startAtsPage(personioPage({ confirmPill: true }));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "First name", "Maya"),
        answered("last_name", "text", "Last name", "Okafor"),
        answered("email", "email", "Email", "maya.okafor@example.com"),
        field("custom_attribute_1009", "file", "Resume", {
          answerKind: "fact",
          file: "resume",
          required: true,
        }),
      ],
      identity: {
        ats: "personio" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "123",
        url: `${server.url}/job/123`,
      },
      resume: { ...resumeUpload, fieldName: "custom_attribute_1009" },
    };

    const run = await runPersonioAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("upload_failed");
    expect(server.posts).toHaveLength(0);
    expect(server.uploads).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Personio does not accept an upload pill that lives outside the verified form", async ({
  page,
}) => {
  const server = startAtsPage(
    personioPage({ confirmPill: false, decoyPill: true, language: "de" }),
  );

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "Vorname", "Maya"),
        answered("last_name", "text", "Nachname", "Okafor"),
        answered("email", "email", "E-Mail", "maya.okafor@example.com"),
      ],
      identity: {
        ats: "personio" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "123",
        url: `${server.url}/job/123`,
      },
      resume: { ...resumeUpload, fieldName: "documents.cv" },
    };

    const run = await runPersonioAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("upload_failed");
    expect(server.posts).toHaveLength(0);
  } finally {
    server.close();
  }
});

test("Personio matches a German select exactly and never infers gender", async ({ page }) => {
  const server = startAtsPage(personioPage({ confirmPill: true, language: "de" }));

  try {
    const plan = {
      fields: [
        answered("first_name", "text", "Vorname", "Maya"),
        answered("last_name", "text", "Nachname", "Okafor"),
        answered("email", "email", "E-Mail", "maya.okafor@example.com"),
        answered("custom_attribute_1001", "select", "Sprechen Sie Deutsch?", "Ja", {
          options: ["Ja", "Nein"],
        }),
      ],
      identity: {
        ats: "personio" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "123",
        url: `${server.url}/job/123`,
      },
      resume: { ...resumeUpload, fieldName: "documents.cv" },
    };

    const run = await runPersonioAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.fields["custom_attribute_1001"]).toBe("custom_option_2001");
    expect(server.posts[0]?.fields.gender).toBe("");
  } finally {
    server.close();
  }
});

test("Workable uploads the resume to its own slot, never Other documents or the cover letter", async ({
  page,
}) => {
  const server = startAtsPage(workablePage("/j/WK-1001/apply"));

  try {
    const plan = {
      fields: [answered("email", "email", "Email", "maya.okafor@example.com")],
      identity: {
        ats: "workable" as const,
        boardToken: "",
        companyName: "Example",
        jobId: "WK-1001",
        url: `${server.url}/j/WK-1001`,
      },
      resume: resumeUpload,
    };

    const run = await runWorkableAttempt(page, plan, silentHooks);

    expect(run.outcome).toBe("sent");
    expect(server.uploads.map((upload) => upload.name)).toEqual(["resume_file"]);
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0]?.files).toEqual({ resume_file: "resume-board.pdf" });
  } finally {
    server.close();
  }
});
