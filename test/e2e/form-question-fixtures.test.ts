import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { QUESTION_FIELD_TYPES } from "../../src/shared/questions.ts";
import { readAshbyQuestions } from "../../src/server/dispatch/ats/ashby.ts";
import { readLeverQuestions } from "../../src/server/dispatch/ats/lever.ts";
import { readLeverFormHtml } from "../../src/server/pipeline/form-read.ts";

const FORMS = join(process.cwd(), "test/e2e/fixtures/forms");

interface RecordedForm {
  ats: "lever" | "ashby";
  file: string;
  questions: number;
}

const RECORDED_FORMS: readonly RecordedForm[] = [
  {
    ats: "lever",
    questions: 24,
    file: "lever/levelup-43782e4f-d8c4-4b16-b7ea-9f098bff279a.fixture.html",
  },
  {
    ats: "lever",
    questions: 27,
    file: "lever/levelup-3d887a86-647b-43f7-b4e5-7ea6d7031250.fixture.html",
  },
  {
    ats: "lever",
    questions: 30,
    file: "lever/levelup-fcae827c-13f9-41eb-b9ac-7ca18cac1e14.fixture.html",
  },
  {
    ats: "lever",
    questions: 27,
    file: "lever/levelup-c5beb51c-4d3b-49cd-88ff-ec21f0e7d8c3.fixture.html",
  },
  {
    ats: "lever",
    questions: 13,
    file: "lever/offchainlabs-ea44f500-981b-4d7e-9203-3ada1dc12365.fixture.html",
  },
  {
    ats: "lever",
    questions: 12,
    file: "lever/offchainlabs-52c01c91-582c-42fc-8722-82c3eeb9ed24.fixture.html",
  },
  {
    ats: "lever",
    questions: 14,
    file: "lever/hive-ac502675-09a8-4169-8061-8d49fd4e2c4f.fixture.html",
  },
  {
    ats: "lever",
    questions: 14,
    file: "lever/hive-46a2b956-a8e4-4b91-a404-08121e10bb62.fixture.html",
  },
  {
    ats: "lever",
    questions: 14,
    file: "lever/hive-f00ef9bf-f943-495e-8936-e8cedb53ee46.fixture.html",
  },
  {
    ats: "ashby",
    questions: 4,
    file: "ashby/clera-0a278229-474e-4534-82d0-ebfafe18ad9d.fixture.html",
  },
  {
    ats: "ashby",
    questions: 14,
    file: "ashby/highlightta-1e4f70e2-9d0a-455e-9b08-e84b301e37e6.fixture.html",
  },
  {
    ats: "ashby",
    questions: 15,
    file: "ashby/highlightta-9aa241a9-9022-45d0-9cf0-cacb92a34b35.fixture.html",
  },
  {
    ats: "ashby",
    questions: 14,
    file: "ashby/highlightta-b73b0cf3-adef-4d4c-8fb6-bcaafc6d1c58.fixture.html",
  },
  {
    ats: "ashby",
    questions: 13,
    file: "ashby/highlightta-e8617085-d61c-4b0e-9048-43dccd943ec9.fixture.html",
  },
  {
    ats: "ashby",
    questions: 15,
    file: "ashby/livinghr-541dd4f5-2dd1-4cb0-8649-1f087ba762ec.fixture.html",
  },
  {
    ats: "ashby",
    questions: 5,
    file: "ashby/livinghr-80f323d4-2be8-47a9-9f65-cf808feedeff.fixture.html",
  },
  {
    ats: "ashby",
    questions: 2,
    file: "ashby/livinghr-3921744c-b343-402d-858f-58a1edb21002.fixture.html",
  },
];

test("every recorded Lever and Ashby form parses into questions", async ({ browser }) => {
  await Promise.all(
    RECORDED_FORMS.map(async (form) => {
      const page = await browser.newPage();

      try {
        await page.setContent(readFileSync(join(FORMS, form.file), "utf8"), { waitUntil: "load" });

        const questions =
          form.ats === "lever" ? await readLeverQuestions(page) : await readAshbyQuestions(page);

        expect(questions.length, form.file).toBe(form.questions);

        for (const question of questions) {
          expect(question.label.trim(), form.file).not.toBe("");
          expect(QUESTION_FIELD_TYPES, form.file).toContain(question.fieldType);
          expect([true, false], form.file).toContain(question.required);
          expect(Array.isArray(question.options), form.file).toBe(true);
        }

        expect(
          questions.some((question) => question.required),
          `${form.file} has a required question`,
        ).toBe(true);
      } finally {
        await page.close();
      }
    }),
  );
});

test("the plain HTTP Lever reader returns the same questions as the rendered form", async ({
  browser,
}) => {
  await Promise.all(
    RECORDED_FORMS.flatMap((candidate) =>
      candidate.ats === "lever"
        ? [
            (async () => {
              const page = await browser.newPage();
              const html = readFileSync(join(FORMS, candidate.file), "utf8");

              try {
                await page.setContent(html, { waitUntil: "load" });

                const rendered = await readLeverQuestions(page);
                const plain = await readLeverFormHtml(html);

                expect(plain.questions, candidate.file).toEqual(rendered);
              } finally {
                await page.close();
              }
            })(),
          ]
        : [],
    ),
  );
});

test("the recorded forms carry no captured script, handler, asset or real email", () => {
  for (const form of RECORDED_FORMS) {
    const html = readFileSync(join(FORMS, form.file), "utf8");
    const tags = [...html.matchAll(/<script\b[^>]*>/giu)].map((match) => match[0]);

    expect(
      tags.filter((tag) => tag.includes("/__fixture__/runtime.js")),
      form.file,
    ).toHaveLength(1);
    expect(
      tags.filter((tag) => tag === "<script>"),
      form.file,
    ).toHaveLength(1);
    expect(tags, `${form.file} keeps only the runtime and its metadata`).toHaveLength(2);
    expect(html, `${form.file} has no captured page script`).not.toMatch(/\son[a-z]+\s*=/iu);
    expect(html, `${form.file} has no asset reference`).not.toContain("assets/");
    expect(html, `${form.file} has no third-party frame`).not.toContain("<iframe");
    expect(html, `${form.file} has no nonce or token meta`).not.toMatch(
      /<meta[^>]*name="[^"]*(?:nonce|token)"/iu,
    );

    for (const [email] of html.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu)) {
      expect(email, form.file).toMatch(/@example\.invalid$/u);
    }
  }
});

test("the recorded forms carry the questions the measurement names", async ({ page }) => {
  const canada = "ashby/highlightta-9aa241a9-9022-45d0-9cf0-cacb92a34b35.fixture.html";

  await page.setContent(readFileSync(join(FORMS, canada), "utf8"), { waitUntil: "load" });

  const ashby = await readAshbyQuestions(page);

  expect(
    ashby.find((question) => question.label.startsWith("Are you legally authorized")),
  ).toMatchObject({ fieldType: "radio", options: ["Yes", "No"], required: true });
  expect(
    ashby.find((question) =>
      question.label.startsWith("How would you rate your current Ai Ability"),
    ),
  ).toMatchObject({ fieldType: "radio" });

  const lever = "lever/levelup-3d887a86-647b-43f7-b4e5-7ea6d7031250.fixture.html";

  await page.setContent(readFileSync(join(FORMS, lever), "utf8"), { waitUntil: "load" });

  const questions = await readLeverQuestions(page);

  expect(
    questions.find((question) => question.label.startsWith("How many years of experience")),
  ).toMatchObject({ fieldType: "text", required: true });
  expect(questions.some((question) => question.label.includes("legally authorized to work"))).toBe(
    true,
  );
});

test("a Lever card with a generic field prompt is read by its section heading", async ({
  page,
}) => {
  const hive = "lever/hive-ac502675-09a8-4169-8061-8d49fd4e2c4f.fixture.html";

  await page.setContent(readFileSync(join(FORMS, hive), "utf8"), { waitUntil: "load" });

  const questions = await readLeverQuestions(page);

  expect(
    questions.find((question) => question.label === "How did you hear about us?"),
  ).toMatchObject({
    fieldType: "multiselect",
    options: expect.arrayContaining(["Friend", "LinkedIn", "Other"]),
    required: true,
  });
  expect(questions.some((question) => question.label === "Please check all that apply:")).toBe(
    false,
  );
});
