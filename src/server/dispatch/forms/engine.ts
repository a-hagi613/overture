import type { Locator, Page, Response } from "playwright-core";

import type { QuestionFieldType } from "../../../shared/questions.ts";

import { mapQuestionByRules } from "../../catalog/question-rules.ts";

export const FORM_APPEAR_MS = 15_000;
export const CONFIRMATION_WAIT_MS = 10_000;
export const APPLICATION_RESPONSE_MS = 30_000;

const COMBOBOX_MENU_MS = 5000;
const COMBOBOX_REVEAL_MS = 1000;
const COMBOBOX_KEY_DELAY_MS = 50;

const DOM_STABILITY_TIMEOUT_MS = 3000;
const DOM_STABILITY_QUIET_MS = 150;

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

interface ComboboxOption {
  label: string;
  value: string;
}

async function comboboxList(page: Page, field: Locator) {
  const listboxId = await field.getAttribute("aria-controls");

  if (listboxId !== null && listboxId !== "") {
    return page.locator(`[id="${cssValue(listboxId)}"] [role='option']`);
  }

  const visible = page.locator("[role='listbox']:visible").first();

  if ((await visible.count()) > 0) {
    return visible.locator("[role='option']");
  }

  return page.locator("[role='option']:visible");
}

async function renderedOptionCount(page: Page, field: Locator) {
  const listboxId = await field.getAttribute("aria-controls");

  if (listboxId === null || listboxId === "") {
    return 0;
  }

  return page.locator(`[id="${cssValue(listboxId)}"] [role='option']`).count();
}

async function optionEntries(list: Locator) {
  try {
    await list.first().waitFor({ state: "visible", timeout: COMBOBOX_MENU_MS });
  } catch {
    return [];
  }

  return list.evaluateAll((elements) =>
    elements.map((element) => {
      const raw = element instanceof HTMLElement ? (element.dataset.value ?? "") : "";

      return {
        label: element.textContent.replaceAll(/\s+/gu, " ").trim(),
        value: raw === "" ? element.getAttribute("value") || "" : raw,
      };
    }),
  );
}

async function chosenComboboxValue(field: Locator) {
  return field.evaluate((element) => {
    const container = element.closest(".select__container");

    if (container === null) {
      return element instanceof HTMLInputElement ? element.value : "";
    }

    const shown = container.querySelector(".select__single-value")?.textContent ?? "";

    if (shown.trim() !== "") {
      return shown.replaceAll(/\s+/gu, " ").trim();
    }

    const id = element.getAttribute("id") ?? "";

    const fieldset = element.closest("form") ?? element.ownerDocument;

    const hidden = [...fieldset.querySelectorAll("input[type='hidden']")].find(
      (candidate) => id !== "" && candidate.getAttribute("name") === id,
    );

    return hidden instanceof HTMLInputElement ? hidden.value : "";
  });
}

async function verifyComboboxChoice(field: Locator, option: ComboboxOption | undefined) {
  await field.press("Escape");

  if (option === undefined) {
    return false;
  }

  const chosen = await chosenComboboxValue(field);
  const target = norm(option.label);

  const shown =
    norm(chosen) !== "" &&
    (norm(chosen) === target || target.startsWith(norm(chosen)) || norm(chosen).includes(target));

  return shown || (option.value !== "" && chosen === option.value);
}

async function chooseFromCombobox(page: Page, field: Locator, wanted: string) {
  await field.click();

  const list = await comboboxList(page, field);

  const expanded = await field.getAttribute("aria-expanded");

  const opened = expanded === "false" ? [] : await optionEntries(list);

  if (opened.length > 0) {
    const index = matchedIndex(
      opened.map((entry) => norm(entry.label)),
      norm(wanted),
    );

    if (index >= 0) {
      await list.nth(index).click();

      return verifyComboboxChoice(field, opened[index]);
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

  const searched = await optionEntries(list);

  if (searched.length === 0) {
    return false;
  }

  const index = autocompleteIndex(
    searched.map((entry) => norm(entry.label)),
    wanted,
  );

  if (index >= 0) {
    await list.nth(index).click();

    return verifyComboboxChoice(field, searched[index]);
  }

  const typed = norm(query);
  const singleSegment = norm(wanted) === typed;
  const cityOffered = searched.some((entry) => cityOf(norm(entry.label)) === typed);

  if (singleSegment && !cityOffered) {
    const fallback = matchedIndex(
      searched.map((entry) => norm(entry.label)),
      typed,
    );

    if (fallback >= 0) {
      await list.nth(fallback).click();

      return verifyComboboxChoice(field, searched[fallback]);
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

async function checkboxGroup(root: Locator, id: string) {
  const fieldset = root
    .locator(`fieldset[id="${cssValue(id)}"], [role='group'][id="${cssValue(id)}"]`)
    .first();

  if ((await fieldset.count()) > 0) {
    const boxes = fieldset.locator("input[type='checkbox']");

    if ((await boxes.count()) > 0) {
      return boxes;
    }
  }

  const boxes = root.locator(
    `input[type='checkbox'][name="${cssValue(id)}"], input[type='checkbox'][id="${cssValue(id)}"]`,
  );

  return (await boxes.count()) > 1 ? boxes : null;
}

async function fillCheckboxGroup(boxes: Locator, wanted: string) {
  const labels = await boxes.evaluateAll((elements) =>
    elements.map((element) => {
      const wrapping = element.closest("label");

      if (wrapping !== null) {
        return wrapping.textContent.replaceAll(/\s+/gu, " ").trim();
      }

      const id = element.getAttribute("id") ?? "";

      if (id !== "") {
        const label = [...document.querySelectorAll("label[for]")].find(
          (candidate) => candidate.getAttribute("for") === id,
        );

        if (label !== undefined) {
          return label.textContent.replaceAll(/\s+/gu, " ").trim();
        }
      }

      return element.getAttribute("aria-label") ?? element.getAttribute("value") ?? "";
    }),
  );

  const wantedParts = wanted
    .split(", ")
    .map((part) => norm(part))
    .filter((part) => part !== "");

  const matched = wantedParts.map((part) =>
    matchedIndex(
      labels.map((label) => norm(label)),
      part,
    ),
  );

  const chosen = new Set(matched.filter((index) => index >= 0));

  const setFrom = async (index: number) => {
    if (index >= labels.length) {
      return;
    }

    await boxes.nth(index).setChecked(chosen.has(index));
    await setFrom(index + 1);
  };

  await setFrom(0);

  return wantedParts.length > 0 && matched.every((index) => index >= 0);
}

export interface FormScope {
  page: Page;
  root: Locator;
}

const isFormScope = (target: Page | FormScope): target is FormScope => "root" in target;

/**
 * Resolves exactly one visible live form root. A page with no matching form, or with more than one
 * match, gets `null`: every fill, preflight read and submit click then fails closed instead of
 * touching a field or form the plan never approved.
 *
 * @param page The page that holds the form.
 * @param selector The one application form selector the ATS owns.
 * @param timeout How long to wait for the first form to become visible.
 * @returns The verified root, or `null` when it is missing or ambiguous.
 */
export async function openForm(page: Page, selector: string, timeout = FORM_APPEAR_MS) {
  const matches = page.locator(selector);

  try {
    await matches.first().waitFor({ state: "visible", timeout });
  } catch {
    return null;
  }

  if ((await matches.count()) !== 1) {
    return null;
  }

  return { page, root: matches.first() };
}

interface StabilityState {
  last: number;
  observer: MutationObserver | null;
}

/**
 * Waits, for a bounded time, until the verified form's DOM stops changing.
 * An upload can trigger an ATS's own resume parser, a combobox can reveal a new
 * control, and a React rerender can replace the whole subtree; the preflight
 * must read the form after those settle, never mid-update. Nothing leaves the
 * page: a MutationObserver in the page records the last change, and the wait
 * ends after a short quiet window or at the timeout, whichever comes first.
 *
 * @param scope The one verified live form.
 * @param timeout The upper bound, in milliseconds.
 * @returns `true` when the form went quiet, `false` when the timeout won.
 */
export async function waitForStableForm(scope: FormScope, timeout = DOM_STABILITY_TIMEOUT_MS) {
  try {
    const root = await scope.root.elementHandle();

    const state = await scope.page.evaluateHandle((element) => {
      const monitor: StabilityState = { last: performance.now(), observer: null };

      monitor.observer = new MutationObserver(() => {
        monitor.last = performance.now();
      });

      monitor.observer.observe(element, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });

      return monitor;
    }, root);

    try {
      await scope.page.waitForFunction(
        ({ monitor, quietMs }: { monitor: { last: number }; quietMs: number }) =>
          performance.now() - monitor.last >= quietMs,
        { monitor: state, quietMs: DOM_STABILITY_QUIET_MS },
        { polling: 25, timeout },
      );

      return true;
    } finally {
      await state
        .evaluate((monitor: StabilityState) => monitor.observer?.disconnect())
        .catch(() => undefined);
      await state.dispose().catch(() => undefined);
      await root.dispose().catch(() => undefined);
    }
  } catch {
    return false;
  }
}

export const fieldById = (scope: FormScope, id: string) =>
  scope.root.locator(`[id="${cssValue(id)}"], [name="${cssValue(id)}"]`).first();

export const submitButton = (
  scope: FormScope,
  selector = "button[type='submit'], input[type='submit']",
) => scope.root.locator(selector).first();

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

export const isPositiveAnswer = (answer: string | null) =>
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

const multiValueParts = (answer: string) =>
  answer
    .split(", ")
    .map((part) => norm(part))
    .filter((part) => part !== "");

function liveOptionsPresent(control: LiveControl, answer: string) {
  return multiValueParts(answer).every((wanted) =>
    control.options.some(
      (option) => norm(option.label) === wanted || norm(option.value) === wanted,
    ),
  );
}

function sameSelectedOptions(control: LiveControl, answer: string) {
  const selected = multiValueParts(control.value ?? "");
  const wanted = multiValueParts(answer);

  return selected.length === wanted.length && wanted.every((part) => selected.includes(part));
}

async function menuOpened(page: Page, field: Locator) {
  try {
    await Promise.any([
      field.and(page.locator("[aria-expanded='true']")).waitFor({ timeout: COMBOBOX_REVEAL_MS }),
      page
        .locator("[role='listbox']:visible")
        .first()
        .waitFor({ state: "visible", timeout: COMBOBOX_REVEAL_MS }),
    ]);

    return true;
  } catch {
    return false;
  }
}

async function openClosedComboboxes(scope: FormScope) {
  const fields = scope.root.locator("input[role='combobox']");
  const count = await fields.count();
  const options = new Map<string, ComboboxOption[]>();

  const openFrom = async (index: number) => {
    if (index >= count) {
      return;
    }

    const field = fields.nth(index);
    const key = (await field.getAttribute("id")) ?? (await field.getAttribute("name")) ?? "";

    if (key !== "" && (await renderedOptionCount(scope.page, field)) === 0) {
      let opened: ComboboxOption[] = [];

      try {
        if ((await field.isVisible()) && (await field.isEnabled())) {
          await field.click({ timeout: COMBOBOX_MENU_MS });

          if (await menuOpened(scope.page, field)) {
            opened = await optionEntries(await comboboxList(scope.page, field));
          }
        }
      } catch {
        opened = [];
      }

      await field.press("Escape").catch(() => undefined);

      if (opened.length > 0) {
        options.set(key, opened);
      }
    }

    await openFrom(index + 1);
  };

  await openFrom(0);

  return options;
}

function optionField(fieldType: QuestionFieldType | null) {
  return (
    fieldType === "select" ||
    fieldType === "multiselect" ||
    fieldType === "radio" ||
    fieldType === "checkbox"
  );
}

async function readLiveForm(scope: FormScope) {
  return scope.root.evaluate((root) => {
    const dom = {
      byId: (id: string) => root.querySelector(`[id="${CSS.escape(id)}"]`),
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

        if (file !== undefined) {
          return { name: file.name, size: file.size };
        }

        const group = element.closest("[role='group']");
        const pill = group?.querySelector("[role='listitem'] span");
        const name = (pill?.textContent ?? "").replaceAll(/\s+/gu, " ").trim();

        return name === "" ? null : { name, size: -1 };
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

        const name = element.getAttribute("name");

        if (name !== null && name !== "") {
          return name;
        }

        const entry = element.closest("[class*='fieldEntry']");

        return entry?.querySelector("label[for]")?.getAttribute("for") ?? "";
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
          for (const label of root.querySelectorAll("label[for]")) {
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
          for (const label of root.querySelectorAll("label[for]")) {
            if (label.getAttribute("for") === id) {
              return dom.textOf(label);
            }
          }
        }

        return element.getAttribute("aria-label") ?? element.getAttribute("value") ?? "";
      },
      starredMarker: (node: Element | null) =>
        [...(node?.querySelectorAll("[aria-hidden='true']") ?? [])].some(
          (marker) => marker.textContent.trim() === "*",
        ),
      requiredOf: (element: Element) => {
        if (element.getAttribute("aria-required") === "true" || element.hasAttribute("required")) {
          return true;
        }

        const group = element.closest("[role='group'][aria-required]");

        if (group?.getAttribute("aria-required") === "true") {
          return true;
        }

        const id = element.getAttribute("id");
        const own = id === null ? null : root.querySelector(`label[for="${CSS.escape(id)}"]`);

        if (dom.starredMarker(own)) {
          return true;
        }

        const labelled = element.closest("[role='group'][aria-labelledby]");
        const ids = labelled?.getAttribute("aria-labelledby") ?? "";

        return ids
          .split(/\s+/u)
          .filter((value) => value !== "")
          .some((value) => dom.starredMarker(dom.byId(value)));
      },
      textOf: (node: Node | null) => (node?.textContent ?? "").replaceAll(/\s+/gu, " ").trim(),
    };

    const controls: LiveControl[] = [];
    const seenRadios = new Set<string>();
    const seenCheckboxGroups = new Set<string>();

    for (const element of root.querySelectorAll("input, select, textarea")) {
      if (element instanceof HTMLInputElement && element.type === "hidden") {
        continue;
      }

      const fieldType = dom.fieldTypeOf(element);

      if (fieldType === null) {
        continue;
      }

      const yesNoGroup = element.closest("[class*='yesno']");

      const pressedButtons = [
        ...(yesNoGroup === null
          ? (element.parentElement?.querySelectorAll<HTMLButtonElement>("button[aria-pressed]") ??
            [])
          : yesNoGroup.querySelectorAll<HTMLButtonElement>("button")),
      ];

      if (pressedButtons.length > 0) {
        const titleId = element.getAttribute("name") ?? element.getAttribute("id") ?? "";

        const title =
          titleId === "" ? null : root.querySelector(`label[for="${CSS.escape(titleId)}"]`);

        const pressed =
          pressedButtons.find((button) => button.getAttribute("aria-pressed") === "true") ??
          (yesNoGroup !== null && element instanceof HTMLInputElement && element.checked
            ? (pressedButtons.find(
                (button) => dom.textOf(button) === element.value.replaceAll(/\s+/gu, " ").trim(),
              ) ?? null)
            : null);

        controls.push({
          checked: pressed !== null,
          disabled: pressedButtons.every((button) => dom.disabledOf(button)),
          fieldType: "radio",
          file: null,
          hidden: pressedButtons.every((button) => dom.hiddenOf(button)),
          key: dom.nameOf(element),
          label: title === null ? dom.labelFor(element) : dom.textOf(title),
          name: dom.nameOf(element),
          options: pressedButtons.map((button) => ({
            label: dom.textOf(button),
            value: dom.textOf(button),
          })),
          required:
            dom.requiredOf(element) ||
            (title instanceof HTMLElement && /(?:^|\s)_required_/u.test(title.className)),
          value: pressed === null ? null : dom.textOf(pressed),
        });

        continue;
      }

      if (fieldType === "radio" && element instanceof HTMLInputElement) {
        if (seenRadios.has(element.name)) {
          continue;
        }

        seenRadios.add(element.name);

        const group = [...root.querySelectorAll("input[type='radio']")].filter(
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

        const blank = selected.every((option) => option.value === "");

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
          value: blank ? "" : selected.map((option) => dom.textOf(option)).join(", "),
        });

        continue;
      }

      if (element instanceof HTMLInputElement) {
        if (fieldType === "checkbox") {
          if (element.name !== "") {
            if (seenCheckboxGroups.has(element.name)) {
              continue;
            }

            seenCheckboxGroups.add(element.name);

            const group = [...root.querySelectorAll("input[type='checkbox']")].filter(
              (candidate): candidate is HTMLInputElement =>
                candidate instanceof HTMLInputElement && candidate.name === element.name,
            );

            const legend = element.closest("fieldset")?.querySelector("legend") ?? null;

            const checkedLabels = group.flatMap((candidate) =>
              candidate.checked ? [dom.optionLabel(candidate)] : [],
            );

            controls.push({
              checked: group.some((candidate) => candidate.checked),
              disabled: group.every((candidate) => dom.disabledOf(candidate)),
              fieldType,
              file: null,
              hidden: group.every((candidate) => dom.hiddenOf(candidate)),
              key: dom.keyOf(element),
              label: legend === null ? dom.labelFor(element) : dom.textOf(legend),
              name: element.name,
              options: group.map((candidate) => ({
                label: dom.optionLabel(candidate),
                value: candidate.value,
              })),
              required: group.some((candidate) => dom.requiredOf(candidate)),
              value: checkedLabels.join(", "),
            });

            continue;
          }

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
            const hidden = [...root.querySelectorAll("input[type='hidden']")].find(
              (candidate) => candidate.getAttribute("name") === element.id,
            );

            const raw = hidden instanceof HTMLInputElement ? hidden.value : "";

            const matched = options.find(
              (option) => option.value === raw || option.label.toLowerCase() === raw.toLowerCase(),
            );

            selected = matched?.label ?? raw;
          }

          if (selected === "" && container === null && element.value.trim() !== "") {
            selected = element.value;
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

const missingFormProblem = () =>
  ({
    answer: null,
    fieldName: null,
    fieldType: null,
    kind: "field_missing",
    label: "application form",
    options: [],
    unexpected: false,
  }) satisfies LiveFormProblem;

const BLANK_TEXT_FIELD_TYPES = new Set<QuestionFieldType>([
  "date",
  "email",
  "number",
  "phone",
  "text",
  "textarea",
  "url",
]);

const isBlankValueField = (fieldType: QuestionFieldType) =>
  fieldType === "select" || BLANK_TEXT_FIELD_TYPES.has(fieldType);

const checkLiveForm: (
  scope: FormScope,
  expectations: readonly LiveFormExpectation[],
) => Promise<LiveFormCheck> = async (scope, expectations) => {
  const live = await readLiveForm(scope);

  const discovered = await openClosedComboboxes(scope);

  for (const control of live.controls) {
    if (control.fieldType !== "select" || control.options.length > 0) {
      continue;
    }

    const options = discovered.get(control.key) ?? discovered.get(control.name);

    if (options !== undefined) {
      control.options = options;
    }
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
          (control.file.size !== -1 && control.file.size !== expectation.file.size))
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
      } else if (isBlankValueField(expectation.fieldType) && norm(control.value ?? "") !== "") {
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

      continue;
    }

    if (optionField(expectation.fieldType) && expectation.fieldType !== "checkbox") {
      const multi = expectation.fieldType === "multiselect";
      const present = multi ? liveOptionsPresent : liveOptionPresent;

      const selected = multi
        ? sameSelectedOptions(control, answer)
        : norm(control.value ?? "") === norm(answer);

      if (expectation.options.length > 0 && !present(control, answer)) {
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

      if (!selected) {
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
 * The reads happen against one verified live form root only. A page with a
 * second form, or a hidden duplicate control, never contributes an answer to
 * the plan that was approved.
 *
 * @param target The verified form scope, or the page to resolve one from.
 * @param expectations Every planned answer, option, file and consent.
 * @param formSelector The one live form selector, when a page is passed.
 * @returns The preflight outcome for this attempt.
 */
export const preflightForm: (
  target: Page | FormScope,
  expectations: readonly LiveFormExpectation[],
  formSelector?: string,
) => Promise<LiveFormVerdict> = async (
  target,
  expectations,
  formSelector = "form#application-form",
) => {
  const scope = isFormScope(target) ? target : await openForm(target, formSelector);

  if (scope === null) {
    return decideLiveFormVerdict({ ok: false, problems: [missingFormProblem()] });
  }

  await waitForStableForm(scope);

  return decideLiveFormVerdict(await checkLiveForm(scope, expectations));
};

export async function fillField(scope: FormScope, id: string, value: string) {
  const field = fieldById(scope, id);

  if ((await field.count()) === 0) {
    return false;
  }

  const group = await checkboxGroup(scope.root, id);

  if (group !== null) {
    return fillCheckboxGroup(group, value);
  }

  if ((await field.getAttribute("role")) === "combobox") {
    return chooseFromCombobox(scope.page, field, value);
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
    const options = scope.root.locator(`input[name="${cssValue(id)}"]`);

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
  scope: FormScope,
  fieldId: string,
  file: { name: string; mimeType: string; bytes: Uint8Array<ArrayBuffer> },
) {
  const input = fieldById(scope, fieldId);

  if ((await input.count()) === 0 || (await input.getAttribute("type")) !== "file") {
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
        (document.querySelector("form#application-form, form#application_form") === null &&
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
