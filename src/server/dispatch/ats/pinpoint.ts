import type { Page } from "playwright-core";

import type {
  BrowserFormConfig,
  BrowserFormHooks,
  BrowserFormPlan,
  BrowserFormRun,
} from "./browser-form.ts";

import { runBrowserFormAttempt, readFormQuestions } from "./browser-form.ts";
import { pinpointApplyUrl } from "../../pipeline/wave1a-forms.ts";

/**
 * Pinpoint serves the posting at `/postings/{uuid}` and the application form at
 * `/postings/{uuid}/applications/new`. The form root is the one application form
 * on that page; a page with two form roots fails closed.
 */
export const PINPOINT_FORM_SELECTOR =
  "form#application-form, form.application-form, form[data-testid='application-form'], form#new_application";

export type PinpointRunPlan = BrowserFormPlan;

export type PinpointHooks = BrowserFormHooks;

export type PinpointRun = BrowserFormRun;

const PINPOINT_CONFIG: BrowserFormConfig = {
  applyUrl: pinpointApplyUrl,
  formSelector: PINPOINT_FORM_SELECTOR,
};

/**
 * Reads the controls of a Pinpoint apply page, for the admin capture job.
 *
 * @param page The apply page the browser opened.
 * @returns The controls, with their labels, kinds, options and required flags.
 */
export async function readPinpointQuestions(page: Page) {
  return readFormQuestions(page, PINPOINT_CONFIG);
}

export const runPinpointAttempt: (
  page: Page,
  plan: PinpointRunPlan,
  hooks: PinpointHooks,
) => Promise<PinpointRun> = async (page, plan, hooks) =>
  runBrowserFormAttempt(page, plan, hooks, PINPOINT_CONFIG);
