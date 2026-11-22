import { z } from "zod";

import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import {
  APPLICATION_RESPONSE_MS,
  CONFIRMATION_SOURCES,
  CONFIRMATION_WAIT_MS,
  openForm,
  preflightForm,
  uploadFile,
} from "../forms/engine.ts";
import type { FormScope, LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

import { cssValue, normText } from "./shared.ts";

const RESUME_FIELD = "_systemfield_resume";

const FORM_SELECTOR = ".ashby-job-posting-right-pane";

const YES_NO_GROUP = "[class*='ashby-application-form-input-yesno']";
const YES_NO_OPTION = "button.ashby-application-form-input-yesno-option";

const FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["email", "email"],
  ["tel", "phone"],
  ["url", "url"],
  ["number", "number"],
  ["date", "date"],
]);

const ASHBY_STATE = z.enum(["confirmed", "flagged", "error"]);

/**
 * Ashby's submit request is assumed: the sanitised recording strips Ashby's bundle, so it cannot be observed
 * offline. The first real Ashby send confirms it from its attempt log (SPEC §9.4).
 */
export const ASHBY_SUBMIT_PATH = "/api/non-user-graphql";

export interface AshbyRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface AshbyHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
}

export type AshbyOutcome =
  | "sent"
  | "unconfirmed"
  | "blocked"
  | "flagged_spam"
  | "form_changed"
  | "form_missing"
  | "fill_failed"
  | "upload_failed"
  | "identity_mismatch"
  | "needs_review";

export interface AshbyRun {
  outcome: AshbyOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  preflight?: LiveFormProblem[];
  unexpectedRequired?: LiveFormProblem[];
}

export async function readAshbyQuestions(page: Page) {
  return page.evaluate(
    (input: {
      fieldTypes: [string, QuestionFieldType][];
      selector: string;
      yesNo: { group: string; option: string };
    }) => {
      const fieldTypes = new Map(input.fieldTypes);
      const questions: FormQuestion[] = [];

      const roots = [...document.querySelectorAll(input.selector)];

      if (roots.length !== 1) {
        return questions;
      }

      const [root] = roots;

      if (root === undefined) {
        return questions;
      }

      for (const entry of root.querySelectorAll(
        "[class*='ashby-application-form-field-entry'], fieldset[class*='ashby-application-form-input-radio-group'], fieldset[class*='ashby-application-form-input-checkbox-group']",
      )) {
        const labelElement =
          entry.querySelector(":scope > label") ??
          entry.querySelector("label.ashby-application-form-question-title");

        const label = (labelElement?.textContent ?? "").replaceAll(/\s+/gu, " ").trim();

        if (label === "") {
          continue;
        }

        if (entry.querySelector("input[type='file']") !== null) {
          continue;
        }

        const required =
          labelElement instanceof HTMLElement && /(?:^|\s)_required_/u.test(labelElement.className)
            ? true
            : entry.querySelector("[required], [aria-required='true']") !== null;

        const radios = [...entry.querySelectorAll<HTMLInputElement>("input[type='radio']")];

        const boxes = [...entry.querySelectorAll<HTMLInputElement>("input[type='checkbox']")];

        const yesNoOptions = [
          ...entry.querySelectorAll<HTMLButtonElement>(
            `${input.yesNo.group} ${input.yesNo.option}`,
          ),
        ];

        if (yesNoOptions.length > 0) {
          const box = entry.querySelector<HTMLInputElement>(
            `${input.yesNo.group} input[type='checkbox']`,
          );

          questions.push({
            fieldName: box?.name ?? "",
            fieldType: "radio",
            label,
            options: yesNoOptions.map((button) =>
              button.textContent.replaceAll(/\s+/gu, " ").trim(),
            ),
            required,
          });

          continue;
        }

        if (radios.length > 0) {
          const [first] = radios;

          questions.push({
            fieldName: first?.name ?? "",
            fieldType: "radio",
            label,
            options: radios.map((control) => {
              const text =
                control.id === ""
                  ? ""
                  : (document.querySelector(`label[for="${CSS.escape(control.id)}"]`)
                      ?.textContent ?? "");

              return text.replaceAll(/\s+/gu, " ").trim() || control.value;
            }),
            required,
          });

          continue;
        }

        if (boxes.length > 0) {
          const [first] = boxes;

          questions.push({
            fieldName: first?.name ?? "",
            fieldType: "multiselect",
            label,
            options: boxes.map((control) => {
              const text =
                control.id === ""
                  ? ""
                  : (document.querySelector(`label[for="${CSS.escape(control.id)}"]`)
                      ?.textContent ?? "");

              return text.replaceAll(/\s+/gu, " ").trim() || control.value;
            }),
            required,
          });

          continue;
        }

        const select = entry.querySelector<HTMLSelectElement>("select");
        const textarea = entry.querySelector<HTMLTextAreaElement>("textarea");

        const text = entry.querySelector<HTMLInputElement>(
          "input:not([type='file']):not([type='radio']):not([type='checkbox']):not([type='hidden'])",
        );

        if (select !== null) {
          questions.push({
            fieldName: select.name === "" ? select.id : select.name,
            fieldType: "select",
            label,
            options: [...select.options].flatMap((option) =>
              option.value === "" ? [] : [option.textContent.replaceAll(/\s+/gu, " ").trim()],
            ),
            required,
          });

          continue;
        }

        if (textarea !== null) {
          questions.push({
            fieldName: textarea.name === "" ? textarea.id : textarea.name,
            fieldType: "textarea",
            label,
            options: [],
            required,
          });

          continue;
        }

        if (text !== null) {
          let fieldName = text.name;

          if (fieldName === "") {
            fieldName = text.id;
          }

          if (fieldName === "") {
            fieldName = labelElement?.getAttribute("for") ?? "";
          }

          if (fieldName === "") {
            continue;
          }

          questions.push({
            fieldName,
            fieldType: fieldTypes.get(text.type) ?? "text",
            label,
            options: [],
            required,
          });
        }
      }

      return questions;
    },
    {
      fieldTypes: [...FIELD_TYPES],
      selector: FORM_SELECTOR,
      yesNo: { group: YES_NO_GROUP, option: YES_NO_OPTION },
    },
  );
}

async function fillNamedText(scope: FormScope, fieldName: string, value: string) {
  const control = scope.root.locator(`[name="${cssValue(fieldName)}"]`).first();

  if ((await control.count()) > 0) {
    await control.fill(value);

    return true;
  }

  const entry = scope.root
    .locator("[class*='ashby-application-form-field-entry']")
    .filter({ has: scope.page.locator(`label[for="${cssValue(fieldName)}"]`) })
    .first();

  const fallback = entry.locator("textarea, input:not([type='hidden']):not([type='file'])").first();

  if ((await fallback.count()) === 0) {
    return false;
  }

  await fallback.fill(value);

  return true;
}

async function fillRadio(scope: FormScope, fieldName: string, value: string) {
  const group = scope.root.locator(`input[name="${cssValue(fieldName)}"][type='radio']`);
  const count = await group.count();

  if (count === 0) {
    return false;
  }

  const ids = await group.evaluateAll((elements) => elements.map((element) => element.id));

  const labels = await Promise.all(
    ids.map(async (id) =>
      scope.root
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

  const label = scope.root.locator(`label[for="${cssValue(ids[index] ?? "")}"]`).first();

  await label.click();

  return group.nth(index).isChecked();
}

async function pressYesNoOption(scope: FormScope, fieldName: string, value: string) {
  const group = scope.root
    .locator(YES_NO_GROUP)
    .filter({ has: scope.page.locator(`input[name="${cssValue(fieldName)}"]`) })
    .first();

  if ((await group.count()) === 0) {
    return false;
  }

  const options = group.locator(YES_NO_OPTION);
  const labels = await options.allInnerTexts();
  const index = labels.findIndex((label) => normText(label) === normText(value));

  if (index === -1) {
    return false;
  }

  const option = options.nth(index);

  if ((await option.getAttribute("aria-pressed")) !== "true") {
    await option.click();
  }

  return (await option.getAttribute("aria-pressed")) === "true";
}

async function fillAshbyField(scope: FormScope, field: SendPlanField, value: string) {
  if (field.fieldType === "radio") {
    return (
      (await pressYesNoOption(scope, field.fieldName ?? "", value)) ||
      fillRadio(scope, field.fieldName ?? "", value)
    );
  }

  if (field.fieldType === "select") {
    const control = scope.root.locator(`select[name="${cssValue(field.fieldName ?? "")}"]`).first();

    if ((await control.count()) === 0) {
      return false;
    }

    await control.selectOption({ label: value });

    return true;
  }

  return fillNamedText(scope, field.fieldName ?? "", value);
}

async function fillPlannedFields(scope: FormScope, fields: readonly SendPlanField[]) {
  const fillFrom: (index: number) => Promise<boolean> = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return true;
    }

    if (field.fieldType === "file" || field.answer === null) {
      return fillFrom(index + 1);
    }

    if (field.fieldName === null || field.fieldName === "") {
      return fillFrom(index + 1);
    }

    await fillAshbyField(scope, field, field.answer);

    return fillFrom(index + 1);
  };

  return fillFrom(0);
}

async function waitForAshbyState(page: Page) {
  const handle = await page
    .waitForFunction(
      ({ sources }: { sources: readonly string[] }) => {
        const formPresent = document.querySelector(".ashby-application-form-container") !== null;

        const text = document.body.textContent;

        const alerts = [...document.querySelectorAll("[role='alert'], [class*='error']")].flatMap(
          (element) => {
            if (!(element instanceof HTMLElement) || element.offsetParent === null) {
              return [];
            }

            const alert = element.textContent.trim();

            return alert === "" ? [] : [alert];
          },
        );

        const haystack = `${alerts.join("\n")}\n${formPresent ? "" : text}`;

        if (/flagged as (?:possible )?spam/iu.test(haystack)) {
          return "flagged";
        }

        if (!formPresent && sources.some((source) => new RegExp(source, "iu").test(text))) {
          return "confirmed";
        }

        return alerts.length === 0 ? false : "error";
      },
      { sources: CONFIRMATION_SOURCES },
      { polling: 250, timeout: CONFIRMATION_WAIT_MS },
    )
    .catch(() => null);

  if (handle === null) {
    return null;
  }

  const parsed = ASHBY_STATE.safeParse(await handle.jsonValue());

  return parsed.success ? parsed.data : null;
}

export const runAshbyAttempt: (
  page: Page,
  plan: AshbyRunPlan,
  hooks: AshbyHooks,
) => Promise<AshbyRun> = async (page, plan, hooks) => {
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

  const scope = await openForm(page, FORM_SELECTOR);

  if (scope === null) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  if (!(await fillPlannedFields(scope, plan.fields))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  if (plan.resume !== null) {
    const uploaded = await uploadFile(scope, RESUME_FIELD, {
      bytes: plan.resume.bytes,
      mimeType: "application/pdf",
      name: plan.resume.filename,
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

  const expectations: LiveFormExpectation[] = plan.fields.map((field) => ({
    answer: field.answer,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    file: null,
    label: field.label,
    options: field.options,
    required: field.required,
  }));

  if (plan.resume !== null) {
    expectations.push({
      answer: null,
      fieldName: RESUME_FIELD,
      fieldType: "file",
      file: { name: plan.resume.filename, size: plan.resume.bytes.byteLength },
      label: "Resume",
      options: [],
      required: true,
    });
  }

  const verdict = await preflightForm(scope, expectations);

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

  const submitButton = scope.root.locator(".ashby-application-form-submit-button").first();

  hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitButton.click({ timeout: APPLICATION_RESPONSE_MS }),
    page.waitForResponse(
      (candidate) => {
        const url = new URL(candidate.url());

        return (
          candidate.request().method() === "POST" &&
          url.pathname === ASHBY_SUBMIT_PATH &&
          (url.searchParams.get("op") ?? "").toLowerCase().includes("submit")
        );
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

  const state = await waitForAshbyState(page);

  if (state === "confirmed") {
    return {
      confirmationSeen: true,
      outcome: "sent",
      submitMayHaveLanded: true,
      submitResponseStatus: status,
    };
  }

  if (state === "flagged") {
    return {
      confirmationSeen: false,
      outcome: "flagged_spam",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  if (state === "error") {
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

  return {
    confirmationSeen: false,
    outcome: "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
};
