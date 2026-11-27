import type { Page } from "playwright-core";

import type { FormQuestion, SendPlanField } from "../../pipeline/send-plan.ts";
import type { QuestionFieldType } from "../../../shared/questions.ts";

import { openApplyForm } from "../forms/apply-link.ts";
import {
  APPLICATION_RESPONSE_MS,
  fillField,
  preflightForm,
  readConfirmation,
  submitPathnameOf,
  uploadFile,
  waitForStableForm,
  watchApplicationResponse,
} from "../forms/engine.ts";
import type {
  FillFailure,
  FormScope,
  LiveFormExpectation,
  LiveFormProblem,
} from "../forms/engine.ts";
import { checkPostingIdentity } from "../posting-identity.ts";

import type { PostingIdentity, PostingIdentityMismatch } from "../posting-identity.ts";
import type { PlannedResume } from "./shared.ts";

import { normText } from "./shared.ts";

const RESUME_FIELD = "resume";
const RESUME_READ_MS = 15_000;
const LOCATION_FIELD = "location";
const SELECTED_LOCATION_FIELD = "selectedLocation";
const LOCATION_SUGGESTION_MS = 8000;

const LEVER_UPLOAD_NOISE =
  ".resume-upload-working, .resume-upload-success, .resume-upload-failure, .resume-upload-oversize, .filename, .default-label, [class*='upload-label'], [class*='upload-status']";

export interface LeverRunPlan {
  identity: PostingIdentity;
  fields: readonly SendPlanField[];
  resume: PlannedResume | null;
}

export interface LeverHooks {
  onWillSubmit: () => Promise<void> | void;
  onResponse: (status: number | null) => Promise<void> | void;
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
  /** The planned field the filler could not write, when it returned `fill_failed`. */
  fillFailure?: FillFailure;
}

export const LEVER_SKIP_NAMES = [
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

export const LEVER_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["email", "email"],
  ["tel", "phone"],
  ["url", "url"],
  ["number", "number"],
  ["date", "date"],
]);

export async function readLeverQuestions(page: Page) {
  return page.evaluate(
    (input: { skip: string[]; fieldTypes: [string, QuestionFieldType][]; uploadNoise: string }) => {
      const form = document.querySelector("form#application-form");
      const fieldTypes = new Map(input.fieldTypes);

      const labelText = (element: Element | null | undefined) => {
        if (element === null || element === undefined) {
          return "";
        }

        const clone = element.cloneNode(true);

        if (!(clone instanceof Element)) {
          return "";
        }

        for (const noise of clone.querySelectorAll(input.uploadNoise)) {
          noise.remove();
        }

        return clone.textContent
          .replaceAll(/[✱*]/gu, "")
          .replaceAll(/\s+/gu, " ")
          .trim();
      };

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

        const innerLabel = labelText(labelElement?.querySelector(".text") ?? labelElement);

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
    { fieldTypes: [...LEVER_FIELD_TYPES], skip: LEVER_SKIP_NAMES, uploadNoise: LEVER_UPLOAD_NOISE },
  );
}

async function verifyLocationCommitted(scope: FormScope, answer: string) {
  return scope.root.evaluate(
    (root, { backingName, fieldName, wanted }) => {
      const backing = root.querySelector<HTMLInputElement>(
        `input[name="${CSS.escape(backingName)}"]`,
      );

      if (backing === null) {
        return true;
      }

      const input = root.querySelector<HTMLInputElement>(`input[name="${CSS.escape(fieldName)}"]`);

      const shown = (input?.value ?? "").replaceAll(/\s+/gu, " ").trim().toLowerCase();
      const target = wanted.replaceAll(/\s+/gu, " ").trim().toLowerCase();
      const city = (target.split(",")[0] ?? "").trim();

      const readable = shown !== "" && (shown === target || (city !== "" && shown.includes(city)));

      return readable && backing.value.trim() !== "";
    },
    { backingName: SELECTED_LOCATION_FIELD, fieldName: LOCATION_FIELD, wanted: answer },
  );
}

async function committedLocation(scope: FormScope) {
  return scope.root.evaluate((root) => {
    const input = root.querySelector<HTMLInputElement>(`input[name="location"]`);
    const value = (input?.value ?? "").replaceAll(/\s+/gu, " ").trim();

    return value === "" ? null : value;
  });
}

function locationSuggestionIndex(suggestions: readonly string[], wanted: string) {
  const target = normText(wanted);
  const city = (target.split(",")[0] ?? "").trim();

  if (city === "") {
    return -1;
  }

  const exact = suggestions.findIndex((label) => normText(label) === target);

  if (exact !== -1) {
    return exact;
  }

  const cityMatches = suggestions.flatMap((label, index) => {
    const normalised = normText(label);
    const [name] = normalised.split(",");

    return (name ?? "").trim() === city ? [{ index, normalised }] : [];
  });

  if (cityMatches.length === 0) {
    return -1;
  }

  const regions = target
    .split(",")
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const withRegion = cityMatches.find(({ normalised }) => {
    const offered = normalised.split(",").slice(1);

    return regions.some((region) =>
      offered.some((part) => part === region || part.startsWith(region) || region.startsWith(part)),
    );
  });

  return (withRegion ?? cityMatches[0])?.index ?? -1;
}

async function fillLeverLocation(scope: FormScope, field: SendPlanField) {
  const { answer } = field;
  const fieldName = field.fieldName ?? LOCATION_FIELD;

  if (answer === null) {
    return true;
  }

  const input = scope.root.locator("input.location-input");
  const backing = scope.root.locator(`input[name="${SELECTED_LOCATION_FIELD}"]`);

  if ((await input.count()) === 0 || (await backing.count()) === 0) {
    return fillField(scope, fieldName, answer);
  }

  if ((await input.first().getAttribute("role")) === "combobox") {
    return (await fillField(scope, fieldName, answer))
      ? verifyLocationCommitted(scope, answer)
      : false;
  }

  const target = input.first();

  try {
    await target.click({ timeout: 5000 });
    await target.fill("", { timeout: 5000 });
    await target.pressSequentially(answer, { delay: 20, timeout: 15_000 });
  } catch {
    return false;
  }

  const suggestions = scope.root.locator(".dropdown-results .dropdown-location");

  await suggestions
    .first()
    .waitFor({ state: "visible", timeout: LOCATION_SUGGESTION_MS })
    .catch(() => undefined);

  const labels = await suggestions.allTextContents();
  const index = locationSuggestionIndex(labels, answer);

  if (index < 0) {
    return false;
  }

  await suggestions.nth(index).click();
  await scope.page.waitForTimeout(250);

  return verifyLocationCommitted(scope, answer);
}

const fillFailureOf = (field: SendPlanField) =>
  ({
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    label: field.label,
  }) satisfies FillFailure;

async function fillPlannedFields(scope: FormScope, fields: readonly SendPlanField[]) {
  const fillFrom: (
    index: number,
  ) => Promise<{ ok: true } | { ok: false; failure: FillFailure }> = async (index) => {
    const field = fields[index];

    if (field === undefined) {
      return { ok: true };
    }

    if (field.fieldType === "file" || field.answer === null) {
      return fillFrom(index + 1);
    }

    if (field.fieldName === null || field.fieldName === "") {
      return fillFrom(index + 1);
    }

    const filled =
      normText(field.fieldName) === LOCATION_FIELD
        ? await fillLeverLocation(scope, field)
        : await fillField(scope, field.fieldName, field.answer);

    if (!filled) {
      return { failure: fillFailureOf(field), ok: false };
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

  const scope = await openApplyForm(page, "form#application-form");

  if (scope === null) {
    return {
      confirmationSeen: false,
      outcome: "form_missing",
      submitMayHaveLanded: false,
      submitResponseStatus: null,
    };
  }

  const filled = await fillPlannedFields(scope, plan.fields);

  if (!filled.ok) {
    return {
      confirmationSeen: false,
      fillFailure: filled.failure,
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

    const uploaded = await uploadFile(scope, fieldName, {
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
    await waitForStableForm(scope);
  }

  const location = plan.fields.some(
    (field) => field.answer !== null && normText(field.fieldName) === LOCATION_FIELD,
  )
    ? await committedLocation(scope)
    : null;

  const expectations: LiveFormExpectation[] = plan.fields.map((field) => ({
    answer:
      location !== null && field.answer !== null && normText(field.fieldName) === LOCATION_FIELD
        ? location
        : field.answer,
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

  const submitPath =
    (await submitPathnameOf(page, new URL(plan.identity.url).pathname)) ??
    new URL(plan.identity.url).pathname;

  const submitButton = scope.root
    .locator(
      "#btn-submit, button[data-qa='btn-submit'], button[type='submit'], input[type='submit']",
    )
    .first();

  await hooks.onWillSubmit();

  const settled = await Promise.allSettled([
    submitButton.click({ timeout: APPLICATION_RESPONSE_MS }),
    watchApplicationResponse(page, submitPath),
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
