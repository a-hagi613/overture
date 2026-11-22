import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_SOURCES,
  CONFIRMATION_WAIT_MS,
  fillField,
  norm,
  isPositiveAnswer,
  openForm,
  preflightForm,
} from "../forms/engine.ts";
import type { FormScope, LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

const RESUME_FIELD = "resume";

/**
 * Workable's hosted apply page marks its one application form with `data-ui="application-form"`; the class and id
 * forms cover the recorded fixtures and any page that drops the attribute. There is no bare `form` fallback: a page
 * with a second form (a newsletter, a hidden duplicate) must fail closed instead of filling the wrong one.
 */
export const WORKABLE_FORM_SELECTOR =
  "form[data-ui='application-form'], form.application-form, form#application-form";

const FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["email", "email"],
  ["tel", "phone"],
  ["url", "url"],
  ["number", "number"],
  ["date", "date"],
]);

const WORKABLE_FIELD_TYPE_ENTRIES: readonly [string, QuestionFieldType][] = [...FIELD_TYPES];

export interface WorkableRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface WorkableHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
}

export type WorkableOutcome =
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

export interface WorkableRun {
  outcome: WorkableOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  preflight?: LiveFormProblem[];
  unexpectedRequired?: LiveFormProblem[];
}

const answered = (field: SendPlanField) =>
  field.answer !== null && norm(field.answer) !== "" && field.fieldType !== "file";

/**
 * Reads the controls of a Workable apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readWorkableQuestions(page: Page) {
  return page.evaluate<
    FormQuestion[],
    { fieldTypes: readonly [string, QuestionFieldType][]; selector: string }
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

        const legend = element.closest("fieldset")?.querySelector("legend");

        if (legend !== null && legend !== undefined) {
          return legend.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const field = element.closest("[class*='form-field'], [class*='field']");

        const fieldLabel = field?.querySelector("label, legend");

        if (fieldLabel !== null && fieldLabel !== undefined) {
          return fieldLabel.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        const wrapping = element.closest("label");

        if (wrapping !== null) {
          return wrapping.textContent
            .replaceAll(/[*✱]/gu, "")
            .replaceAll(/\s+/gu, " ")
            .trim();
        }

        return "";
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
            ["hidden", "submit", "button", "reset", "image", "file"].includes(element.type))
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
              option.value === "" ? [] : [option.textContent.replaceAll(/\s+/gu, " ").trim()],
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
    { fieldTypes: WORKABLE_FIELD_TYPE_ENTRIES, selector: WORKABLE_FORM_SELECTOR },
  );
}

async function fillByLabel(scope: FormScope, field: SendPlanField) {
  const { answer } = field;

  if (answer === null) {
    return false;
  }

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
    await control.selectOption({ label: answer });

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
}

async function fillPlannedField(scope: FormScope, field: SendPlanField) {
  const { answer, fieldName } = field;

  if (answer === null || fieldName === null || fieldName === "") {
    return false;
  }

  if (await fillField(scope, fieldName, answer)) {
    return true;
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

const mentionsResume = (fact: FileInputFact) => {
  const text = normalisedWords(`${fact.name} ${fact.id} ${fact.label}`);
  const words = text.split(" ");

  return words.includes("resume") || words.includes("cv") || text.includes("curriculum vitae");
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
        element.closest("[class*='form-field'], [class*='field']")?.querySelector("label, legend")
          ?.textContent ?? "";

      const label =
        [element.getAttribute("aria-label") ?? "", labelledBy, wrapping, forLabel, block]
          .map((text) => text.replaceAll(/\s+/gu, " ").trim())
          .find((text) => text !== "") ?? "";

      return { id, index, label, name };
    }),
  );
}

/**
 * Finds the one resume file input inside the verified form: the plan's file field name first, then a control whose
 * own name, id or label says resume/CV. No resume-ish control, or more than one, returns `null` so the attempt fails
 * closed instead of uploading the resume into a cover-letter or portfolio slot.
 *
 * @param scope The verified Workable application form.
 * @param fieldName The file field name from the approved plan, when it has one.
 * @returns The identified resume input, or `null` when the page is ambiguous.
 */
export async function findResumeFileInput(scope: FormScope, fieldName: string | null) {
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

  const labelled = facts.filter((fact) => mentionsResume(fact));
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

function submitControl(scope: FormScope) {
  return scope.root.locator("button[type='submit'], input[type='submit']").first();
}

async function listenForSubmit(page: Page, origin: string) {
  return page.waitForResponse(
    (candidate) => {
      if (candidate.request().method() !== "POST") {
        return false;
      }

      const url = new URL(candidate.url());

      return url.origin === origin && !url.pathname.startsWith("/__fixture__");
    },
    { timeout: APPLICATION_RESPONSE_MS },
  );
}

export async function workableConfirmationSeen(page: Page) {
  try {
    await page.waitForFunction(
      ({ sources, formSelector }: { sources: readonly string[]; formSelector: string }) => {
        if (document.querySelector(formSelector) !== null) {
          return false;
        }

        const text = document.body.textContent;

        return sources.some((source) => new RegExp(source, "iu").test(text));
      },
      {
        formSelector:
          "form[data-ui='application-form'], form.application-form, form#application-form",
        sources: CONFIRMATION_SOURCES,
      },
      { timeout: CONFIRMATION_WAIT_MS },
    );

    return true;
  } catch {
    return false;
  }
}

async function pageSays(page: Page, pattern: RegExp) {
  const text = await page
    .locator("body")
    .textContent()
    .catch(() => null);

  return pattern.test(text ?? "");
}

const isClientError = (status: number | null) => status !== null && status >= 400 && status < 500;

const isServerError = (status: number | null) => status !== null && status >= 500;

export const runWorkableAttempt: (
  page: Page,
  plan: WorkableRunPlan,
  hooks: WorkableHooks,
) => Promise<WorkableRun> = async (page, plan, hooks) => {
  await page.goto(plan.identity.url, { waitUntil: "domcontentloaded" });

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

  const scope = await openForm(page, WORKABLE_FORM_SELECTOR);

  if (scope === null) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const filled = await fillPlannedFields(scope, plan.fields);

  const resumeField = plan.fields.find(
    (field) => field.fieldType === "file" && field.file === "resume",
  );

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

  const expectations: LiveFormExpectation[] = plan.fields.map((field) => ({
    answer: field.answer,
    fieldName: field === resumeField ? liveResumeField : field.fieldName,
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
      fieldName: liveResumeField ?? RESUME_FIELD,
      fieldType: "file",
      file: { name: plan.resume.filename, size: plan.resume.bytes.byteLength },
      label: "Resume",
      options: [],
      required: true,
    });
  }

  const verdict = await preflightForm(scope, expectations);

  if (verdict.outcome !== "ok" || !filled) {
    const problems =
      verdict.outcome === "ok"
        ? []
        : verdict.problems.map((problem) => ({
            answer: problem.answer,
            fieldName: problem.fieldName,
            fieldType: problem.fieldType,
            kind: problem.kind,
            label: problem.label,
            options: problem.options,
            unexpected: problem.unexpected,
          }));

    return {
      confirmationSeen: false,
      outcome: verdict.outcome === "ok" ? "fill_failed" : verdict.outcome,
      preflight: problems,
      submitMayHaveLanded: false,
      submitResponseStatus: null,
      ...(verdict.outcome === "needs_review" && { unexpectedRequired: verdict.reviewFields }),
    };
  }

  hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitControl(scope).click({ timeout: APPLICATION_RESPONSE_MS }),
    listenForSubmit(page, new URL(plan.identity.url).origin),
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

  if (await pageSays(page, /\bflagged as (?:possible )?spam\b/iu)) {
    return {
      confirmationSeen: false,
      outcome: "flagged_spam",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  if (isClientError(status)) {
    const captcha =
      status === 403 &&
      (await pageSays(page, /\bcaptcha\b|\bcloudflare\b|\bverify you are human\b/iu));

    return {
      confirmationSeen: false,
      outcome: captcha ? "captcha_blocked" : "blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  if (status !== null && status < 400) {
    const confirmationSeen = await workableConfirmationSeen(page);

    return {
      confirmationSeen,
      outcome: confirmationSeen ? "sent" : "unconfirmed",
      submitMayHaveLanded: true,
      submitResponseStatus: status,
    };
  }

  if (isServerError(status) || status === null) {
    return {
      confirmationSeen: false,
      outcome: "unconfirmed",
      submitMayHaveLanded: true,
      submitResponseStatus: status,
    };
  }

  return {
    confirmationSeen: false,
    outcome: "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
};
