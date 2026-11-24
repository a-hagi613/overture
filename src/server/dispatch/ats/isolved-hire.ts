import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * isolved Hire renders its guest application form as one hosted HTML form; a page with a second form fails closed.
 */
export const ISOLVED_HIRE_FORM_SELECTOR = "form#isolvedhire-application-form";

export type IsolvedHireRunPlan = BrowserFormPlan;

export type IsolvedHireHooks = BrowserFormHooks;

export type IsolvedHireRun = BrowserFormRun;

const ISOLVED_HIRE_CONFIG: BrowserFormConfig = {
  formSelector: ISOLVED_HIRE_FORM_SELECTOR,
};

/**
 * Reads the controls of a isolved_hire application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readIsolvedHireQuestions(page: Page) {
  return readFormQuestions(page, ISOLVED_HIRE_CONFIG);
}

export const runIsolvedHireAttempt: (
  page: Page,
  plan: IsolvedHireRunPlan,
  hooks: IsolvedHireHooks,
) => Promise<IsolvedHireRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, ISOLVED_HIRE_CONFIG);
