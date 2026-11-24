import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import type { FormScope } from "../forms/engine.ts";
import { CONFIRMATION_SOURCES } from "../forms/engine.ts";
import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * HERP renders one React form for every employer. The privacy consent is the one
 * control every HERP apply form carries, so it identifies the form; a page with a
 * second copy fails closed.
 */
export const HERP_FORM_SELECTOR = "form:has(input[name='privacyPolicy'])";

/** The preview button HERP shows before the final Submit. */
export const HERP_CONFIRM_SELECTOR = "button.js-preview[data-action='enter']";

const HERP_CLOSED =
  /no longer (?:accepting|available|open)|not accepting applications|position (?:has been )?(?:filled|closed)|募集(?:を)?終了|応募(?:を)?終了/iu;

const HERP_CONFIRMATION_SOURCES = [
  ...CONFIRMATION_SOURCES,
  String.raw`応募を受け付けました`,
  String.raw`応募が完了しました`,
  String.raw`ご応募ありがとうございました`,
];

/**
 * Turns a HERP posting URL into its apply form URL.
 *
 * @param url The posting or apply URL.
 * @returns The apply URL, or null when the URL is not a HERP job page.
 */
export function herpApplyUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (!/^\/v\d+\/[^/]+\/[^/]+/u.test(parsed.pathname)) {
      return null;
    }

    if (/\/apply\/?$/u.test(parsed.pathname)) {
      return parsed.toString();
    }

    parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/apply`;

    return parsed.toString();
  } catch {
    return null;
  }
}

export type HerpRunPlan = BrowserFormPlan;

export type HerpHooks = BrowserFormHooks;

export type HerpRun = BrowserFormRun;

async function confirmHerpPreview(page: Page, scope: FormScope) {
  const confirm = scope.root.locator(HERP_CONFIRM_SELECTOR).first();

  if ((await confirm.count()) > 0 && (await confirm.isVisible().catch(() => false))) {
    await confirm.click({ timeout: 20_000 }).catch(() => undefined);
  }

  const submit = scope.root.locator("button[type='submit'], input[type='submit']");

  try {
    await submit.first().waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    return false;
  }

  return (await submit.count()) > 0;
}

const HERP_CONFIG: BrowserFormConfig = {
  applyUrl: herpApplyUrl,
  beforeSubmit: confirmHerpPreview,
  closed: HERP_CLOSED,
  confirmationSources: HERP_CONFIRMATION_SOURCES,
  formSelector: HERP_FORM_SELECTOR,
  loginWall: true,
};

/**
 * Reads the controls of a HERP application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readHerpQuestions(page: Page) {
  return readFormQuestions(page, HERP_CONFIG);
}

export const runHerpAttempt: (
  page: Page,
  plan: HerpRunPlan,
  hooks: HerpHooks,
) => Promise<HerpRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, HERP_CONFIG);
