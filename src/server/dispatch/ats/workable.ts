import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_SOURCES,
  CONFIRMATION_WAIT_MS,
  FORM_APPEAR_MS,
  fillField,
  norm,
  isPositiveAnswer,
  preflightForm,
} from "../forms/engine.ts";
import type { LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";
import { cssValue } from "./shared.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

const RESUME_FIELD = "resume";

/**
 * The hosted Workable application is a single form on the apply host. The fallback to a bare `form` covers the
 * recorded fixtures and any page that drops the class; preparation always sends the exact field names the plan
 * was built from, and preflight refuses a form that does not match, so the broad selector cannot cause a wrong fill.
 */
export const WORKABLE_FORM_SELECTOR = "form.application-form, form#application-form, form";

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
  return page.evaluate<FormQuestion[], readonly [string, QuestionFieldType][]>((fieldTypes) => {
    const types = new Map(fieldTypes);

    const root =
      document.querySelector("form.application-form") ??
      document.querySelector("form#application-form") ??
      document.querySelector("form");

    if (root === null) {
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
  }, WORKABLE_FIELD_TYPE_ENTRIES);
}

async function fillByLabel(page: Page, field: SendPlanField) {
  const { answer } = field;

  if (answer === null) {
    return false;
  }

  const control = page.getByLabel(field.label, { exact: false }).first();

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

async function fillPlannedField(page: Page, field: SendPlanField) {
  const { answer, fieldName } = field;

  if (answer === null || fieldName === null || fieldName === "") {
    return false;
  }

  if (await fillField(page, fieldName, answer)) {
    return true;
  }

  return fillByLabel(page, field);
}

async function fillPlannedFields(page: Page, fields: readonly SendPlanField[]) {
  const fillFrom: (index: number) => Promise<boolean> = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return true;
    }

    if (!answered(field)) {
      return fillFrom(index + 1);
    }

    const filled = await fillPlannedField(page, field);
    const rest = await fillFrom(index + 1);

    return (filled || !field.required) && rest;
  };

  return fillFrom(0);
}

async function resumeControl(page: Page, fieldName: string | null) {
  if (fieldName !== null && fieldName !== "") {
    const named = page
      .locator(
        `input[type="file"][name="${cssValue(fieldName)}"], input[type="file"][id="${cssValue(fieldName)}"]`,
      )
      .first();

    if ((await named.count()) > 0) {
      return named;
    }
  }

  const named = page.locator(`input[type="file"][name="${RESUME_FIELD}"]`).first();

  if ((await named.count()) > 0) {
    return named;
  }

  const first = page.locator("input[type='file']").first();

  return (await first.count()) > 0 ? first : null;
}

async function uploadResume(page: Page, fieldName: string | null, resume: PlannedResume) {
  const input = await resumeControl(page, fieldName);

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

export const WORKABLE_SUBMIT_SELECTOR =
  "form.application-form button[type='submit'], form#application-form button[type='submit'], form button[type='submit'], form.application-form input[type='submit'], form#application-form input[type='submit'], form input[type='submit']";

function submitControl(page: Page) {
  return page.locator(WORKABLE_SUBMIT_SELECTOR).first();
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
        formSelector: "form.application-form, form#application-form",
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

  const form = page.locator(WORKABLE_FORM_SELECTOR).first();

  try {
    await form.waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
  } catch {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const filled = await fillPlannedFields(page, plan.fields);

  const resumeField = plan.fields.find((field) => field.fieldType === "file");

  let liveResumeField = resumeField?.fieldName ?? null;

  if (plan.resume !== null) {
    const uploaded = await uploadResume(page, liveResumeField, plan.resume);

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

  const verdict = await preflightForm(page, expectations, WORKABLE_FORM_SELECTOR);

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
    submitControl(page).click({ timeout: APPLICATION_RESPONSE_MS }),
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
