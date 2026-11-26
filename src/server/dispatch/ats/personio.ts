import type { Page } from "playwright-core";

import type { SendPlanField } from "../../pipeline/send-plan.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_WAIT_MS,
  FORM_APPEAR_MS,
  openForm,
  preflightForm,
} from "../forms/engine.ts";
import type { FormScope, LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";
import { personioApplyUrl, readPersonioFormHtml } from "../../pipeline/personio-form.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

import { cssValue, normText } from "./shared.ts";

/**
 * Personio's apply page has one application form, identified by its document
 * upload controls. Anchoring on `documents.*` keeps a cookie banner, newsletter
 * or any other `<form>` with a submit button from being filled or submitted.
 */
export const PERSONIO_FORM_SELECTOR = "form:has(input[name^='documents.'])";

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
  onWillSubmit: () => Promise<void> | void;
  onResponse: (status: number | null) => Promise<void> | void;
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
  const forms = page.locator(PERSONIO_FORM_SELECTOR);

  if ((await forms.count()) !== 1) {
    return [];
  }

  const html = await forms.first().evaluate((element) => element.outerHTML);

  return (await readPersonioFormHtml(html)).questions;
}

async function fillText(scope: FormScope, fieldName: string, value: string) {
  const control = scope.root.locator(`[name="${cssValue(fieldName)}"]`).first();

  if ((await control.count()) === 0) {
    return false;
  }

  await control.fill(value);

  return true;
}

async function fillSelect(scope: FormScope, fieldName: string, value: string) {
  const control = scope.root.locator(`select[name="${cssValue(fieldName)}"]`).first();

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

async function fillCheckbox(scope: FormScope, fieldName: string, value: string) {
  const control = scope.root
    .locator(`input[type='checkbox'][name="${cssValue(fieldName)}"]`)
    .first();

  if ((await control.count()) === 0) {
    return false;
  }

  await control.setChecked(!["", "0", "false", "no", "unchecked"].includes(normText(value)));

  return true;
}

async function fillRadio(scope: FormScope, fieldName: string, value: string) {
  const group = scope.root.locator(`input[type='radio'][name="${cssValue(fieldName)}"]`);
  const count = await group.count();

  if (count === 0) {
    return false;
  }

  const ids = await group.evaluateAll((elements) => elements.map((element) => element.id));

  const labels = await Promise.all(
    ids.map(async (id) =>
      id === ""
        ? ""
        : await scope.root
            .locator(`label[for="${cssValue(id)}"]`)
            .first()
            .textContent()
            .catch(() => ""),
    ),
  );

  const index = labels.findIndex((label) => normText(label) === normText(value));

  if (index === -1) {
    return false;
  }

  await group.evaluateAll((elements, chosen: number) => {
    for (const [position, element] of elements.entries()) {
      if (!(element instanceof HTMLInputElement)) {
        continue;
      }

      const wanted = position === chosen;

      if (element.checked === wanted) {
        continue;
      }

      element.checked = wanted;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, index);

  return true;
}

async function fillMultiselect(scope: FormScope, fieldName: string, value: string) {
  const group = scope.root.locator(`input[type='checkbox'][name="${cssValue(fieldName)}"]`);
  const count = await group.count();

  if (count === 0) {
    return false;
  }

  const wanted = new Set(
    value
      .split(",")
      .map((part) => normText(part))
      .filter((part) => part !== ""),
  );

  const ids = await group.evaluateAll((elements) => elements.map((element) => element.id));

  const labels = await Promise.all(
    ids.map(async (id) =>
      id === ""
        ? ""
        : await scope.root
            .locator(`label[for="${cssValue(id)}"]`)
            .first()
            .textContent(),
    ),
  );

  const matched = new Set<number>();

  for (const [index, label] of labels.entries()) {
    if (wanted.has(normText(label))) {
      matched.add(index);
    }
  }

  if (matched.size !== wanted.size) {
    return false;
  }

  await group.evaluateAll(
    (elements, chosen: number[]) => {
      for (const [index, element] of elements.entries()) {
        if (!(element instanceof HTMLInputElement)) {
          continue;
        }

        const selected = chosen.includes(index);

        if (element.checked === selected) {
          continue;
        }

        element.checked = selected;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    [...matched],
  );

  return true;
}

async function fillPlannedFields(scope: FormScope, fields: readonly SendPlanField[]) {
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
      filled = await fillSelect(scope, field.fieldName, field.answer);
    } else if (field.fieldType === "checkbox") {
      filled = await fillCheckbox(scope, field.fieldName, field.answer);
    } else if (field.fieldType === "radio") {
      filled = await fillRadio(scope, field.fieldName, field.answer);
    } else if (field.fieldType === "multiselect") {
      filled = await fillMultiselect(scope, field.fieldName, field.answer);
    } else {
      filled = await fillText(scope, field.fieldName, field.answer);
    }

    return filled ? fillFrom(index + 1) : false;
  };

  return fillFrom(0);
}

async function uploadDocuments(
  scope: FormScope,
  resume: PlannedResume,
  fields: readonly SendPlanField[],
) {
  const resumeField = fields.find((field) => field.fieldType === "file" && field.file === "resume");
  const requested = resumeField?.fieldName ?? resume.fieldName ?? null;

  if (requested !== null && requested !== "" && !requested.startsWith("documents.")) {
    return false;
  }

  const fieldName = requested === null || requested === "" ? "documents.cv" : requested;
  const input = scope.root.locator(`input[type='file'][name="${cssValue(fieldName)}"]`);

  if ((await input.count()) !== 1) {
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

  return waitForDocumentPill(scope, resume.filename);
}

async function waitForDocumentPill(scope: FormScope, filename: string) {
  try {
    await scope.root
      .getByRole("listitem")
      .getByText(filename, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: DOCUMENT_PILL_MS });
  } catch {
    return false;
  }

  return true;
}

async function waitForSubmitEnabled(scope: FormScope) {
  const button = scope.root.locator("button[type='submit']").first();

  if ((await button.count()) === 0) {
    return false;
  }

  try {
    await button.waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
    await scope.page.waitForFunction(
      (selector: string) => {
        const roots = [...document.querySelectorAll(selector)];

        if (roots.length !== 1) {
          return false;
        }

        const candidate = roots[0]?.querySelector<HTMLButtonElement>("button[type='submit']");

        return candidate !== null && candidate !== undefined && !candidate.disabled;
      },
      PERSONIO_FORM_SELECTOR,
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
      ({ selector, sources }: { selector: string; sources: string[] }) => {
        const text = document.body.textContent;
        const formGone = document.querySelector(selector) === null;

        return formGone && sources.some((source) => new RegExp(source, "iu").test(text));
      },
      {
        selector: PERSONIO_FORM_SELECTOR,
        sources: PERSONIO_CONFIRMATION.map((pattern) => pattern.source),
      },
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
      const slot =
        plan.resume.fieldName?.startsWith("documents.") === true
          ? plan.resume.fieldName
          : "documents.cv";

      expectations.push({
        answer: null,
        fieldName: slot,
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

  const scope = await openForm(page, PERSONIO_FORM_SELECTOR);

  if (scope === null) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  if (plan.resume !== null) {
    const uploaded = await uploadDocuments(scope, plan.resume, plan.fields);

    if (!uploaded) {
      return {
        confirmationSeen: false,
        outcome: "upload_failed",
        submitMayHaveLanded: false,
        submitResponseStatus: null,
      };
    }
  }

  if (!(await fillPlannedFields(scope, plan.fields))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const verdict = await preflightForm(scope, expectationsFor(plan));

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

  if (!(await waitForSubmitEnabled(scope))) {
    return {
      confirmationSeen: false,
      outcome: "captcha_blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const submitButton = scope.root.locator("button[type='submit']").first();

  await hooks.onWillSubmit();

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

  await hooks.onResponse(status);

  if (clickOutcome.status === "rejected") {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
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

  const confirmed = await waitForPersonioConfirmation(page);

  if (confirmed) {
    return {
      confirmationSeen: true,
      outcome: "sent",
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
