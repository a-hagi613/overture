import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Rippling renders its application form with a stable test id; a page with a second form fails closed.
 */
export const RIPPLING_FORM_SELECTOR = "form[data-testid='rippling-application-form']";

export type RipplingRunPlan = BrowserFormPlan;

export type RipplingHooks = BrowserFormHooks;

export type RipplingRun = BrowserFormRun;

const RIPPLING_CONFIG: BrowserFormConfig = {
  formSelector: RIPPLING_FORM_SELECTOR,
};

/**
 * Reads the controls of a rippling application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readRipplingQuestions(page: Page) {
  return readFormQuestions(page, RIPPLING_CONFIG);
}

export const runRipplingAttempt: (
  page: Page,
  plan: RipplingRunPlan,
  hooks: RipplingHooks,
) => Promise<RipplingRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, RIPPLING_CONFIG);
