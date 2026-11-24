import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormPlan,
  BrowserFormRun,
  BrowserFormHooks,
} from "./browser-form.ts";

import { runBrowserFormAttempt, readFormQuestions } from "./browser-form.ts";
import { softgardenApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * Softgarden renders the application form on its `/job/{id}/apply` page. The
 * form with the submit control is the only one filled; the posting page and any
 * newsletter form beside it are never touched.
 */
export const SOFTGARDEN_FORM_SELECTOR =
  "form#application-form, form.application-form, form[data-testid='application-form'], form#apply-form";

export type SoftgardenRunPlan = BrowserFormPlan;

export type SoftgardenHooks = BrowserFormHooks;

export type SoftgardenRun = BrowserFormRun;

const SOFTGARDEN_CONFIG: BrowserFormConfig = {
  applyUrl: softgardenApplyUrl,
  formSelector: SOFTGARDEN_FORM_SELECTOR,
};

/**
 * Reads the controls of a Softgarden apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readSoftgardenQuestions(page: Page) {
  return readFormQuestions(page, SOFTGARDEN_CONFIG);
}

export const runSoftgardenAttempt: (
  page: Page,
  plan: SoftgardenRunPlan,
  hooks: SoftgardenHooks,
) => Promise<SoftgardenRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, SOFTGARDEN_CONFIG);
