import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Gem renders its guest application form as one hosted HTML form; a page with a second form fails closed.
 */
export const GEM_FORM_SELECTOR = "form#gem-application-form";

export type GemRunPlan = BrowserFormPlan;

export type GemHooks = BrowserFormHooks;

export type GemRun = BrowserFormRun;

const GEM_CONFIG: BrowserFormConfig = {
  formSelector: GEM_FORM_SELECTOR,
};

/**
 * Reads the controls of a gem application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readGemQuestions(page: Page) {
  return readFormQuestions(page, GEM_CONFIG);
}

export const runGemAttempt: (
  page: Page,
  plan: GemRunPlan,
  hooks: GemHooks,
) => Promise<GemRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, GEM_CONFIG);
