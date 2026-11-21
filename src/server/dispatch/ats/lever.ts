import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import {
  APPLICATION_RESPONSE_MS,
  FORM_APPEAR_MS,
  fillField,
  formLocator,
  preflightForm,
  readConfirmation,
  submitPathnameOf,
  uploadFile,
  watchApplicationResponse,
} from "../forms/engine.ts";
import type { LiveFormExpectation, LiveFormProblem } from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { FormQuestionsResult, PlannedResume } from "./shared.ts";

const RESUME_FIELD = "resume";
const RESUME_READ_MS = 15_000;

export interface LeverRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface LeverHooks {
  onWillSubmit: () => void;
  onResponse: (status: number | null) => void;
  onFormQuestions: (questions: readonly FormQuestion[]) => Promise<FormQuestionsResult>;
}

export type LeverOutcome =
  | "sent"
  | "unconfirmed"
  | "blocked"
  | "form_changed"
  | "form_missing"
  | "fill_failed"
  | "upload_failed"
  | "identity_mismatch"
  | "needs_review";

export interface LeverRun {
  outcome: LeverOutcome;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
  submitMayHaveLanded: boolean;
  identityReason?: PostingIdentityMismatch;
  preflight?: LiveFormProblem[];
  unexpectedRequired?: LiveFormProblem[];
}

const SKIP_NAMES = [
  "accountId",
  "h-captcha-response",
  "linkedInData",
  "origin",
  "referer",
  "resumeStorageId",
  "selectedLocation",
  "socialReferralKey",
  "socialSource",
  "source",
  "timezone",
];

const FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["email", "email"],
  ["tel", "phone"],
  ["url", "url"],
  ["number", "number"],
  ["date", "date"],
]);

export async function readLeverQuestions(page: Page) {
  return page.evaluate(
    (input: { skip: string[]; fieldTypes: [string, QuestionFieldType][] }) => {
      const form = document.querySelector("form#application-form");
      const fieldTypes = new Map(input.fieldTypes);

      if (form === null) {
        return [];
      }

      const groups = new Map<
        string,
        (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]
      >();

      for (const element of form.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea")) {
        const name = element.getAttribute("name") ?? "";
        const type = element instanceof HTMLInputElement ? element.type : "";

        if (
          name === "" ||
          input.skip.includes(name) ||
          type === "hidden" ||
          type === "submit" ||
          type === "button"
        ) {
          continue;
        }

        groups.set(name, [...(groups.get(name) ?? []), element]);
      }

      const questions: FormQuestion[] = [];

      const GENERIC_LABEL = /^please (?:check|select) all that apply:?$/iu;

      for (const [fieldName, elements] of groups) {
        const [first] = elements;

        if (first === undefined) {
          continue;
        }

        const box = first.closest(".application-question");
        const labelElement = box?.querySelector(".application-label");

        const innerLabel = (
          labelElement?.querySelector(".text")?.textContent ??
          labelElement?.textContent ??
          ""
        )
          .replaceAll(/[✱*]/gu, "")
          .replaceAll(/\s+/gu, " ")
          .trim();

        const heading = box
          ?.closest(".section")
          ?.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > h4");

        const label = GENERIC_LABEL.test(innerLabel)
          ? (heading?.textContent ?? "").replaceAll(/\s+/gu, " ").trim() || innerLabel
          : innerLabel;

        if (label === "") {
          continue;
        }

        const required =
          elements.some((element) => element.required) ||
          (labelElement === null || labelElement === undefined
            ? false
            : labelElement.querySelector(".required") !== null);

        const checks = elements.filter(
          (element): element is HTMLInputElement =>
            element instanceof HTMLInputElement &&
            (element.type === "checkbox" || element.type === "radio"),
        );

        if (first instanceof HTMLInputElement && first.type === "file") {
          continue;
        }

        if (checks.length > 0) {
          questions.push({
            fieldName,
            label,
            fieldType: checks[0]?.type === "radio" ? "radio" : "multiselect",
            required,
            options: checks.map((element) => {
              const alternative =
                element.parentElement?.querySelector(
                  ".application-answer-alternative, .eeo-option-text",
                )?.textContent ?? "";

              const text = alternative.replaceAll(/\s+/gu, " ").trim();

              return text === "" ? element.value : text;
            }),
          });
        } else if (first instanceof HTMLSelectElement) {
          questions.push({
            fieldName,
            label,
            fieldType: "select",
            required,
            options: [...first.options].flatMap((option) =>
              option.value === "" ? [] : [option.textContent.replaceAll(/\s+/gu, " ").trim()],
            ),
          });
        } else if (first instanceof HTMLTextAreaElement) {
          questions.push({ fieldName, label, fieldType: "textarea", required, options: [] });
        } else {
          const type = first instanceof HTMLInputElement ? first.type : "";

          questions.push({
            fieldName,
            label,
            fieldType: fieldTypes.get(type) ?? "text",
            required,
            options: [],
          });
        }
      }

      return questions;
    },
    { fieldTypes: [...FIELD_TYPES], skip: SKIP_NAMES },
  );
}

async function fillPlannedFields(page: Page, fields: readonly SendPlanField[]) {
  const fillFrom: (index: number) => Promise<boolean> = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return true;
    }

    if (field.fieldType === "file" || field.answer === null) {
      return fillFrom(index + 1);
    }

    if (field.fieldName === null || field.fieldName === "") {
      return false;
    }

    if (!(await fillField(page, field.fieldName, field.answer))) {
      return false;
    }

    return fillFrom(index + 1);
  };

  return fillFrom(0);
}

async function waitForResumeRead(page: Page) {
  await page
    .waitForFunction(
      () => {
        const working = document.querySelector<HTMLElement>(
          "#application-form .resume-upload-working",
        );

        const filename = (
          document.querySelector("#application-form .filename")?.textContent ?? ""
        ).trim();

        return filename !== "" || (working?.offsetParent ?? null) === null;
      },
      undefined,
      { timeout: RESUME_READ_MS },
    )
    .catch(() => undefined);
}

export const runLeverAttempt: (
  page: Page,
  plan: LeverRunPlan,
  hooks: LeverHooks,
) => Promise<LeverRun> = async (page, plan, hooks) => {
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

  const questions = await readLeverQuestions(page);
  const discovered = await hooks.onFormQuestions(questions);

  if (discovered.kind === "needs_review") {
    return {
      confirmationSeen: false,
      outcome: "needs_review",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  if (!(await fillPlannedFields(page, discovered.fields))) {
    return {
      confirmationSeen: false,
      outcome: "fill_failed",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  if (plan.resume !== null) {
    const fieldName =
      plan.resume.fieldName === null || plan.resume.fieldName === ""
        ? RESUME_FIELD
        : plan.resume.fieldName;

    const uploaded = await uploadFile(page, fieldName, {
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

    await waitForResumeRead(page);
  }

  const expectations: LiveFormExpectation[] = discovered.fields.map((field) => ({
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
      fieldName: plan.resume.fieldName ?? RESUME_FIELD,
      fieldType: "file",
      file: { name: plan.resume.filename, size: plan.resume.bytes.byteLength },
      label: "Resume",
      options: [],
      required: true,
    });
  }

  const verdict = await preflightForm(page, expectations);

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

  const submitPath =
    (await submitPathnameOf(page, new URL(plan.identity.url).pathname)) ??
    new URL(plan.identity.url).pathname;

  const submitButton = page
    .locator(
      "form#application-form #btn-submit, form#application-form button[data-qa='btn-submit'], form#application-form button[type='submit'], form#application-form input[type='submit']",
    )
    .first();

  hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitButton.click({ timeout: APPLICATION_RESPONSE_MS }),
    watchApplicationResponse(page, submitPath),
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

  if (status !== null && status >= 400 && status < 500) {
    return {
      confirmationSeen: false,
      outcome: "blocked",
      submitMayHaveLanded: false,
      submitResponseStatus: status,
    };
  }

  const thanksPath = `${submitPath.replace(/\/apply\/?$/u, "")}/thanks`;

  const confirmationSeen =
    status !== null && status < 500 ? await readConfirmation(page, thanksPath) : false;

  return {
    confirmationSeen,
    outcome: confirmationSeen ? "sent" : "unconfirmed",
    submitMayHaveLanded: true,
    submitResponseStatus: status,
  };
};
