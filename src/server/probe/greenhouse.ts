import type { Locator, Page } from "playwright-core";

import type { ProbeConsole } from "./console.ts";
import type { RunFilePosting } from "./run-file.ts";

const CONFIRMATION_SOURCES = [
  String.raw`thanks? for (?:applying|your application|your interest)`,
  String.raw`thank you for applying!`,
  String.raw`application (?:has been |was )?(?:successfully )?(?:submitted|received|sent)`,
  String.raw`we(?:['’]?ve| have) received your application`,
  String.raw`your application (?:is|has been) (?:in|received|submitted)`,
];

const FILLABLE_INPUT_TYPES = new Set(["text", "email", "tel", "number", "date", "url"]);

const FORM_APPEAR_MS = 15_000;
const COMBOBOX_MENU_MS = 5000;
const COMBOBOX_KEY_DELAY_MS = 50;

export interface GreenhouseAttempt {
  outcome:
    | "dry_run_filled"
    | "fill_failed"
    | "sent"
    | "unconfirmed"
    | "code_refused"
    | "form_missing";
  filledIds: string[];
  failedIds: string[];
  resumeUploaded: boolean;
  codeAsked: boolean;
  codeResponseStatus: number | null;
  submitResponseStatus: number | null;
  confirmationSeen: boolean;
}

const messages = {
  uploadRefused: (id: string) => `the resume input ${id} refused the upload`,
};

const cssValue = (raw: string) => raw.replaceAll(/["\\]/gu, String.raw`\$&`);

const norm = (raw: string) => raw.replaceAll(/\s+/gu, " ").trim().toLowerCase();

const formLocator = (page: Page) => page.locator("form#application-form").first();

const codeInputs = (page: Page) => page.locator("input[id^='security-input-']");

const submitButton = (page: Page) =>
  page.locator("form#application-form button[type='submit']").first();

const fieldById = (page: Page, id: string) =>
  page.locator(`[id="${cssValue(id)}"], [name="${cssValue(id)}"]`).first();

const fillTextbox = async (field: Locator, value: string) => {
  await field.fill(value);

  return true;
};

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
    cityOf(text) === city ? [{ text, index }] : [],
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

  const matched = index === -1 ? undefined : raw[index];

  if (matched === undefined) {
    return false;
  }

  if (matched.value === null) {
    return false;
  }

  await field.selectOption(matched.value);

  return true;
}

async function fillQuestion(page: Page, id: string, value: string) {
  const field = fieldById(page, id);

  if ((await field.count()) === 0) {
    return false;
  }

  if ((await field.getAttribute("role")) === "combobox") {
    return chooseFromCombobox(page, field, value);
  }

  const widget = await field.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : "",
  }));

  if (widget.tag === "textarea") {
    return fillTextbox(field, value);
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
    const option = page
      .locator(`input[name="${cssValue(id)}"][value="${cssValue(value)}"]`)
      .first();

    if ((await option.count()) === 0) {
      return false;
    }

    await option.check();

    return true;
  }

  if (widget.tag === "input" && FILLABLE_INPUT_TYPES.has(widget.type)) {
    return fillTextbox(field, value);
  }

  return false;
}

async function uploadResume(page: Page, fieldId: string, resumePath: string) {
  const input = fieldById(page, fieldId);

  if ((await input.count()) === 0) {
    return false;
  }

  try {
    await input.setInputFiles(resumePath);
  } catch {
    return false;
  }

  return true;
}

async function waitForApplicationResponse(page: Page) {
  const settled = await Promise.allSettled([
    submitButton(page).click(),
    page.waitForResponse((response) => response.request().method() === "POST"),
  ]);

  const [, response] = settled;

  return response.status === "fulfilled" ? response.value : null;
}

async function typeCode(page: Page, code: string) {
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

async function readConfirmation(page: Page) {
  try {
    await page.waitForFunction(
      (sources) =>
        document.querySelector("form#application-form") === null &&
        sources.some((source) => new RegExp(source, "iu").test(document.body.textContent)),
      CONFIRMATION_SOURCES,
      { timeout: 10_000 },
    );
  } catch {
    return false;
  }

  return true;
}

async function codeStepVisible(page: Page) {
  try {
    await codeInputs(page).first().waitFor({ state: "visible", timeout: COMBOBOX_MENU_MS });
  } catch {
    return false;
  }

  return true;
}

const attemptStructure = {
  empty: (outcome: GreenhouseAttempt["outcome"], filledIds: string[]) => ({
    outcome,
    filledIds,
    failedIds: [],
    resumeUploaded: false,
    codeAsked: false,
    codeResponseStatus: null,
    submitResponseStatus: null,
    confirmationSeen: false,
  }),
};

const fillQuestionsInOrder = async (page: Page, questions: RunFilePosting["questions"]) => {
  const filledIds: string[] = [];
  const failedIds: string[] = [];

  const fillFrom = async (index: number) => {
    if (index >= questions.length) {
      return;
    }

    const question = questions[index];

    if (question === undefined) {
      await fillFrom(index + 1);

      return;
    }

    const filled = await fillQuestion(page, question.id, question.value);

    (filled ? filledIds : failedIds).push(question.id);

    await fillFrom(index + 1);
  };

  await fillFrom(0);

  return { filledIds, failedIds };
};

export async function probeGreenhouse(
  page: Page,
  posting: RunFilePosting,
  applicationUrl: string,
  resumePath: string,
  io: ProbeConsole,
  confirm: boolean,
) {
  await page.goto(applicationUrl, { waitUntil: "domcontentloaded" });

  try {
    await formLocator(page).waitFor({ state: "visible", timeout: FORM_APPEAR_MS });
  } catch {
    return attemptStructure.empty("form_missing", []);
  }

  const { filledIds, failedIds } = await fillQuestionsInOrder(page, posting.questions);

  if (failedIds.length > 0) {
    return { ...attemptStructure.empty("fill_failed", filledIds), failedIds };
  }

  const resumeUploaded = await uploadResume(page, posting.resumeFieldId, resumePath);

  if (!resumeUploaded) {
    throw new Error(messages.uploadRefused(posting.resumeFieldId));
  }

  if (!confirm) {
    return { ...attemptStructure.empty("dry_run_filled", filledIds), resumeUploaded };
  }

  const firstResponse = await waitForApplicationResponse(page);
  const firstStatus = firstResponse === null ? null : firstResponse.status();
  const codeResponseStatus = firstStatus === 428 ? 428 : null;

  if (!(await codeStepVisible(page))) {
    const confirmed = firstStatus !== null && firstStatus < 400 && (await readConfirmation(page));

    return {
      ...attemptStructure.empty(confirmed ? "sent" : "unconfirmed", filledIds),
      resumeUploaded,
      codeResponseStatus,
      submitResponseStatus: firstStatus,
      confirmationSeen: confirmed,
    };
  }

  io.writeLine("");
  io.writeLine("Greenhouse asked for an emailed verification code.");
  io.writeLine("Open the inbox on this address, read the code, type it here and press Enter.");
  io.writeLine("");

  const typed = await io.readLine();

  io.writeLine(`DEBUG count=${String(await codeInputs(page).count())} typed=[${typed}]`);
  await typeCode(page, typed);

  const secondResponse = await waitForApplicationResponse(page);
  const secondStatus = secondResponse === null ? null : secondResponse.status();
  const confirmed = secondStatus !== null && secondStatus < 400 && (await readConfirmation(page));

  if (secondStatus !== null && secondStatus >= 400) {
    return {
      ...attemptStructure.empty("code_refused", filledIds),
      resumeUploaded,
      codeAsked: true,
      codeResponseStatus,
      submitResponseStatus: secondStatus,
    };
  }

  return {
    ...attemptStructure.empty(confirmed ? "sent" : "unconfirmed", filledIds),
    resumeUploaded,
    codeAsked: true,
    codeResponseStatus,
    submitResponseStatus: secondStatus,
    confirmationSeen: confirmed,
  };
}
