import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormPlan,
  BrowserFormRun,
  BrowserFormHooks,
} from "./browser-form.ts";

import { runBrowserFormAttempt, readFormQuestions } from "./browser-form.ts";
import { breezyApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * Breezy HR renders its application form in React from the `#portal-data`
 * payload. The form owns the one application root; a page with a second form
 * (newsletter, LinkedIn apply) fails closed instead of filling the wrong one.
 */
export const BREEZY_FORM_SELECTOR =
  "form#application-form, form.application-form, form[data-testid='application-form']";

export type BreezyRunPlan = BrowserFormPlan;

export type BreezyHooks = BrowserFormHooks;

export type BreezyRun = BrowserFormRun;

const BREEZY_CONFIG: BrowserFormConfig = {
  applyUrl: breezyApplyUrl,
  formSelector: BREEZY_FORM_SELECTOR,
};

/**
 * Reads the controls of a Breezy apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readBreezyQuestions(page: Page) {
  return readFormQuestions(page, BREEZY_CONFIG);
}

export const runBreezyAttempt: (
  page: Page,
  plan: BreezyRunPlan,
  hooks: BreezyHooks,
) => Promise<BreezyRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, BREEZY_CONFIG);
