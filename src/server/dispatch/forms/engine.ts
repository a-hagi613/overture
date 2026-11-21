import type { Locator, Page, Response } from "playwright-core";

import type { QuestionFieldType } from "../../../shared/questions.ts";

import { mapQuestionByRules } from "../../catalog/question-rules.ts";

export const FORM_APPEAR_MS = 15_000;
export const CONFIRMATION_WAIT_MS = 10_000;
export const APPLICATION_RESPONSE_MS = 30_000;

const COMBOBOX_MENU_MS = 5000;
const COMBOBOX_KEY_DELAY_MS = 50;

const FILLABLE_INPUT_TYPES = new Set(["text", "email", "tel", "number", "date", "url"]);

export const CONFIRMATION_SOURCES = [
  String.raw`thanks? for (?:applying|your application|your interest|your submission)`,
  String.raw`thank you for applying`,
  String.raw`application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)`,
  String.raw`we(?:['’]?ve| have) received your application`,
  String.raw`your application (?:is|has been) (?:in|received|submitted)`,
];

const APPLICATION_URL_PATH = "/application";
const CONFIRMATION_URL_PATH = "/confirmation";

const acceptedStatus = (status: number | null) => status !== null && status >= 200 && status < 300;

const cssValue = (raw: string) => raw.replaceAll(/["\\]/gu, String.raw`\$&`);

export const norm = (raw: string) => raw.replaceAll(/\s+/gu, " ").trim().toLowerCase();

const firstSegmentOf = (wanted: string) => (wanted.split(",")[0] ?? "").trim();

const cityOf = (text: string) => (text.split(",")[0] ?? "").trim();

const tokensOf = (text: string) => text.split(/[\s,]+/u).filter((token) => token !== "");

const samePlaceToken = (wanted: string, offered: string) =>
  wanted === offered ||
  (wanted.length >= 2 && offered.startsWith(wanted)) ||
  (offered.length >= 2 && wanted.startsWith(offered));

function matchedIndex(texts: string[], target: string) {
  const exact = texts.indexOf(target);

  if (exact !== -1) {
    return exact;
  }

  for (const [index, text] of texts.entries()) {
    if (text.startsWith(target) || target.startsWith(text) || text.includes(target)) {
      return index;
    }
  }

  return -1;
}

function autocompleteIndex(texts: string[], wanted: string) {
  const target = norm(wanted);
  const exact = texts.indexOf(target);

  if (exact !== -1) {
    return exact;
  }

  const city = cityOf(target);

  if (city === "") {
    return -1;
  }

  const regionTokens = tokensOf(target.slice(city.length));

  const candidates = texts.flatMap((text, index) =>
    cityOf(text) === city ? [{ index, text }] : [],
  );

  const withRegion = candidates.find((entry) =>
    tokensOf(entry.text.slice(cityOf(entry.text).length)).some((token) =>
      regionTokens.some((region) => samePlaceToken(region, token)),
    ),
  );

  return withRegion === undefined ? (candidates[0]?.index ?? -1) : withRegion.index;
}

async function optionTexts(list: Locator) {
  try {
    await list.first().waitFor({ state: "visible", timeout: COMBOBOX_MENU_MS });
  } catch {
    return [];
  }

  return (await list.allInnerTexts()).map((text) => norm(text));
}

async function chooseFromCombobox(page: Page, field: Locator, wanted: string) {
  await field.click();

  const listboxId = await field.getAttribute("aria-controls");

  const list =
    listboxId === null || listboxId === ""
      ? page.getByRole("option")
      : page.locator(`[id="${cssValue(listboxId)}"] [role='option']`);

  const expanded = await field.getAttribute("aria-expanded");

  const opened = expanded === "false" ? [] : await optionTexts(list);

  if (opened.length > 0) {
    const index = matchedIndex(opened, norm(wanted));

    if (index >= 0) {
      await list.nth(index).click();

      return true;
    }
  }

  const query = firstSegmentOf(wanted);

  if (norm(query) === "") {
    if (opened.length > 0) {
      await field.press("Escape");
    }

    return false;
  }

  await field.pressSequentially(query, { delay: COMBOBOX_KEY_DELAY_MS });

  const searched = await optionTexts(list);

  if (searched.length === 0) {
    return false;
  }

  const index = autocompleteIndex(searched, wanted);

  if (index >= 0) {
    await list.nth(index).click();

    return true;
  }

  const typed = norm(query);
  const singleSegment = norm(wanted) === typed;
  const cityOffered = searched.some((text) => cityOf(text) === typed);

  if (singleSegment && !cityOffered) {
    const fallback = matchedIndex(searched, typed);

    if (fallback >= 0) {
      await list.nth(fallback).click();

      return true;
    }
  }

  await field.press("Escape");

  return false;
}

async function selectMatchingOption(field: Locator, wanted: string) {
  const raw = await field.locator("option").evaluateAll((elements) =>
    elements.map((element) => ({
      label: element.textContent,
      value: element.getAttribute("value"),
    })),
  );

  const target = norm(wanted);
  const texts = raw.map((option) => norm(option.label));
  const index = matchedIndex(texts, target);

  const value = index === -1 ? undefined : raw[index]?.value;

  if (value === undefined || value === null) {
    return false;
  }

  await field.selectOption(value);

  return true;
}

export const fieldById = (page: Page, id: string) =>
  page.locator(`[id="${cssValue(id)}"], [name="${cssValue(id)}"]`).first();

export const formLocator = (page: Page) => page.locator("form#application-form").first();

export const submitButton = (page: Page) =>
  page
    .locator(
      "form#application-form button[type='submit'], form#application-form input[type='submit']",
    )
    .first();

export const codeInputs = (page: Page) => page.locator("input[id^='security-input-']");

export interface LiveFormExpectation {
  fieldName: string | null;
  label: string;
  fieldType: QuestionFieldType;
  required: boolean;
  answer: string | null;
  options: readonly string[];
  file: { name: string; size: number } | null;
}

export type LiveFormProblemKind =
  | "answer_missing"
  | "field_missing"
  | "value_mismatch"
  | "option_missing"
  | "option_not_selected"
  | "checkbox_mismatch"
  | "file_mismatch"
  | "unexpected_required";

export interface LiveFormProblem {
  kind: LiveFormProblemKind;
  fieldName: string | null;
  label: string;
  fieldType: QuestionFieldType | null;
  options: string[];
  answer: string | null;
  /** True when the live form asks for something the plan never covered. */
  unexpected: boolean;
}

export type LiveFormCheck = { ok: true; problems: [] } | { ok: false; problems: LiveFormProblem[] };

export type LiveFormVerdict =
  | { outcome: "ok"; reviewFields: []; problems: [] }
  | {
      outcome: "needs_review" | "form_changed";
      reviewFields: LiveFormProblem[];
      problems: LiveFormProblem[];
    };

interface LiveOption {
  label: string;
  value: string;
}

interface LiveControl {
  key: string;
  name: string;
  label: string;
  fieldType: QuestionFieldType | null;
  required: boolean;
  disabled: boolean;
  hidden: boolean;
  options: LiveOption[];
  value: string | null;
  checked: boolean | null;
  file: { name: string; size: number } | null;
}

const normaliseLabel = (raw: string) => norm(raw.replaceAll("*", ""));

const isPositiveAnswer = (answer: string | null) =>
  answer !== null && !["", "0", "false", "no", "unchecked"].includes(norm(answer));

function liveMatchesExpectation(expectation: LiveFormExpectation, control: LiveControl) {
  if (expectation.fieldName !== null && expectation.fieldName !== "") {
    return control.key === expectation.fieldName || control.name === expectation.fieldName;
  }

  const wanted = normaliseLabel(expectation.label);

  if (wanted === "") {
    return false;
  }

  const live = normaliseLabel(control.label);

  return live === wanted || live.includes(wanted) || wanted.includes(live);
}

function liveOptionPresent(control: LiveControl, answer: string) {
  const wanted = norm(answer);

  return control.options.some(
    (option) => norm(option.label) === wanted || norm(option.value) === wanted,
  );
}

function optionField(fieldType: QuestionFieldType | null) {
  return (
    fieldType === "select" ||
    fieldType === "multiselect" ||
    fieldType === "radio" ||
    fieldType === "checkbox"
  );
}

async function readLiveForm(page: Page) {
  return page.evaluate(() => {
    const form = document.querySelector("form#application-form");

    if (form === null) {
      return null;
    }

    const dom = {
      byId: (id: string) => document.querySelector(`[id="${id}"]`),
      disabledOf: (element: Element) =>
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
      fieldTypeOf: (element: Element) => {
        if (element instanceof HTMLTextAreaElement) {
          return "textarea";
        }

        if (element instanceof HTMLSelectElement) {
          return "select";
        }

        if (!(element instanceof HTMLInputElement)) {
          return null;
        }

        if (element.getAttribute("role") === "combobox") {
          return "select";
        }

        switch (element.type) {
          case "checkbox": {
            return "checkbox";
          }

          case "radio": {
            return "radio";
          }

          case "file": {
            return "file";
          }

          case "email": {
            return "email";
          }

          case "tel": {
            return "phone";
          }

          case "url": {
            return "url";
          }

          case "date": {
            return "date";
          }

          case "number": {
            return "number";
          }

          default: {
            return "text";
          }
        }
      },
      fileOf: (element: HTMLInputElement) => {
        const file = element.files?.[0];

        return file === undefined ? null : { name: file.name, size: file.size };
      },
      hiddenOf: (element: Element) => {
        if (element.closest("[hidden]") !== null) {
          return true;
        }

        const style = globalThis.getComputedStyle(element);

        return (
          style.display === "none" ||
          style.visibility === "hidden" ||
          element.getAttribute("aria-hidden") === "true"
        );
      },
      keyOf: (element: Element) => {
        const id = element.getAttribute("id");

        if (id !== null && id !== "") {
          return id;
        }

        return element.getAttribute("name") ?? "";
      },
      labelFor: (element: Element) => {
        const group = element.closest("[role='group'][aria-labelledby]");
        const labelledBy = group?.getAttribute("aria-labelledby");

        if (labelledBy !== null && labelledBy !== undefined) {
          const text = labelledBy
            .split(/\s+/u)
            .map((id) => dom.textOf(dom.byId(id)))
            .filter((part) => part !== "")
            .join(" ");

          if (text !== "") {
            return text;
          }
        }

        const ariaLabel = element.getAttribute("aria-label");

        if (ariaLabel !== null && ariaLabel.trim() !== "") {
          return ariaLabel;
        }

        const ids = element.getAttribute("aria-labelledby");

        if (ids !== null) {
          const text = ids
            .split(/\s+/u)
            .map((id) => dom.textOf(dom.byId(id)))
            .filter((part) => part !== "")
            .join(" ");

          if (text !== "") {
            return text;
          }
        }

        const id = element.getAttribute("id");

        if (id !== null && id !== "") {
          for (const label of form.querySelectorAll("label[for]")) {
            if (label.getAttribute("for") === id) {
              return dom.textOf(label);
            }
          }
        }

        const wrapping = element.closest("label");

        return wrapping === null ? (element.getAttribute("name") ?? "") : dom.textOf(wrapping);
      },
      nameOf: (element: Element) => element.getAttribute("name") ?? dom.keyOf(element),
      optionLabel: (element: HTMLInputElement) => {
        const wrapping = element.closest("label");

        if (wrapping !== null) {
          return dom.textOf(wrapping);
        }

        const id = element.getAttribute("id");

        if (id !== null && id !== "") {
          for (const label of form.querySelectorAll("label[for]")) {
            if (label.getAttribute("for") === id) {
              return dom.textOf(label);
            }
          }
        }

        return element.getAttribute("aria-label") ?? element.getAttribute("value") ?? "";
      },
      requiredOf: (element: Element) => {
        if (element.getAttribute("aria-required") === "true" || element.hasAttribute("required")) {
          return true;
        }

        const group = element.closest("[role='group'][aria-required]");

        return group?.getAttribute("aria-required") === "true";
      },
      textOf: (node: Node | null) => (node?.textContent ?? "").replaceAll(/\s+/gu, " ").trim(),
    };

    const controls: LiveControl[] = [];
    const seenRadios = new Set<string>();

    for (const element of form.querySelectorAll("input, select, textarea")) {
      if (element instanceof HTMLInputElement && element.type === "hidden") {
        continue;
      }

      const fieldType = dom.fieldTypeOf(element);

      if (fieldType === null) {
        continue;
      }

      if (fieldType === "radio" && element instanceof HTMLInputElement) {
        if (seenRadios.has(element.name)) {
          continue;
        }

        seenRadios.add(element.name);

        const group = [...form.querySelectorAll("input[type='radio']")].filter(
          (candidate): candidate is HTMLInputElement =>
            candidate instanceof HTMLInputElement && candidate.name === element.name,
        );

        const checked = group.find((candidate) => candidate.checked) ?? null;

        controls.push({
          checked: checked !== null,
          disabled: group.every((candidate) => dom.disabledOf(candidate)),
          fieldType,
          file: null,
          hidden: group.every((candidate) => dom.hiddenOf(candidate)),
          key: element.name,
          label: dom.labelFor(element),
          name: element.name,
          options: group.map((candidate) => ({
            label: dom.optionLabel(candidate),
            value: candidate.value,
          })),
          required: group.some((candidate) => dom.requiredOf(candidate)),
          value: checked === null ? null : dom.optionLabel(checked),
        });

        continue;
      }

      if (element instanceof HTMLSelectElement) {
        const selected = [...element.selectedOptions];

        controls.push({
          checked: null,
          disabled: dom.disabledOf(element),
          fieldType,
          file: null,
          hidden: dom.hiddenOf(element),
          key: dom.keyOf(element),
          label: dom.labelFor(element),
          name: dom.nameOf(element),
          options: [...element.options].map((option) => ({
            label: dom.textOf(option),
            value: option.value,
          })),
          required: dom.requiredOf(element),
          value: selected.map((option) => dom.textOf(option)).join(", "),
        });

        continue;
      }

      if (element instanceof HTMLInputElement) {
        if (fieldType === "checkbox") {
          controls.push({
            checked: element.checked,
            disabled: dom.disabledOf(element),
            fieldType,
            file: null,
            hidden: dom.hiddenOf(element),
            key: dom.keyOf(element),
            label: dom.labelFor(element),
            name: dom.nameOf(element),
            options: [],
            required: dom.requiredOf(element),
            value: element.checked ? "true" : "false",
          });

          continue;
        }

        if (fieldType === "file") {
          controls.push({
            checked: null,
            disabled: dom.disabledOf(element),
            fieldType,
            file: dom.fileOf(element),
            hidden: dom.hiddenOf(element),
            key: dom.keyOf(element),
            label: dom.labelFor(element),
            name: dom.nameOf(element),
            options: [],
            required: dom.requiredOf(element),
            value: null,
          });

          continue;
        }

        if (element.getAttribute("role") === "combobox") {
          const listboxId = element.getAttribute("aria-controls") ?? "";
          const listbox = listboxId === "" ? null : dom.byId(listboxId);

          const options =
            listbox === null
              ? []
              : [...listbox.querySelectorAll("[role='option']")].map((option) => ({
                  label: dom.textOf(option),
                  value:
                    (option instanceof HTMLElement ? option.dataset.value : null) ??
                    option.getAttribute("value") ??
                    dom.textOf(option),
                }));

          const container = element.closest(".select__container");
          const shown = dom.textOf(container?.querySelector(".select__single-value") ?? null);

          let selected = shown;

          if (selected === "") {
            const hidden = [...form.querySelectorAll("input[type='hidden']")].find(
              (candidate) => candidate.getAttribute("name") === element.id,
            );

            const raw = hidden instanceof HTMLInputElement ? hidden.value : "";

            const matched = options.find(
              (option) => option.value === raw || option.label.toLowerCase() === raw.toLowerCase(),
            );

            selected = matched?.label ?? raw;
          }

          controls.push({
            checked: null,
            disabled: dom.disabledOf(element),
            fieldType,
            file: null,
            hidden: dom.hiddenOf(element),
            key: dom.keyOf(element),
            label: dom.labelFor(element),
            name: dom.nameOf(element),
            options,
            required: dom.requiredOf(element),
            value: selected,
          });

          continue;
        }

        controls.push({
          checked: null,
          disabled: dom.disabledOf(element),
          fieldType,
          file: null,
          hidden: dom.hiddenOf(element),
          key: dom.keyOf(element),
          label: dom.labelFor(element),
          name: dom.nameOf(element),
          options: [],
          required: dom.requiredOf(element),
          value: element.value,
        });

        continue;
      }

      if (element instanceof HTMLTextAreaElement) {
        controls.push({
          checked: null,
          disabled: dom.disabledOf(element),
          fieldType,
          file: null,
          hidden: dom.hiddenOf(element),
          key: dom.keyOf(element),
          label: dom.labelFor(element),
          name: dom.nameOf(element),
          options: [],
          required: dom.requiredOf(element),
          value: element.value,
        });
      }
    }

    return { controls };
  });
}

const checkLiveForm: (
  page: Page,
  expectations: readonly LiveFormExpectation[],
) => Promise<LiveFormCheck> = async (page, expectations) => {
  const live = await readLiveForm(page);

  if (live === null) {
    return {
      ok: false,
      problems: [
        {
          answer: null,
          fieldName: null,
          fieldType: null,
          kind: "field_missing",
          label: "application form",
          options: [],
          unexpected: false,
        },
      ],
    };
  }

  const problems = new Map<string, LiveFormProblem>();

  const add = (problem: LiveFormProblem) => {
    problems.set(`${problem.kind}\u0000${problem.fieldName ?? ""}\u0000${problem.label}`, problem);
  };

  for (const expectation of expectations) {
    const control = live.controls.find((candidate) =>
      liveMatchesExpectation(expectation, candidate),
    );

    if (control === undefined) {
      add({
        answer: expectation.answer,
        fieldName: expectation.fieldName,
        fieldType: expectation.fieldType,
        kind: "field_missing",
        label: expectation.label,
        options: [...expectation.options],
        unexpected: false,
      });

      continue;
    }

    if (expectation.fieldType === "file") {
      if (
        expectation.file !== null &&
        (control.file === null ||
          control.file.name !== expectation.file.name ||
          control.file.size !== expectation.file.size)
      ) {
        add({
          answer: expectation.file.name,
          fieldName: expectation.fieldName,
          fieldType: expectation.fieldType,
          kind: "file_mismatch",
          label: expectation.label,
          options: [],
          unexpected: false,
        });
      }

      continue;
    }

    if (control.disabled) {
      add({
        answer: expectation.answer,
        fieldName: expectation.fieldName,
        fieldType: expectation.fieldType,
        kind: "value_mismatch",
        label: expectation.label,
        options: [...expectation.options],
        unexpected: false,
      });

      continue;
    }

    const { answer } = expectation;

    if (answer === null || norm(answer) === "") {
      if (expectation.fieldType === "checkbox" && control.checked !== false) {
        add({
          answer,
          fieldName: expectation.fieldName,
          fieldType: expectation.fieldType,
          kind: "checkbox_mismatch",
          label: expectation.label,
          options: [...expectation.options],
          unexpected: false,
        });
      }

      continue;
    }

    if (optionField(expectation.fieldType) && expectation.fieldType !== "checkbox") {
      if (expectation.options.length > 0 && !liveOptionPresent(control, answer)) {
        add({
          answer,
          fieldName: expectation.fieldName,
          fieldType: expectation.fieldType,
          kind: "option_missing",
          label: expectation.label,
          options: control.options.map((option) => option.label),
          unexpected: false,
        });

        continue;
      }

      if (norm(control.value ?? "") !== norm(answer)) {
        add({
          answer,
          fieldName: expectation.fieldName,
          fieldType: expectation.fieldType,
          kind: "option_not_selected",
          label: expectation.label,
          options: control.options.map((option) => option.label),
          unexpected: false,
        });
      }

      continue;
    }

    if (expectation.fieldType === "checkbox") {
      if (control.checked !== isPositiveAnswer(answer)) {
        add({
          answer,
          fieldName: expectation.fieldName,
          fieldType: expectation.fieldType,
          kind: "checkbox_mismatch",
          label: expectation.label,
          options: [...expectation.options],
          unexpected: false,
        });
      }

      continue;
    }

    if (norm(control.value ?? "") !== norm(answer)) {
      add({
        answer,
        fieldName: expectation.fieldName,
        fieldType: expectation.fieldType,
        kind: "value_mismatch",
        label: expectation.label,
        options: [...expectation.options],
        unexpected: false,
      });
    }
  }

  for (const control of live.controls) {
    if (!control.required || control.disabled || control.hidden) {
      continue;
    }

    const expectation = expectations.find((candidate) =>
      liveMatchesExpectation(candidate, control),
    );

    const covered =
      expectation !== undefined &&
      (expectation.fieldType === "file"
        ? expectation.file !== null
        : expectation.answer !== null && norm(expectation.answer) !== "");

    if (covered) {
      continue;
    }

    add({
      answer: expectation?.answer ?? null,
      fieldName: control.key === "" ? null : control.key,
      fieldType: control.fieldType,
      kind: "unexpected_required",
      label: control.label.replaceAll("*", "").trim(),
      options: control.options.map((option) => option.label),
      unexpected: true,
    });
  }

  const sorted = [...problems.values()];

  return sorted.length === 0 ? { ok: true, problems: [] } : { ok: false, problems: sorted };
};

const DURABLE_KINDS = new Set(["derived", "fact", "target"]);

function unexpectedFieldNeedsReview(problem: LiveFormProblem) {
  if (problem.fieldType === "file") {
    return false;
  }

  const mapping = problem.label === "" ? null : mapQuestionByRules(problem.label);

  if (mapping === null) {
    return problem.fieldType !== "textarea";
  }

  return DURABLE_KINDS.has(mapping.answerKind);
}

const decideLiveFormVerdict: (check: LiveFormCheck) => LiveFormVerdict = (check) => {
  if (check.ok) {
    return { outcome: "ok", problems: [], reviewFields: [] };
  }

  const reviewFields = check.problems.filter(
    (problem) => problem.kind === "unexpected_required" && unexpectedFieldNeedsReview(problem),
  );

  return {
    outcome: reviewFields.length > 0 ? "needs_review" : "form_changed",
    problems: check.problems,
    reviewFields,
  };
};

/**
 * The shared preflight every ATS flow calls after filling and uploading and
 * before Submit. A form that no longer matches the plan never submits: a
 * missing durable Fact becomes a Review, and anything else is a form change.
 *
 * @param page The live application form.
 * @param expectations Every planned answer, option, file and consent.
 * @returns The preflight outcome for this attempt.
 */
export const preflightForm: (
  page: Page,
  expectations: readonly LiveFormExpectation[],
) => Promise<LiveFormVerdict> = async (page, expectations) => {
  const check = await checkLiveForm(page, expectations);

  return decideLiveFormVerdict(check);
};

export async function fillField(page: Page, id: string, value: string) {
  const field = fieldById(page, id);

  if ((await field.count()) === 0) {
    return false;
  }

  if ((await field.getAttribute("role")) === "combobox") {
    return chooseFromCombobox(page, field, value);
  }

  const widget = await field.evaluate((element) => ({
    tag: element.tagName.toLowerCase(),
    type: element instanceof HTMLInputElement ? element.type : "",
  }));

  if (widget.tag === "textarea") {
    await field.fill(value);

    return true;
  }

  if (widget.tag === "select") {
    return selectMatchingOption(field, value);
  }

  if (widget.type === "checkbox") {
    const positive = norm(value) !== "" && norm(value) !== "false" && norm(value) !== "no";

    await field.setChecked(positive);

    return true;
  }

  if (widget.type === "radio") {
    const options = page.locator(`input[name="${cssValue(id)}"]`);

    const labels = await options.evaluateAll((elements) =>
      elements.map((element) =>
        (element.closest("label")?.textContent ?? element.getAttribute("value") ?? "").trim(),
      ),
    );

    const index = matchedIndex(
      labels.map((label) => norm(label)),
      norm(value),
    );

    if (index < 0) {
      return false;
    }

    await options.nth(index).check();

    return true;
  }

  if (widget.tag === "input" && FILLABLE_INPUT_TYPES.has(widget.type)) {
    await field.fill(value);

    return true;
  }

  return false;
}

export async function uploadFile(
  page: Page,
  fieldId: string,
  file: { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> },
) {
  const input = fieldById(page, fieldId);

  if ((await input.count()) === 0) {
    return false;
  }

  try {
    await input.setInputFiles({
      buffer: Buffer.from(file.bytes),
      mimeType: file.mimeType,
      name: file.name,
    });
  } catch {
    return false;
  }

  return true;
}

export async function typeCode(page: Page, code: string) {
  const inputs = codeInputs(page);
  const count = await inputs.count();
  const chars = code.trim().split("");

  const fillRest = async (index: number) => {
    const char = chars[index];

    if (char === undefined || index >= count) {
      return;
    }

    await inputs.nth(index).fill(char);
    await fillRest(index + 1);
  };

  await fillRest(0);
}

const isApplicationPath = (actual: string, submitPathname: string | null) =>
  submitPathname === null ? actual.endsWith(APPLICATION_URL_PATH) : actual === submitPathname;

export const isApplicationResponse = (submitPathname: string | null) => (candidate: Response) =>
  candidate.request().method() === "POST" &&
  isApplicationPath(new URL(candidate.url()).pathname, submitPathname);

export async function submitPathnameOf(page: Page, fallbackPathname: string | null) {
  const declared = /"?submitPath"?\s*:\s*"(?<path>[^"]+)"/u.exec(await page.content())?.groups
    ?.path;

  return declared === undefined ? fallbackPathname : new URL(declared, page.url()).pathname;
}

export async function watchApplicationResponse(page: Page, submitPathname: string | null = null) {
  return page.waitForResponse(isApplicationResponse(submitPathname), {
    timeout: APPLICATION_RESPONSE_MS,
  });
}

export async function readConfirmation(
  page: Page,
  confirmationPath: string = CONFIRMATION_URL_PATH,
) {
  try {
    await page.waitForFunction(
      ({ sources, path }) =>
        globalThis.location.pathname.endsWith(path) ||
        (document.querySelector("form#application-form") === null &&
          sources.some((source) => new RegExp(source, "iu").test(document.body.textContent))),
      { path: confirmationPath, sources: CONFIRMATION_SOURCES },
      { timeout: CONFIRMATION_WAIT_MS },
    );
  } catch {
    return false;
  }

  return true;
}

export async function codeStepVisible(page: Page) {
  try {
    await codeInputs(page).first().waitFor({ state: "visible", timeout: COMBOBOX_MENU_MS });
  } catch {
    return false;
  }

  return true;
}

export const responseAccepted = acceptedStatus;
