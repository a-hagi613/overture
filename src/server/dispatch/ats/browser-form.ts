import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_SOURCES,
  CONFIRMATION_WAIT_MS,
  fillField,
  isPositiveAnswer,
  norm,
  openForm,
  preflightForm,
} from "../forms/engine.ts";
import type { FormScope, LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

/**
 * The deterministic browser form every Wave 1A board shares: one verified form
 * root, a resume slot found by name or label, only the approved plan's answers
 * filled, a preflight that fails closed on any live change, and a submit whose
 * outcome is `sent` only when the employer's confirmation is actually seen.
 */
export interface BrowserFormConfig {
  /** The one selector that owns the application form; a second match fails closed. */
  formSelector: string;
  /** Turns the posting URL into the apply URL when the board serves a separate one. */
  applyUrl?: ((url: string) => string | null) | undefined;
  /** The POST that records the application, beyond the same-origin default. */
  submitResponse?: ((url: URL) => boolean) | undefined;
}

export interface BrowserFormPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface BrowserFormHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
}

export type BrowserFormOutcome =
  | "sent"
  | "unconfirmed"
  | "captcha_blocked"
  | "flagged_spam"
  | "blocked"
  | "form_changed"
  | "form_missing"
  | "fill_failed"
  | "upload_failed"
  | "identity_mismatch"
  | "needs_review";

export interface BrowserFormRun {
  outcome: BrowserFormOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  preflight?: LiveFormProblem[];
  unexpectedRequired?: LiveFormProblem[];
}

const BROWSER_FORM_FIELD_TYPES: ReadonlyMap<string, QuestionFieldType> = new Map([
  ["date", "date"],
  ["email", "email"],
  ["number", "number"],
  ["tel", "phone"],
  ["url", "url"],
]);

const RESUME_WORDS = ["resume", "cv", "curriculum vitae"];

const SPAM_PATTERN = /\bflagged as (?:possible )?spam\b/iu;

const CAPTCHA_PATTERN = /\bcaptcha\b|\bcloudflare\b|\bverify you are human\b/iu;

const isResumeField = (field: SendPlanField) =>
  field.fieldType === "file" && field.file === "resume";

const answered = (field: SendPlanField) =>
  field.answer !== null && norm(field.answer) !== "" && field.fieldType !== "file";

const pageSays = async (page: Page, pattern: RegExp) => {
  const text = await page
    .locator("body")
    .textContent()
    .catch(() => null);

  return pattern.test(text ?? "");
};

const pageEventuallySays = async (page: Page, pattern: RegExp) => {
  if (await pageSays(page, pattern)) {
    return true;
  }

  try {
    await page.waitForFunction(
      (source: string) => new RegExp(source, "iu").test(document.body.textContent),
      pattern.source,
      { timeout: 1500 },
    );
  } catch {
    return false;
  }

  return true;
};

/**
 * Reads the controls of a board's application form, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @param config The board's form scope and field type map.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readFormQuestions(page: Page, config: BrowserFormConfig) {
  const fieldTypes = [...BROWSER_FORM_FIELD_TYPES];

  return page.evaluate<
    FormQuestion[],
    {
      fieldTypes: readonly [string, QuestionFieldType][];
      selector: string;
    }
  >(
    (input) => {
      const types = new Map(input.fieldTypes);
      const roots = [...document.querySelectorAll(input.selector)];

      if (roots.length !== 1) {
        return [];
      }

      const [root] = roots;

      if (root === undefined) {
        return [];
      }

      const labelFor = (element: Element) => {
        const ariaLabel = element.getAttribute("aria-label");

        if (ariaLabel !== null && ariaLabel.trim() !== "") {
          return ariaLabel
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const id = element.getAttribute("id");

        if (id !== null && id !== "") {
          const label = root.querySelector(`label[for="${CSS.escape(id)}"]`);

          if (label !== null) {
            return label.textContent
              .replaceAll(/[*✱]/gu, "")
              .replaceAll(/\s+/gu, " ")
              .trim();
          }
        }

        const placeholder = element.getAttribute("placeholder");

        if (placeholder !== null && placeholder.trim() !== "") {
          return placeholder
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const legend = element.closest("fieldset")?.querySelector("legend");

        if (legend !== null && legend !== undefined) {
          return legend.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const field = element.closest(
          "[class*='form-field'], [class*='field'], [class*='question']",
        );

        const fieldLabel = field?.querySelector("label, legend, [class*='question-title']");

        if (fieldLabel !== null && fieldLabel !== undefined) {
          return fieldLabel.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const wrapping = element.closest("label");

        return wrapping === null
          ? ""
          : wrapping.textContent
              .replaceAll(/[*✱]/gu, "")
              .replaceAll(/\s+/gu, " ")
              .trim();
      };

      const optionLabelFor = (element: Element) => {
        const wrapping = element.closest("label");

        if (wrapping !== null) {
          return wrapping.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const id = element.getAttribute("id");

        if (id !== null && id !== "") {
          const label = root.querySelector(`label[for="${CSS.escape(id)}"]`);

          if (label !== null) {
            return label.textContent
              .replaceAll(/[*✱]/gu, "")
              .replaceAll(/\s+/gu, " ")
              .trim();
          }
        }

        return element.getAttribute("value") ?? "";
      };

      const questions: FormQuestion[] = [];
      const seen = new Set<string>();

      for (const element of root.querySelectorAll("input, select, textarea")) {
        const fieldName = element.getAttribute("name") ?? element.getAttribute("id") ?? "";

        if (
          fieldName === "" ||
          seen.has(fieldName) ||
          (element instanceof HTMLInputElement &&
            ["hidden", "submit", "button", "reset", "image"].includes(element.type))
        ) {
          continue;
        }

        seen.add(fieldName);

        const label = labelFor(element);

        if (label === "") {
          continue;
        }

        const required =
          element.hasAttribute("required") || element.getAttribute("aria-required") === "true";

        if (element instanceof HTMLSelectElement) {
          questions.push({
            fieldName,
            fieldType: "select",
            label,
            options: [...element.options].flatMap((option) =>
              option.value === ""
                ? []
                : [
                    option.textContent
                      .replaceAll(/[*✱]/gu, "")
                      .replaceAll(/\s+/gu, " ")
                      .trim(),
                  ],
            ),
            required,
          });

          continue;
        }

        if (element instanceof HTMLTextAreaElement) {
          questions.push({ fieldName, fieldType: "textarea", label, options: [], required });

          continue;
        }

        const radios = [
          ...root.querySelectorAll<HTMLInputElement>(
            `input[type="radio"][name="${CSS.escape(fieldName)}"]`,
          ),
        ];

        if (radios.length > 0) {
          questions.push({
            fieldName,
            fieldType: "radio",
            label,
            options: radios.map((radio) => optionLabelFor(radio)),
            required,
          });

          continue;
        }

        const boxes = [
          ...root.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${CSS.escape(fieldName)}"]`,
          ),
        ];

        if (boxes.length > 0) {
          questions.push({
            fieldName,
            fieldType: "multiselect",
            label,
            options: boxes.map((box) => optionLabelFor(box)),
            required,
          });

          continue;
        }

        if (element instanceof HTMLInputElement) {
          questions.push({
            fieldName,
            fieldType: types.get(element.type) ?? "text",
            label,
            options: [],
            required,
          });
        }
      }

      return questions;
    },
    {
      fieldTypes,
      selector: config.formSelector,
    },
  );
}

async function fillByLabel(scope: FormScope, field: SendPlanField) {
  const { answer } = field;

  if (answer === null) {
    return false;
  }

  try {
    const control = scope.root.getByLabel(field.label, { exact: false }).first();

    if ((await control.count()) === 0) {
      return false;
    }

    const kind = await control.evaluate((element) => {
      if (element instanceof HTMLSelectElement) {
        return "select";
      }

      if (element instanceof HTMLTextAreaElement) {
        return "textarea";
      }

      return element instanceof HTMLInputElement ? element.type : "text";
    });

    if (kind === "select") {
      await control.selectOption({ label: answer }, { timeout: 5000 });

      return true;
    }

    if (kind === "checkbox") {
      await control.setChecked(isPositiveAnswer(answer));

      return true;
    }

    if (kind === "radio") {
      await control.check();

      return true;
    }

    await control.fill(answer);

    return true;
  } catch {
    return false;
  }
}

async function fillPlannedField(scope: FormScope, field: SendPlanField) {
  const { answer, fieldName } = field;

  if (answer === null || fieldName === null || fieldName === "") {
    return false;
  }

  if (await fillField(scope, fieldName, answer)) {
    return true;
  }

  if (
    field.fieldType === "select" ||
    field.fieldType === "radio" ||
    field.fieldType === "multiselect"
  ) {
    return false;
  }

  return fillByLabel(scope, field);
}

async function fillPlannedFields(scope: FormScope, fields: readonly SendPlanField[]) {
  const fillFrom: (index: number) => Promise<boolean> = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return true;
    }

    if (!answered(field)) {
      return fillFrom(index + 1);
    }

    const filled = await fillPlannedField(scope, field);
    const rest = await fillFrom(index + 1);

    return (filled || !field.required) && rest;
  };

  return fillFrom(0);
}

interface FileInputFact {
  id: string;
  index: number;
  label: string;
  name: string;
}

const normalisedWords = (raw: string) =>
  raw
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

const mentionsResume = (fact: FileInputFact, words: readonly string[]) => {
  const text = normalisedWords(`${fact.name} ${fact.id} ${fact.label}`);
  const tokens = text.split(" ");

  return words.some((word) => tokens.includes(word) || text.includes(word));
};

async function fileInputFacts(scope: FormScope) {
  return scope.root.locator("input[type='file']").evaluateAll((elements) =>
    elements.map((element, index) => {
      const id = element.getAttribute("id") ?? "";
      const name = element.getAttribute("name") ?? "";

      const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/u)
        .filter((value) => value !== "")
        .map((value) => document.querySelector(`#${value}`)?.textContent ?? "")
        .join(" ");

      const wrapping = element.closest("label")?.textContent ?? "";

      const form = element.closest("form") ?? document;

      const forLabel =
        id === ""
          ? ""
          : ([...form.querySelectorAll("label[for]")].find(
              (label) => label.getAttribute("for") === id,
            )?.textContent ?? "");

      const block =
        element
          .closest("[class*='form-field'], [class*='field'], [class*='question']")
          ?.querySelector("label, legend, [class*='question-title']")?.textContent ?? "";

      const label =
        [element.getAttribute("aria-label") ?? "", labelledBy, wrapping, forLabel, block]
          .map((text) => text.replaceAll(/\s+/gu, " ").trim())
          .find((text) => text !== "") ?? "";

      return { id, index, label, name };
    }),
  );
}

/**
 * Finds the one resume file input inside the verified form: the plan's file field
 * name first, then a control whose own name, id or label says resume/CV. No
 * resume-ish control, or more than one, returns `null` so the attempt fails closed
 * instead of uploading the resume into a cover-letter or portfolio slot.
 *
 * @param scope The verified application form.
 * @param fieldName The file field name from the approved plan, when it has one.
 * @param words The board's resume words, when it uses its own.
 * @returns The identified resume input, or `null` when the page is ambiguous.
 */
export async function findResumeFileInput(
  scope: FormScope,
  fieldName: string | null,
  words: readonly string[] = RESUME_WORDS,
) {
  const inputs = scope.root.locator("input[type='file']");

  if ((await inputs.count()) === 0) {
    return null;
  }

  const facts = await fileInputFacts(scope);

  if (fieldName !== null && fieldName !== "") {
    const exact = facts.filter((fact) => fact.name === fieldName || fact.id === fieldName);

    const [only] = exact;

    if (only !== undefined) {
      return exact.length === 1 ? inputs.nth(only.index) : null;
    }
  }

  const labelled = facts.filter((fact) => mentionsResume(fact, words));
  const [onlyLabelled] = labelled;

  return labelled.length === 1 && onlyLabelled !== undefined
    ? inputs.nth(onlyLabelled.index)
    : null;
}

async function uploadResume(scope: FormScope, fieldName: string | null, resume: PlannedResume) {
  const input = await findResumeFileInput(scope, fieldName);

  if (input === null) {
    return { fieldName: null, uploaded: false };
  }

  try {
    await input.setInputFiles({
      buffer: Buffer.from(resume.bytes),
      mimeType: "application/pdf",
      name: resume.filename,
    });
  } catch {
    return { fieldName: null, uploaded: false };
  }

  const liveName = (await input.getAttribute("name")) ?? (await input.getAttribute("id"));

  return { fieldName: liveName, uploaded: true };
}

function expectationsFor(plan: BrowserFormPlan, liveResumeField: string | null) {
  const resumeField = plan.fields.find((field) => isResumeField(field));

  const expectations: LiveFormExpectation[] = plan.fields.map((field) => ({
    answer: field.answer,
    fieldName: field === resumeField ? (liveResumeField ?? field.fieldName) : field.fieldName,
    fieldType: field.fieldType,
    file:
      plan.resume !== null && field === resumeField
        ? { name: plan.resume.filename, size: plan.resume.bytes.byteLength }
        : null,
    label: field.label,
    options: field.options,
    required: field.required,
  }));

  if (plan.resume !== null && resumeField === undefined) {
    expectations.push({
      answer: null,
      fieldName: liveResumeField ?? "resume",
      fieldType: "file",
      file: { name: plan.resume.filename, size: plan.resume.bytes.byteLength },
      label: "Resume",
      options: [],
      required: true,
    });
  }

  return expectations;
}

async function confirmationSeen(page: Page, formSelector: string) {
  try {
    await page.waitForFunction(
      ({ sources, selector }: { sources: readonly string[]; selector: string }) => {
        if (document.querySelector(selector) !== null) {
          return false;
        }

        const text = document.body.textContent;

        return sources.some((source) => new RegExp(source, "iu").test(text));
      },
      { selector: formSelector, sources: CONFIRMATION_SOURCES },
      { timeout: CONFIRMATION_WAIT_MS },
    );

    return true;
  } catch {
    return false;
  }
}

const isClientError = (status: number | null) => status !== null && status >= 400 && status < 500;

/**
 * Runs one approved application through a board's deterministic form adapter.
 *
 * @param page The managed browser page.
 * @param plan The approved plan and the posting identity it was approved for.
 * @param hooks The attempt's progress callbacks.
 * @param config The board's form contract.
 * @returns The attempt outcome and what the page proved about it.
 */
export const runBrowserFormAttempt: (
  page: Page,
  plan: BrowserFormPlan,
  hooks: BrowserFormHooks,
  config: BrowserFormConfig,
) => Promise<BrowserFormRun> = async (page, plan, hooks, config) => {
  const applyUrl = config.applyUrl?.(plan.identity.url) ?? plan.identity.url;

  await page.goto(applyUrl, { waitUntil: "domcontentloaded" });

  const identity = await checkPostingIdentity(page, plan.identity);

  if (!identity.ok) {
    return {
      confirmationSeen: false,
      identityReason: identity.reason,
      outcome: "identity_mismatch",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const scope = await openForm(page, config.formSelector);

  if (scope === null) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const resumeField = plan.fields.find((field) => isResumeField(field));
  let liveResumeField = resumeField?.fieldName ?? null;

  if (plan.resume !== null) {
    const uploaded = await uploadResume(scope, liveResumeField, plan.resume);

    if (!uploaded.uploaded) {
      return {
        confirmationSeen: false,
        outcome: "upload_failed",
        submitMayHaveLanded: false,
        submitResponseStatus: null,
      };
    }

    liveResumeField = uploaded.fieldName;
  }

  if (!(await fillPlannedFields(scope, plan.fields))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const verdict = await preflightForm(scope, expectationsFor(plan, liveResumeField));

  if (verdict.outcome !== "ok") {
    return {
      confirmationSeen: false,
      outcome: verdict.outcome,
      preflight: verdict.problems,
      submitMayHaveLanded: false,
      submitResponseStatus: null,
      ...(verdict.outcome === "needs_review" && { unexpectedRequired: verdict.reviewFields }),
    };
  }

  const submitControl = scope.root.locator("button[type='submit'], input[type='submit']");

  if ((await submitControl.count()) === 0) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  hooks.onWillSubmit();

  const { origin } = new URL(page.url());

  const settled = await Promise.allSettled([
    submitControl.first().click({ timeout: APPLICATION_RESPONSE_MS }),
    page.waitForResponse(
      (candidate) => {
        if (candidate.request().method() !== "POST") {
          return false;
        }

        const url = new URL(candidate.url());

        if (config.submitResponse !== undefined) {
          return config.submitResponse(url);
        }

        return url.origin === origin && !url.pathname.startsWith("/__fixture__");
      },
      { timeout: APPLICATION_RESPONSE_MS },
    ),
  ]);

  const [clickOutcome, response] = settled;
  const status = response.status === "fulfilled" ? response.value.status() : null;

  hooks.onResponse(status);

  if (clickOutcome.status === "rejected") {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  if (await pageSays(page, SPAM_PATTERN)) {
    return {
      confirmationSeen: false,
      outcome: "flagged_spam",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  if (isClientError(status)) {
    const captcha = status === 403 && (await pageEventuallySays(page, CAPTCHA_PATTERN));

    return {
      confirmationSeen: false,
      outcome: captcha ? "captcha_blocked" : "blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  const confirmed = await confirmationSeen(page, config.formSelector);

  return {
    confirmationSeen: confirmed,
    outcome: confirmed ? "sent" : "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
};
