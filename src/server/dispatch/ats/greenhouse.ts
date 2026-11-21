import type { Page } from "playwright-core";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

import {
  codeStepVisible,
  fillField,
  formLocator,
  norm,
  preflightForm,
  readConfirmation,
  submitButton,
  typeCode,
  submitPathnameOf,
  uploadFile,
  watchApplicationResponse,
} from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { LiveFormProblem } from "../forms/engine.ts";
import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";

const FORM_APPEAR_MS = 15_000;

const CODE_REQUIRED_STATUS = 428;

export interface PlannedResume {
  fieldName: string | null;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface GreenhouseRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface GreenhouseHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
  requestCode: () => Promise<string | null>;
  onCodeTyped: () => void;
}

export type GreenhouseOutcome =
  | "sent"
  | "unconfirmed"
  | "captcha_blocked"
  | "code_timeout"
  | "blocked"
  | "form_missing"
  | "form_changed"
  | "fill_failed"
  | "upload_failed"
  | "identity_mismatch"
  | "needs_review";

export interface GreenhouseRun {
  outcome: GreenhouseOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  /** The live form problems that stopped this try before Submit. */
  preflight?: LiveFormProblem[];
  /** Unexpected required fields that need a durable Fact from the user. */
  unexpectedRequired?: LiveFormProblem[];
}

const RESUME_LABEL = /\b(?:resume|cv|curriculum vitae)\b/u;

const labelTexts = async (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("label")].map((label) => ({
      forId: label.getAttribute("for"),
      text: label.textContent.replaceAll(/\s+/gu, " ").trim(),
    })),
  );

async function fieldIdFor(page: Page, field: SendPlanField) {
  if (field.fieldName !== null && field.fieldName !== "") {
    return field.fieldName;
  }

  const wanted = norm(field.label);
  const labels = await labelTexts(page);

  const exact = labels.find((label) => norm(label.text) === wanted);
  const partial = labels.find((label) => norm(label.text).includes(wanted));

  return (exact ?? partial)?.forId ?? null;
}

const isResumeField = (field: SendPlanField) =>
  field.fieldType === "file" && RESUME_LABEL.test(norm(field.label));

async function fillSendPlanField(page: Page, field: SendPlanField) {
  const fieldId = await fieldIdFor(page, field);

  if (fieldId === null) {
    return false;
  }

  if (field.answer === null) {
    return !field.required;
  }

  return fillField(page, fieldId, field.answer);
}

export const runGreenhouseAttempt: (
  page: Page,
  plan: GreenhouseRunPlan,
  hooks: GreenhouseHooks,
) => Promise<GreenhouseRun> = async (page, plan, hooks) => {
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

  const confirmationPath = `${new URL(plan.identity.url).pathname.replace(/\/+$/u, "")}/confirmation`;

  const submitAndWatch = async () => {
    hooks.onWillSubmit();

    const submitPathname = await submitPathnameOf(page, null);

    const settled = await Promise.allSettled([
      submitButton(page).click(),
      watchApplicationResponse(page, submitPathname),
    ]);

    const [, response] = settled;
    const status = response.status === "fulfilled" ? response.value.status() : null;

    hooks.onResponse(status);

    return status;
  };

  try {
    await formLocator(page).waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
  } catch {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const { resume } = plan;
  const resumeField = plan.fields.find((field) => isResumeField(field));

  const fillFrom: (index: number) => Promise<boolean> = async (index) => {
    const field = plan.fields[index];

    if (field === undefined) {
      return true;
    }

    if (field.fieldType === "file") {
      return fillFrom(index + 1);
    }

    const filled = await fillSendPlanField(page, field);
    const rest = await fillFrom(index + 1);

    return filled && rest;
  };

  const fillFailed = !(await fillFrom(0));

  if (resume !== null) {
    const resumeFieldId =
      resume.fieldName ?? (resumeField === undefined ? null : await fieldIdFor(page, resumeField));

    if (resumeFieldId === null) {
      return {
        confirmationSeen: false,
        outcome: "upload_failed",
        submitMayHaveLanded: false,
        submitResponseStatus: null,
      };
    }

    const uploaded = await uploadFile(page, resumeFieldId, {
      bytes: resume.bytes,
      mimeType: "application/pdf",
      name: resume.filename,
    });

    if (!uploaded) {
      return {
        confirmationSeen: false,
        outcome: "upload_failed",
        submitMayHaveLanded: false,
        submitResponseStatus: null,
      };
    }
  }

  const verdict = await preflightForm(
    page,
    plan.fields.map((field) => ({
      answer: field.answer,
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      file:
        resume !== null && field === resumeField
          ? { name: resume.filename, size: resume.bytes.byteLength }
          : null,
      label: field.label,
      options: field.options,
      required: field.required,
    })),
  );

  if (verdict.outcome !== "ok" || fillFailed) {
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
      outcome: verdict.outcome === "ok" ? "form_changed" : verdict.outcome,
      preflight: problems,
      submitMayHaveLanded: false,
      submitResponseStatus: null,
      ...(verdict.outcome === "needs_review" && { unexpectedRequired: verdict.reviewFields }),
    };
  }

  let status = await submitAndWatch();

  if (status === CODE_REQUIRED_STATUS) {
    if (!(await codeStepVisible(page))) {
      return {
        confirmationSeen: false,
        outcome: "captcha_blocked",
        submitMayHaveLanded: false,
        submitResponseStatus: status,
      };
    }

    const code = await hooks.requestCode();

    if (code === null) {
      return {
        confirmationSeen: false,
        outcome: "code_timeout",
        submitMayHaveLanded: false,
        submitResponseStatus: status,
      };
    }

    await typeCode(page, code);
    hooks.onCodeTyped();

    status = await submitAndWatch();
  }

  if (status !== null && status >= 400 && status < 500) {
    return {
      confirmationSeen: false,
      outcome: status === CODE_REQUIRED_STATUS ? "code_timeout" : "blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  const confirmationSeen =
    status !== null && status < 400 ? await readConfirmation(page, confirmationPath) : false;

  return {
    confirmationSeen,
    outcome: confirmationSeen ? "sent" : "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
};
