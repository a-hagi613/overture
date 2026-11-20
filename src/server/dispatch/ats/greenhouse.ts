import type { Page } from "playwright-core";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

import {
  fillField,
  formLocator,
  norm,
  readConfirmation,
  submitButton,
  uploadFile,
  watchApplicationResponse,
} from "../forms/engine.ts";

const FORM_APPEAR_MS = 15_000;

export interface PlannedResume {
  fieldName: string | null;
  filename: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface GreenhouseRunPlan {
  url: string;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface GreenhouseHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
}

export type GreenhouseOutcome =
  | "sent"
  | "unconfirmed"
  | "captcha_blocked"
  | "blocked"
  | "form_missing"
  | "fill_failed"
  | "upload_failed";

export interface GreenhouseRun {
  outcome: GreenhouseOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
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

export async function runGreenhouseAttempt(
  page: Page,
  plan: GreenhouseRunPlan,
  hooks: GreenhouseHooks,
) {
  await page.goto(plan.url, { waitUntil: "domcontentloaded" });

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

  const fillFrom = async (index: number) => {
    const field = plan.fields[index];

    if (field === undefined) {
      return true;
    }

    if (field.fieldType === "file") {
      return fillFrom(index + 1);
    }

    if (!(await fillSendPlanField(page, field))) {
      return false;
    }

    return fillFrom(index + 1);
  };

  if (!(await fillFrom(0))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const { resume } = plan;
  const resumeField = plan.fields.find((field) => isResumeField(field));

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

  hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitButton(page).click(),
    watchApplicationResponse(page),
  ]);

  const [, response] = settled;
  const status = response.status === "fulfilled" ? response.value.status() : null;

  hooks.onResponse(status);

  if (status !== null && status >= 400 && status < 500) {
    return {
      confirmationSeen: false,
      outcome: status === 428 ? "captcha_blocked" : "blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  const confirmationPath = `${new URL(plan.url).pathname.replace(/\/+$/u, "")}/confirmation`;

  const confirmationSeen =
    status !== null && status < 400 ? await readConfirmation(page, confirmationPath) : false;

  return {
    confirmationSeen,
    outcome: confirmationSeen ? "sent" : "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
}
