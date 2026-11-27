import type { Page } from "playwright-core";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

import { openApplyForm } from "../forms/apply-link.ts";
import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_SOURCES,
  CONFIRMATION_WAIT_MS,
  fillField,
  norm,
  isPositiveAnswer,
  preflightForm,
} from "../forms/engine.ts";
import type { FormScope, LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import { fillControlledField } from "../forms/widgets.ts";
import { findResumeFileInput, readFormQuestions } from "./hosted.ts";
import type { PlannedResume } from "./shared.ts";

const RESUME_FIELD = "resume";

/**
 * Workable's hosted apply page marks its one application form with `data-ui="application-form"`; the class and id
 * forms cover the recorded fixtures and any page that drops the attribute. There is no bare `form` fallback: a page
 * with a second form (a newsletter, a hidden duplicate) must fail closed instead of filling the wrong one.
 */
export const WORKABLE_FORM_SELECTOR =
  "form[data-ui='application-form'], form.application-form, form#application-form";

export interface WorkableRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface WorkableHooks {
  onWillSubmit: () => Promise<void> | void;
  onResponse: (status: number | null) => Promise<void> | void;
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
export const readWorkableQuestions = async (page: Page) =>
  readFormQuestions(page, WORKABLE_FORM_SELECTOR);

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

  return fillControlledField(scope.page, control, answer);
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

  const scope = await openApplyForm(page, WORKABLE_FORM_SELECTOR);

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

  await hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitControl(scope).click({ timeout: APPLICATION_RESPONSE_MS }),
    listenForSubmit(page, new URL(plan.identity.url).origin),
  ]);

  const [clickOutcome, response] = settled;
  const status = response.status === "fulfilled" ? response.value.status() : null;

  await hooks.onResponse(status);

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
