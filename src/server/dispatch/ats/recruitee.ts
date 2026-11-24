import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { readFormQuestions, runBrowserFormAttempt } from "./browser-form.ts";
import { recruiteeApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * Recruitee serves the posting at `/o/{slug}` and the form at its `/c/new` page. The one candidate form is filled; the sign-up and search forms beside it are never touched.
 */
export const RECRUITEE_FORM_SELECTOR =
  "form#new_candidate, form[action*='/c/'], form[data-testid='application-form']";

export type RecruiteeRunPlan = BrowserFormPlan;

export type RecruiteeHooks = BrowserFormHooks;

export type RecruiteeRun = BrowserFormRun;

const RECRUITEE_CONFIG: BrowserFormConfig = {
  applyUrl: recruiteeApplyUrl,
  formSelector: RECRUITEE_FORM_SELECTOR,
};

/**
 * Reads the controls of a Recruitee apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readRecruiteeQuestions(page: Page) {
  return readFormQuestions(page, RECRUITEE_CONFIG);
}

export const runRecruiteeAttempt: (
  page: Page,
  plan: RecruiteeRunPlan,
  hooks: RecruiteeHooks,
) => Promise<RecruiteeRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, RECRUITEE_CONFIG);
