import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * Hiringthing renders its guest application form as one hosted HTML form; a page with a second form fails closed.
 */
export const HIRINGTHING_FORM_SELECTOR = "form#hiringthing-apply";

export type HiringthingRunPlan = BrowserFormPlan;

export type HiringthingHooks = BrowserFormHooks;

export type HiringthingRun = BrowserFormRun;

const HIRINGTHING_CONFIG: BrowserFormConfig = {
  formSelector: HIRINGTHING_FORM_SELECTOR,
};

/**
 * Reads the controls of a hiringthing application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readHiringthingQuestions(page: Page) {
  return readFormQuestions(page, HIRINGTHING_CONFIG);
}

export const runHiringthingAttempt: (
  page: Page,
  plan: HiringthingRunPlan,
  hooks: HiringthingHooks,
) => Promise<HiringthingRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, HIRINGTHING_CONFIG);
