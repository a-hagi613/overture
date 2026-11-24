import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { runBrowserFormAttempt, readFormQuestions } from "./browser-form.ts";

/**
 * ClearCompany serves the careers widget from `apply.clearcompany.com` and posts
 * an application to its careers API, which may sit on a sibling `clearcompany.com`
 * host. The widget's form root is the only form filled.
 */
export const CLEARCOMPANY_FORM_SELECTOR =
  "form#application-form, form.application-form, form[data-testid='application-form'], form#apply-form";

export type ClearCompanyRunPlan = BrowserFormPlan;

export type ClearCompanyHooks = BrowserFormHooks;

export type ClearCompanyRun = BrowserFormRun;

const CLEARCOMPANY_SUBMIT_HOST = /(?:^|\.)clearcompany\.com$/iu;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1"]);

const CLEARCOMPANY_CONFIG: BrowserFormConfig = {
  formSelector: CLEARCOMPANY_FORM_SELECTOR,
  submitResponse: (url) =>
    CLEARCOMPANY_SUBMIT_HOST.test(url.hostname) || LOOPBACK_HOSTS.has(url.hostname),
};

/**
 * Reads the controls of a ClearCompany apply form, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readClearCompanyQuestions(page: Page) {
  return readFormQuestions(page, CLEARCOMPANY_CONFIG);
}

export const runClearCompanyAttempt: (
  page: Page,
  plan: ClearCompanyRunPlan,
  hooks: ClearCompanyHooks,
) => Promise<ClearCompanyRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, CLEARCOMPANY_CONFIG);
