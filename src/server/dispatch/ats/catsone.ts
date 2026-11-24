import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * CATSone renders its guest application form with a data marker; a page with a second form fails closed.
 */
export const CATSONE_FORM_SELECTOR = "form[data-catsone-apply='true']";

export type CatsoneRunPlan = BrowserFormPlan;

export type CatsoneHooks = BrowserFormHooks;

export type CatsoneRun = BrowserFormRun;

const CATSONE_CONFIG: BrowserFormConfig = {
  formSelector: CATSONE_FORM_SELECTOR,
};

/**
 * Reads the controls of a catsone application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readCatsoneQuestions(page: Page) {
  return readFormQuestions(page, CATSONE_CONFIG);
}

export const runCatsoneAttempt: (
  page: Page,
  plan: CatsoneRunPlan,
  hooks: CatsoneHooks,
) => Promise<CatsoneRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, CATSONE_CONFIG);
