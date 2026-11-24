import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * BambooHR renders the application form on the posting's careers page. The one form with the resume upload is filled; any sign-in or newsletter form beside it fails closed instead.
 */
export const BAMBOOHR_FORM_SELECTOR =
  "form#applicationForm, form#application-form, form[action*='apply'], form[data-testid='application-form']";

export type BambooHRRunPlan = BrowserFormPlan;

export type BambooHRHooks = BrowserFormHooks;

export type BambooHRRun = BrowserFormRun;

const BAMBOOHR_CONFIG: BrowserFormConfig = {
  formSelector: BAMBOOHR_FORM_SELECTOR,
};

/**
 * Reads the controls of a BambooHR apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readBambooHRQuestions(page: Page) {
  return readFormQuestions(page, BAMBOOHR_CONFIG);
}

export const runBambooHRAttempt: (
  page: Page,
  plan: BambooHRRunPlan,
  hooks: BambooHRHooks,
) => Promise<BambooHRRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, BAMBOOHR_CONFIG);
