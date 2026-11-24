import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Varbi renders its guest application form as one hosted HTML form; a page with a second form fails closed.
 */
export const VARBI_FORM_SELECTOR = "form#varbi-application-form";

export type VarbiRunPlan = BrowserFormPlan;

export type VarbiHooks = BrowserFormHooks;

export type VarbiRun = BrowserFormRun;

const VARBI_CONFIG: BrowserFormConfig = {
  formSelector: VARBI_FORM_SELECTOR,
};

/**
 * Reads the controls of a varbi application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readVarbiQuestions(page: Page) {
  return readFormQuestions(page, VARBI_CONFIG);
}

export const runVarbiAttempt: (
  page: Page,
  plan: VarbiRunPlan,
  hooks: VarbiHooks,
) => Promise<VarbiRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, VARBI_CONFIG);
