import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { runBrowserFormAttempt, readFormQuestions } from "./browser-form.ts";
import { joinComApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * JOIN serves the posting at `/companies/{company}/{id}` and the form at its
 * `/apply` suffix. The one application form is filled; the posting's other
 * controls are never touched.
 */
export const JOIN_COM_FORM_SELECTOR =
  "form#application-form, form.application-form, form[data-testid='application-form'], form#apply-form";

export type JoinComRunPlan = BrowserFormPlan;

export type JoinComHooks = BrowserFormHooks;

export type JoinComRun = BrowserFormRun;

const JOIN_COM_CONFIG: BrowserFormConfig = {
  applyUrl: joinComApplyUrl,
  formSelector: JOIN_COM_FORM_SELECTOR,
};

/**
 * Reads the controls of a JOIN apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readJoinComQuestions(page: Page) {
  return readFormQuestions(page, JOIN_COM_CONFIG);
}

export const runJoinComAttempt: (
  page: Page,
  plan: JoinComRunPlan,
  hooks: JoinComHooks,
) => Promise<JoinComRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, JOIN_COM_CONFIG);
