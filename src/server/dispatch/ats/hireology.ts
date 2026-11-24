import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Hireology renders the application form on the posting page. The one form with the resume upload is filled; a sign-in or search form beside it is never touched.
 */
export const HIREOLOGY_FORM_SELECTOR =
  "form#application-form, form#applicationForm, form[action*='applications'], form[data-testid='application-form']";

export type HireologyRunPlan = BrowserFormPlan;

export type HireologyHooks = BrowserFormHooks;

export type HireologyRun = BrowserFormRun;

const HIREOLOGY_CONFIG: BrowserFormConfig = {
  formSelector: HIREOLOGY_FORM_SELECTOR,
};

/**
 * Reads the controls of a Hireology apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readHireologyQuestions(page: Page) {
  return readFormQuestions(page, HIREOLOGY_CONFIG);
}

export const runHireologyAttempt: (
  page: Page,
  plan: HireologyRunPlan,
  hooks: HireologyHooks,
) => Promise<HireologyRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, HIREOLOGY_CONFIG);
