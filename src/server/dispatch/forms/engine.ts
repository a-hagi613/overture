import type { Locator, Page, Response } from "playwright-core";

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

export const isApplicationResponse = (candidate: Response) =>
  candidate.request().method() === "POST" &&
  new URL(candidate.url()).pathname.endsWith(APPLICATION_URL_PATH);

export async function watchApplicationResponse(page: Page) {
  return page.waitForResponse(isApplicationResponse, { timeout: APPLICATION_RESPONSE_MS });
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
