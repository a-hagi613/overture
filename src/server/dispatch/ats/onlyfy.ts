import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * onlyfy renders its guest application form as one hosted HTML form; a page with a second form fails closed.
 */
export const ONLYFY_FORM_SELECTOR = "form#onlyfy-application-form";

export type OnlyfyRunPlan = BrowserFormPlan;

export type OnlyfyHooks = BrowserFormHooks;

export type OnlyfyRun = BrowserFormRun;

const ONLYFY_CONFIG: BrowserFormConfig = {
  formSelector: ONLYFY_FORM_SELECTOR,
};

/**
 * Reads the controls of a onlyfy application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readOnlyfyQuestions(page: Page) {
  return readFormQuestions(page, ONLYFY_CONFIG);
}

export const runOnlyfyAttempt: (
  page: Page,
  plan: OnlyfyRunPlan,
  hooks: OnlyfyHooks,
) => Promise<OnlyfyRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, ONLYFY_CONFIG);
