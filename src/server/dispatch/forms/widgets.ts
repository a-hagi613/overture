import type { Locator, Page } from "playwright-core";

const cssValue = (raw: string) => raw.replaceAll(/["\\]/gu, String.raw`\$&`);

const PORTAL_WAIT_MS = 2500;
const OPTION_WAIT_MS = 4000;
const KEY_DELAY_MS = 40;

const listboxes = (page: Page) => page.locator("[role='listbox']:visible");

async function waitForListbox(page: Page, timeout: number) {
  try {
    await Promise.any([
      listboxes(page).first().waitFor({ state: "visible", timeout }),
      page
        .locator("[role='listbox'], [class*='menu']")
        .first()
        .waitFor({ state: "attached", timeout }),
    ]);

    return true;
  } catch {
    return false;
  }
}

/**
 * Focuses a combobox and opens its portal menu, retrying one click for the
 * common case where the first click only focused the control.
 *
 * @param page The page that owns the portal.
 * @param field The combobox input.
 * @param timeout How long each open attempt waits for the listbox.
 * @returns `true` once a listbox is visible.
 */
export async function openComboboxPortal(page: Page, field: Locator, timeout = PORTAL_WAIT_MS) {
  const attempt: (remaining: number) => Promise<boolean> = async (remaining) => {
    try {
      await field.scrollIntoViewIfNeeded({ timeout: 1000 });
      await field.focus({ timeout: 1000 });
      await field.click({ timeout: 2000 });
    } catch {
      return remaining > 0 ? attempt(remaining - 1) : false;
    }

    if (await waitForListbox(page, timeout)) {
      return true;
    }

    return remaining > 0 ? attempt(remaining - 1) : false;
  };

  return await attempt(1);
}

/**
 * Re-queries the live option nodes of the open portal menu. Always call this
 * again after typing: a virtualised menu replaces its nodes and a stale locator
 * clicks nothing.
 *
 * @param page The page that owns the portal.
 * @param field The combobox input, when it declares `aria-controls`.
 * @returns A fresh locator for the current option nodes.
 */
export async function liveComboboxOptions(page: Page, field: Locator) {
  const listboxId = await field.getAttribute("aria-controls");

  return listboxId !== null && listboxId !== ""
    ? page.locator(`[id="${cssValue(listboxId)}"] [role='option']`)
    : page.locator("[role='listbox']:visible [role='option']");
}

/**
 * Clears the combobox and types the query one character at a time, the way a
 * person does, then waits for the filtered options to render.
 *
 * @param page The page that owns the control.
 * @param field The combobox input.
 * @param query The characters to type.
 * @returns `true` when at least one option is rendered.
 */
export async function typeComboboxQuery(page: Page, field: Locator, query: string) {
  await field.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(query, { delay: KEY_DELAY_MS });

  const options = await liveComboboxOptions(page, field);

  try {
    await options.first().waitFor({ state: "attached", timeout: OPTION_WAIT_MS });

    return true;
  } catch {
    return false;
  }
}

/**
 * Clicks the first option whose folded label or value contains the target,
 * re-querying the option list immediately before the click so a virtualised
 * re-render cannot detach the node.
 *
 * @param page The page that owns the portal.
 * @param field The combobox input.
 * @param target The wanted option label.
 * @returns The clicked option's label, or `null` when no option matched.
 */
export async function clickComboboxOption(page: Page, field: Locator, target: string) {
  const wanted = target.replaceAll(/\s+/gu, " ").trim().toLowerCase();
  const options = await liveComboboxOptions(page, field);
  const count = await options.count();

  const tryFrom: (index: number) => Promise<string | null> = async (index) => {
    if (index >= count) {
      return null;
    }

    const option = options.nth(index);
    const label = (await option.textContent().catch(() => "")) ?? "";

    const value = await option
      .evaluate((element) =>
        element instanceof HTMLElement ? (element.dataset["value"] ?? "") : "",
      )
      .catch(() => "");

    const foldedLabel = label.replaceAll(/\s+/gu, " ").trim().toLowerCase();

    if (foldedLabel.includes(wanted) || value.toLowerCase() === wanted) {
      try {
        await option.click({ timeout: 2000 });

        return label.replaceAll(/\s+/gu, " ").trim();
      } catch {
        return null;
      }
    }

    return tryFrom(index + 1);
  };

  return tryFrom(0);
}

async function readValue(field: Locator) {
  try {
    return await field.inputValue({ timeout: 1000 });
  } catch {
    return null;
  }
}

/**
 * Fills a text-like control and proves the value stuck. SPA forms that keep the
 * input in React state can wipe `Locator.fill()` on the next render; this
 * helper then falls back to typing the value like a paste and, last, to the
 * native value setter with `input` and `change` events, which is what React
 * listens for.
 *
 * @param page The page that owns the control.
 * @param field The input or textarea.
 * @param value The answer to write.
 * @returns `true` when the control reads back the answer.
 */
export async function fillControlledField(page: Page, field: Locator, value: string) {
  try {
    await field.fill(value, { timeout: 5000 });
  } catch {
    await field.focus({ timeout: 1000 }).catch(() => undefined);
  }

  if ((await readValue(field)) === value) {
    return true;
  }

  try {
    await field.click({ timeout: 2000 });
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.insertText(value);
  } catch {
    await field.focus({ timeout: 1000 }).catch(() => undefined);
  }

  if ((await readValue(field)) === value) {
    return true;
  }

  try {
    await field.evaluate((element, next) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return;
      }

      const textTypes = ["text", "search", "tel", "url", "email", "password"];

      if (element instanceof HTMLTextAreaElement || textTypes.includes(element.type)) {
        element.setRangeText(next, 0, element.value.length, "end");
      } else {
        element.value = next;
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  } catch {
    return false;
  }

  return (await readValue(field)) === value;
}
