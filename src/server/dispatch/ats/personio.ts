import type { Page } from "playwright-core";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_WAIT_MS,
  FORM_APPEAR_MS,
  preflightForm,
} from "../forms/engine.ts";
import type { LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";
import { personioApplyUrl, readPersonioFormHtml } from "../../pipeline/personio-form.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

import { cssValue, normText } from "./shared.ts";

export const PERSONIO_FORM_SELECTOR = "form:has(button[type='submit'])";

export const PERSONIO_SUBMIT_PATH = /^\/api\/v1\/jobs\/\d+\/application$/u;

const DOCUMENT_PILL_MS = 15_000;
const SUBMIT_ENABLED_MS = 30_000;

const PERSONIO_CONFIRMATION = [
  /(?:thank you|thanks) for (?:applying|your application|your interest|your submission)/iu,
  /application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)/iu,
  /we(?:['’]?ve| have) received your application/iu,
  /vielen dank für (?:ihre|deine) bewerbung/iu,
  /bewerbung (?:wurde )?(?:erfolgreich )?(?:gesendet|eingegangen|erhalten)/iu,
];

export interface PersonioRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface PersonioHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
}

export type PersonioOutcome =
  | "sent"
  | "unconfirmed"
  | "blocked"
  | "captcha_blocked"
  | "form_changed"
  | "form_missing"
  | "fill_failed"
  | "upload_failed"
  | "identity_mismatch"
  | "needs_review";

export interface PersonioRun {
  outcome: PersonioOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  preflight?: LiveFormProblem[];
  unexpectedRequired?: LiveFormProblem[];
}

export async function readPersonioQuestions(page: Page) {
  const form = page.locator(PERSONIO_FORM_SELECTOR).first();
  const count = await form.count();

  if (count === 0) {
    return [];
  }

  const html = await form.evaluate((element) => element.outerHTML);

  return (await readPersonioFormHtml(html)).questions;
}

async function fillText(page: Page, fieldName: string, value: string) {
  const control = page.locator(`[name="${cssValue(fieldName)}"]`).first();

  if ((await control.count()) === 0) {
    return false;
  }

  await control.fill(value);

  return true;
}

async function fillSelect(page: Page, fieldName: string, value: string) {
  const control = page.locator(`select[name="${cssValue(fieldName)}"]`).first();

  if ((await control.count()) === 0) {
    return false;
  }

  const labels = await control.locator("option").allTextContents();
  const index = labels.findIndex((label) => normText(label) === normText(value));

  if (index === -1) {
    return false;
  }

  await control.selectOption({ index });

  return true;
}

async function fillCheckbox(page: Page, fieldName: string, value: string) {
  const control = page.locator(`input[type='checkbox'][name="${cssValue(fieldName)}"]`).first();

  if ((await control.count()) === 0) {
    return false;
  }

  await control.setChecked(!["", "0", "false", "no", "unchecked"].includes(normText(value)));

  return true;
}

async function fillPlannedFields(page: Page, fields: readonly SendPlanField[]) {
  type Fill = (index: number) => Promise<boolean>;

  const fillFrom: Fill = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return true;
    }

    if (
      field.fieldType === "file" ||
      field.answer === null ||
      field.fieldName === null ||
      field.fieldName === ""
    ) {
      return fillFrom(index + 1);
    }

    let filled: boolean;

    if (field.fieldType === "select") {
      filled = await fillSelect(page, field.fieldName, field.answer);
    } else if (field.fieldType === "checkbox") {
      filled = await fillCheckbox(page, field.fieldName, field.answer);
    } else {
      filled = await fillText(page, field.fieldName, field.answer);
    }

    return filled ? fillFrom(index + 1) : false;
  };

  return fillFrom(0);
}

async function uploadDocuments(
  page: Page,
  resume: PlannedResume,
  fields: readonly SendPlanField[],
) {
  const resumeField = fields.find((field) => field.fieldType === "file" && field.file === "resume");

  const fieldName = resumeField?.fieldName ?? resume.fieldName ?? "documents.cv";
  const input = page.locator(`input[type='file'][name="${cssValue(fieldName)}"]`).first();

  if ((await input.count()) === 0) {
    return false;
  }

  try {
    await input.setInputFiles({
      buffer: Buffer.from(resume.bytes),
      mimeType: "application/pdf",
      name: resume.filename,
    });
  } catch {
    return false;
  }

  return waitForDocumentPill(page, resume.filename);
}

async function waitForDocumentPill(page: Page, filename: string) {
  try {
    await page.waitForFunction(
      ({ name }: { name: string }) => {
        const pills = [...document.querySelectorAll("[role='listitem'] span")];

        return pills.some((pill) => pill.textContent.replaceAll(/\s+/gu, " ").trim() === name);
      },
      { name: filename },
      { timeout: DOCUMENT_PILL_MS },
    );
  } catch {
    return false;
  }

  return true;
}

async function waitForSubmitEnabled(page: Page) {
  const button = page.locator(`${PERSONIO_FORM_SELECTOR} button[type='submit']`).first();

  if ((await button.count()) === 0) {
    return false;
  }

  try {
    await button.waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
    await page.waitForFunction(
      (selector: string) => {
        const candidate = document.querySelector<HTMLButtonElement>(selector);

        return candidate !== null && !candidate.disabled;
      },
      `${PERSONIO_FORM_SELECTOR} button[type='submit']`,
      { timeout: SUBMIT_ENABLED_MS },
    );
  } catch {
    return false;
  }

  return true;
}

async function waitForPersonioConfirmation(page: Page) {
  try {
    await page.waitForFunction(
      (sources: string[]) => {
        const text = document.body.textContent;
        const formGone = document.querySelector("form") === null;

        return sources.some((source) => new RegExp(source, "iu").test(text)) && formGone;
      },
      PERSONIO_CONFIRMATION.map((pattern) => pattern.source),
      { timeout: CONFIRMATION_WAIT_MS },
    );
  } catch {
    return false;
  }

  return true;
}

function expectationsFor(plan: PersonioRunPlan) {
  const expectations: LiveFormExpectation[] = plan.fields.map((field) => ({
    answer: field.answer,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    file:
      field.fieldType === "file" && field.file === "resume" && plan.resume !== null
        ? { name: plan.resume.filename, size: plan.resume.bytes.byteLength }
        : null,
    label: field.label,
    options: field.options,
    required: field.required,
  }));

  if (plan.resume !== null) {
    const covered = expectations.some(
      (expectation) => expectation.fieldType === "file" && expectation.file !== null,
    );

    if (!covered) {
      expectations.push({
        answer: null,
        fieldName: plan.resume.fieldName ?? "documents.cv",
        fieldType: "file",
        file: { name: plan.resume.filename, size: plan.resume.bytes.byteLength },
        label: "Resume",
        options: [],
        required: true,
      });
    }
  }

  return expectations;
}

export const runPersonioAttempt: (
  page: Page,
  plan: PersonioRunPlan,
  hooks: PersonioHooks,
) => Promise<PersonioRun> = async (page, plan, hooks) => {
  const applyUrl = personioApplyUrl(plan.identity.url) ?? plan.identity.url;

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

  const form = page.locator(PERSONIO_FORM_SELECTOR).first();

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

  if (plan.resume !== null) {
    const uploaded = await uploadDocuments(page, plan.resume, plan.fields);

    if (!uploaded) {
      return {
        confirmationSeen: false,
        outcome: "upload_failed",
        submitMayHaveLanded: false,
        submitResponseStatus: null,
      };
    }
  }

  if (!(await fillPlannedFields(page, plan.fields))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const verdict = await preflightForm(page, expectationsFor(plan), PERSONIO_FORM_SELECTOR);

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

  if (!(await waitForSubmitEnabled(page))) {
    return {
      confirmationSeen: false,
      outcome: "captcha_blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const submitButton = page.locator(`${PERSONIO_FORM_SELECTOR} button[type='submit']`).first();

  hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitButton.click({ timeout: APPLICATION_RESPONSE_MS }),
    page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        PERSONIO_SUBMIT_PATH.test(new URL(candidate.url()).pathname),
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

  const confirmed = await waitForPersonioConfirmation(page);

  if (confirmed) {
    return {
      confirmationSeen: true,
      outcome: "sent",
      submitMayHaveLanded: true,
      submitResponseStatus: status,
    };
  }

  if (status !== null && status >= 400 && status < 500) {
    return {
      confirmationSeen: false,
      outcome: "blocked",
      submitMayHaveLanded: false,
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
