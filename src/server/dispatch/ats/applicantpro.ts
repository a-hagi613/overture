import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";

/**
 * ApplicantPro marks its guest application form with its own class; a page with a second form fails closed.
 */
export const APPLICANTPRO_FORM_SELECTOR = "form#application-form.applicantpro-apply";

export type ApplicantProRunPlan = BrowserFormPlan;

export type ApplicantProHooks = BrowserFormHooks;

export type ApplicantProRun = BrowserFormRun;

const APPLICANTPRO_CONFIG: BrowserFormConfig = {
  formSelector: APPLICANTPRO_FORM_SELECTOR,
};

/**
 * Reads the controls of a applicantpro application page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readApplicantProQuestions(page: Page) {
  return readFormQuestions(page, APPLICANTPRO_CONFIG);
}

export const runApplicantProAttempt: (
  page: Page,
  plan: ApplicantProRunPlan,
  hooks: ApplicantProHooks,
) => Promise<ApplicantProRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, APPLICANTPRO_CONFIG);
